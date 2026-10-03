/* Escena: horizonte del planeta, trayectoria punteada y cohete.
   Un único bucle requestAnimationFrame hace dos cosas: acerca la velocidad
   mostrada a la real (la trayectoria se deforma sin saltos) y mueve el cohete a
   lo largo de ella escribiendo solo su `transform`.
   Con prefers-reduced-motion no hay bucle: la escena queda en una pose fija y
   los cambios entran con un fundido de opacidad. */
(function () {
  "use strict";

  var App = (window.EscapeVelocity = window.EscapeVelocity || {});
  var flight = App.flight;

  var LABELS = { suborbital: "suborbital", orbit: "en órbita", escape: "escape" };
  var EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  var DEG = 180 / Math.PI;

  function reduced() {
    return Boolean(window.Pluton && window.Pluton.reducedMotion());
  }

  function setAttrs(el, attrs) {
    for (var key in attrs) el.setAttribute(key, attrs[key]);
  }

  App.createScene = function (options) {
    var stage = options.stage;
    var svg = options.svg;
    var view = svg.parentNode;
    var els = {
      planet: svg.querySelector("#planet"),
      haze: svg.querySelector("#planet-haze"),
      limb: svg.querySelector("#planet-limb"),
      fill: svg.querySelector("#planet-fill"),
      stopDeep: svg.querySelector("#planet-stop-deep"),
      stopMid: svg.querySelector("#planet-stop-mid"),
      pad: svg.querySelector("#pad"),
      leo: svg.querySelector("#leo"),
      leoLabel: svg.querySelector("#leo-label"),
      pluto: svg.querySelector("#pluto"),
      traj: svg.querySelector("#traj"),
      incoming: svg.querySelector("#incoming"),
      impact: svg.querySelector("#impact"),
      rocket: svg.querySelector("#rocket"),
      rocketBody: svg.querySelector("#rocket-body"),
      telemetry: options.telemetry,
    };

    var frame = null; // geometría del encuadre
    var model = null; // trayectoria para la velocidad mostrada
    var targetV = 0;
    var shownV = 0;
    var cruiseScale = 1;
    var loop = 0;
    var lastTime = 0;
    var lastTelemetry = "";

    // Estado del cohete. τ es su posición en la trayectoria (ver flight.point).
    var rocket = { phase: "pose", tau: 0, lap: false, flown: 0, until: 0, heading: null };

    // Telemetría: "v: 9,4 km/s · suborbital"
    var telValue = document.createElement("b");
    var telState = document.createTextNode("");
    els.telemetry.textContent = "v: ";
    els.telemetry.appendChild(telValue);
    els.telemetry.appendChild(telState);

    /* ---------- geometría ---------- */

    function layout() {
      var rect = view.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var w = Math.round(rect.width);
      var h = Math.round(rect.height);
      frame = flight.frame(w, h);
      cruiseScale = flight.clamp(frame.reach / 560, 0.6, 1.1);
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);

      var disc = { cx: frame.cx.toFixed(1), cy: frame.cy.toFixed(1), r: frame.radius.toFixed(1) };
      setAttrs(els.planet, disc);
      setAttrs(els.limb, disc);
      setAttrs(els.haze, { cx: disc.cx, cy: disc.cy, r: (frame.radius + 7).toFixed(1) });
      setAttrs(els.fill, disc);
      // El planeta se apaga hacia abajo hasta fundirse con el fondo de la página.
      els.stopDeep.setAttribute("offset", (1 - flight.clamp(h * 0.24, 70, 140) / frame.radius).toFixed(4));
      els.stopMid.setAttribute("offset", (1 - 26 / frame.radius).toFixed(4));

      var pad = flight.toScreen(frame, 0, -frame.base);
      els.pad.setAttribute(
        "transform",
        "translate(" + pad[0].toFixed(1) + " " + pad[1].toFixed(1) + ") rotate(" + (frame.padAngle * DEG).toFixed(2) + ")"
      );

      // Órbita baja de referencia: un arco concéntrico con el horizonte.
      var r = frame.radius + frame.base + frame.orbitAlt;
      var arcY = function (x) {
        return frame.cy - Math.sqrt(r * r - (x - frame.cx) * (x - frame.cx));
      };
      els.leo.setAttribute(
        "d",
        "M-20 " + arcY(-20).toFixed(1) + "A" + r.toFixed(1) + " " + r.toFixed(1) + " 0 0 1 " + (w + 20) + " " + arcY(w + 20).toFixed(1)
      );
      // La etiqueta va por debajo del arco: las órbitas pasan siempre por encima.
      var labelX = w * 0.9;
      setAttrs(els.leoLabel, { x: labelX.toFixed(1), y: (arcY(labelX) + 17).toFixed(1) });

      var small = w < 480;
      var plutoScale = small ? 0.26 : 0.36;
      var px = w - Math.max(w * 0.15, 60);
      var py = Math.max(h * 0.13, 40);
      els.pluto.setAttribute(
        "transform",
        "translate(" + (px - 60 * plutoScale).toFixed(1) + " " + (py - 60 * plutoScale).toFixed(1) + ") scale(" + plutoScale + ")"
      );
      els.rocketBody.setAttribute("transform", "scale(" + (small ? 0.34 : 0.42) + ") translate(-24 -38)");

      rebuild();
      if (!loop) pose();
    }

    function rebuild() {
      if (!frame) return;
      model = flight.model(shownV, frame);
      els.traj.setAttribute("d", flight.toPathData(flight.path(model)));
      els.incoming.setAttribute("d", flight.toPathData(flight.incomingPath(model)));
      if (stage.dataset.state !== model.state) stage.dataset.state = model.state;

      var text = flight.formatTenths(shownV) + " km/s|" + LABELS[model.state];
      if (text !== lastTelemetry) {
        lastTelemetry = text;
        telValue.textContent = flight.formatTenths(shownV) + " km/s";
        telState.nodeValue = " · " + LABELS[model.state];
      }
    }

    /* ---------- cohete ---------- */

    function place(tau, incoming, dt) {
      var p = flight.point(model, tau, incoming);
      var q = flight.point(model, tau + 0.002, incoming);
      var angle = Math.atan2(q[1] - p[1], q[0] - p[0]) * DEG + 90;
      if (rocket.heading === null || !dt) {
        rocket.heading = angle;
      } else {
        // El rumbo persigue a la tangente: suaviza las juntas entre tramos.
        var diff = ((angle - rocket.heading + 540) % 360) - 180;
        rocket.heading += diff * Math.min(1, dt / 90);
      }
      els.rocket.setAttribute(
        "transform",
        "translate(" + p[0].toFixed(2) + " " + p[1].toFixed(2) + ") rotate(" + rocket.heading.toFixed(2) + ")"
      );
    }

    function burn(on) {
      els.rocket.classList.toggle("is-burning", on);
    }

    function toPad(now) {
      rocket.phase = "pad";
      rocket.tau = 0;
      rocket.lap = false;
      rocket.flown = 0;
      rocket.heading = null;
      rocket.until = now + 650;
      place(0, false, 0);
      burn(false);
      els.rocket.classList.remove("is-hidden");
    }

    function vanish(now, wait) {
      rocket.phase = "wait";
      rocket.until = now + wait;
      els.rocket.classList.add("is-hidden");
    }

    function impact() {
      var p = flight.toScreen(frame, model.s0 + (model.tauEnd - 1) * frame.reach, -frame.base);
      setAttrs(els.impact, { cx: p[0].toFixed(1), cy: p[1].toFixed(1) });
      els.impact.animate(
        [
          { transform: "scale(0.5)", opacity: 0.9 },
          { transform: "scale(3)", opacity: 0 },
        ],
        { duration: 760, easing: EASE_OUT }
      );
    }

    function fly(now, dt) {
      if (rocket.phase === "wait") {
        if (now >= rocket.until) toPad(now);
        return;
      }
      if (rocket.phase === "pad") {
        place(0, false, 0);
        if (now >= rocket.until) {
          rocket.phase = "fly";
          burn(true);
        }
        return;
      }

      // La configuración cambió y este tramo ya no existe: el cohete se funde
      // donde está y vuelve a salir de la plataforma.
      var orphanLap = rocket.lap && rocket.tau < 1 && model.state !== "orbit";
      if (orphanLap || rocket.tau > model.tauEnd) {
        vanish(now, 500);
        return;
      }

      var incoming = rocket.lap && rocket.tau < 1;
      var a = flight.point(model, rocket.tau, incoming);
      var b = flight.point(model, rocket.tau + 0.002, incoming);
      var perTau = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.002, 1);
      var cruise = (70 + 13 * Math.min(shownV, 22)) * cruiseScale;
      var speed = cruise * (0.22 + 0.78 * flight.smoothstep(rocket.flown / (90 * cruiseScale)));
      var dist = (speed * dt) / 1000;
      rocket.tau += dist / perTau;
      rocket.flown += dist;

      if (rocket.tau >= model.tauEnd) {
        if (model.state === "orbit") {
          // Otra vuelta: sale por la derecha y entra por la izquierda.
          rocket.lap = true;
          rocket.tau = model.tauStart;
          rocket.heading = null;
        } else {
          rocket.tau = model.tauEnd;
          place(rocket.tau, false, dt);
          if (model.landed) impact();
          vanish(now, model.landed ? 1400 : 1000);
          return;
        }
      }

      // En un vuelo suborbital el motor se apaga al llegar arriba; el resto es caída.
      burn(!(model.state === "suborbital" && rocket.tau > 1));
      place(rocket.tau, rocket.lap && rocket.tau < 1, dt);
    }

    /* ---------- bucle ---------- */

    function tick(now) {
      var dt = Math.min(now - lastTime, 64);
      lastTime = now;
      if (shownV !== targetV) {
        shownV += (targetV - shownV) * (1 - Math.exp(-dt / 150));
        if (Math.abs(targetV - shownV) < 0.01) shownV = targetV;
        rebuild();
      }
      fly(now, dt);
      loop = requestAnimationFrame(tick);
    }

    function start() {
      if (loop || !frame || reduced() || document.hidden) return;
      lastTime = performance.now();
      if (rocket.phase === "pose") toPad(lastTime);
      loop = requestAnimationFrame(tick);
    }

    function stop() {
      if (loop) cancelAnimationFrame(loop);
      loop = 0;
    }

    // Pose fija para movimiento reducido: el cohete en el punto que mejor resume
    // el vuelo (el techo de un salto, media órbita, camino de salida).
    function pose() {
      if (!frame) return;
      shownV = targetV;
      rebuild();
      var tau = 1;
      if (model.state === "orbit") tau = 1 + (model.tauEnd - 1) * 0.5;
      else if (model.state === "escape") tau = 1 + (model.tauEnd - 1) * 0.55;
      rocket.phase = "pose";
      rocket.heading = null;
      place(tau, false, 0);
      burn(true);
      els.rocket.classList.remove("is-hidden");
    }

    function fade() {
      [els.traj, els.incoming, els.rocket].forEach(function (el) {
        if (el.animate) el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: EASE_OUT });
      });
    }

    /* ---------- eventos ---------- */

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });

    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-reduced-motion: reduce)");
      var onMotionChange = function () {
        if (query.matches) {
          stop();
          pose();
        } else {
          start();
        }
      };
      if (query.addEventListener) query.addEventListener("change", onMotionChange);
    }

    if (window.ResizeObserver) new ResizeObserver(layout).observe(view);
    else window.addEventListener("resize", layout);
    layout();

    start();

    return {
      // Nueva velocidad: la trayectoria se deforma hasta ella.
      setVelocity: function (v) {
        targetV = v;
        if (reduced()) {
          pose();
          fade();
        } else {
          start();
        }
      },
      // Contraseña nueva: lanzamiento nuevo.
      relaunch: function () {
        if (reduced()) {
          fade();
        } else if (rocket.phase === "fly") {
          vanish(performance.now(), 280);
        }
      },
      // Para pruebas y capturas: en qué anda el cohete.
      snapshot: function () {
        return { phase: rocket.phase, tau: rocket.tau, end: model ? model.tauEnd : 1, lap: rocket.lap, shown: shownV, state: model ? model.state : null };
      },
    };
  };
})();
