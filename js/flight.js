/* Modelo de vuelo: bits de entropía → velocidad → trayectoria.
   Lógica pura (sin DOM). La escena es un esquema, no una simulación a escala:
   las cifras y los umbrales son los reales; la forma de las curvas está
   comprimida para que los tres regímenes quepan en pantalla.

   Escala: v = 0,14 km/s por bit, de modo que 80 bits son exactamente los
   11,2 km/s de la velocidad de escape terrestre. 80 bits son 2^80 ≈ 1,2·10^24
   combinaciones: a 10^12 intentos por segundo hacen falta, de media, unos
   19 000 años. La órbita baja (7,9 km/s = 11,2/√2) cae en 56,4 bits, justo por
   encima de los 56 de DES, que se rompió por fuerza bruta en 1998. */
(function () {
  "use strict";

  var App = (window.EscapeVelocity = window.EscapeVelocity || {});

  var V_ESCAPE = 11.2;
  var V_ORBIT = 7.9;
  var BITS_ESCAPE = 80;
  var KMS_PER_BIT = V_ESCAPE / BITS_ESCAPE;
  var EPSILON = 1e-9;
  var MARGIN = 34; // lo que el cohete sale del encuadre antes de darlo por perdido

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function smoothstep(p) {
    var t = clamp(p, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function velocity(bits) {
    return bits * KMS_PER_BIT;
  }

  function stateOf(v) {
    if (v >= V_ESCAPE - EPSILON) return "escape";
    if (v >= V_ORBIT - EPSILON) return "orbit";
    return "suborbital";
  }

  /* ---------- encuadre ---------- */

  // El planeta es un círculo enorme del que solo asoma el horizonte. Todo se
  // mide en el marco curvo del suelo: s = distancia recorrida sobre el horizonte
  // desde la plataforma, h = altura sobre ella.
  function frame(width, height) {
    var ground = Math.max(height * 0.2, 40);
    var radius = Math.max(width * 1.15, 620);
    var cx = width * 0.5;
    var topY = height - ground;
    var padX = width * 0.15;
    var base = width < 480 ? 12 : 14; // el centro del cohete, posado, sobre el suelo
    var sky = topY - 16;
    return {
      width: width,
      height: height,
      radius: radius,
      cx: cx,
      cy: topY + radius,
      topY: topY,
      padX: padX,
      padAngle: Math.asin((padX - cx) / radius),
      base: base,
      orbitAlt: clamp(sky * 0.36, 54, 180),
      reach: width - padX,
    };
  }

  function toScreen(f, s, h) {
    var angle = f.padAngle + s / f.radius;
    var r = f.radius + f.base + h;
    return [f.cx + r * Math.sin(angle), f.cy - r * Math.cos(angle)];
  }

  /* ---------- trayectoria ---------- */

  // Tras el ascenso, el cohete queda a altura h0 con velocidad horizontal. En el
  // marco que sigue al horizonte la gravedad efectiva es g·(1 − k²), con
  // k = v / v_órbita: por debajo de 1 cae, en 1 flota y por encima se aleja.
  //   h(Δ) = h0 + m·Δ + c·Δ² / 2ρ
  function model(v, f) {
    var speed = Math.max(v, 0.4);
    var k = speed / V_ORBIT;
    var kk = Math.min(k, 1);
    var state = stateOf(speed);
    var h0 = f.orbitAlt * Math.max(Math.pow(kk, 1.25), 0.2);
    var s0 = f.reach * 0.16 * (0.45 + 0.55 * kk);
    var c = 0; // curvatura tras la inyección
    var c0 = 0; // curvatura de la rama de llegada (solo en órbita)
    var m = 0; // pendiente al terminar el ascenso

    if (state === "suborbital") {
      c = -(1 - k * k) / (k * k);
    } else if (state === "orbit") {
      // Órbitas cada vez más excéntricas; el último 10 % antes del umbral ya se
      // despega del planeta, para que el paso a "escape" sea continuo.
      var x = (speed - V_ORBIT) / (V_ESCAPE - V_ORBIT);
      var w = smoothstep((x - 0.9) / 0.1);
      c0 = 0.1 * x;
      c = c0 * (1 - w);
      m = 0.5 * w;
    } else {
      c0 = 0.1;
      m = 0.5 + 1.6 * (1 - Math.exp(-(speed - V_ESCAPE) / 8));
    }

    if (m > 0) s0 = Math.min(s0, (0.6 * h0) / m);

    var mdl = {
      frame: f,
      v: v,
      state: state,
      h0: h0,
      s0: s0,
      hc: h0 - m * s0, // punto de control del ascenso: sale vertical y llega con pendiente m
      m: m,
      c: c,
      c0: c0,
      rho2: f.reach * 0.34,
      landed: false,
      tauEnd: 1,
      tauStart: 1,
    };

    // Fin del tramo: aterriza, o sale del encuadre por la derecha o por arriba.
    var step = 6;
    var delta = 0;
    for (var i = 0; i < 2000; i++) {
      delta += step;
      var h = mdl.h0 + mdl.m * delta + (mdl.c * delta * delta) / mdl.rho2;
      if (h <= 0) {
        delta = Math.sqrt((mdl.rho2 * mdl.h0) / -mdl.c);
        mdl.landed = true;
        break;
      }
      var p = toScreen(f, mdl.s0 + delta, h);
      if (p[0] > f.width + MARGIN || p[1] < -MARGIN) break;
    }
    mdl.tauEnd = 1 + delta / f.reach;

    // En órbita el cohete vuelve a entrar por la izquierda: rama de llegada.
    if (state === "orbit") {
      var back = 0;
      for (var j = 0; j < 2000; j++) {
        back -= step;
        var q = toScreen(f, mdl.s0 + back, mdl.h0 + (mdl.c0 * back * back) / mdl.rho2);
        if (q[0] < -MARGIN) break;
      }
      mdl.tauStart = 1 + back / f.reach;
    }

    return mdl;
  }

  // τ recorre la trayectoria: 0 → 1 es el ascenso (Bézier cuadrática) y a partir
  // de 1 cada unidad es un "reach" de horizonte. `incoming` pide la rama de llegada.
  function point(mdl, tau, incoming) {
    var f = mdl.frame;
    if (incoming) {
      var back = (tau - 1) * f.reach;
      return toScreen(f, mdl.s0 + back, mdl.h0 + (mdl.c0 * back * back) / mdl.rho2);
    }
    if (tau <= 1) {
      var t = Math.max(tau, 0);
      return toScreen(f, mdl.s0 * t * t, 2 * (1 - t) * t * mdl.hc + t * t * mdl.h0);
    }
    var delta = (tau - 1) * f.reach;
    return toScreen(f, mdl.s0 + delta, mdl.h0 + mdl.m * delta + (mdl.c * delta * delta) / mdl.rho2);
  }

  function sample(mdl, from, to, incoming, stepPx) {
    var span = Math.abs(to - from) * mdl.frame.reach;
    var count = Math.max(2, Math.ceil(span / stepPx));
    var points = [];
    for (var i = 0; i <= count; i++) {
      points.push(point(mdl, from + ((to - from) * i) / count, incoming));
    }
    return points;
  }

  // Puntos de la trayectoria principal: plataforma → final.
  function path(mdl) {
    var ascent = [];
    for (var i = 0; i <= 14; i++) ascent.push(point(mdl, i / 14, false));
    return ascent.concat(sample(mdl, 1, mdl.tauEnd, false, 10).slice(1));
  }

  // Puntos de la rama de llegada (borde izquierdo → periapsis); vacío fuera de órbita.
  function incomingPath(mdl) {
    if (mdl.state !== "orbit") return [];
    return sample(mdl, mdl.tauStart, 1, true, 10);
  }

  function toPathData(points) {
    if (!points.length) return "";
    return (
      "M" +
      points
        .map(function (p) {
          return p[0].toFixed(1) + " " + p[1].toFixed(1);
        })
        .join("L")
    );
  }

  // Una décima con coma decimal, truncada en vez de redondeada: 79,96 bits no se
  // anuncian como "80,0" ni 11,19 km/s como "11,2" cuando aún no se ha escapado.
  function formatTenths(value) {
    return (Math.floor(value * 10 + 1e-6) / 10).toFixed(1).replace(".", ",");
  }

  App.flight = {
    formatTenths: formatTenths,
    V_ESCAPE: V_ESCAPE,
    V_ORBIT: V_ORBIT,
    BITS_ESCAPE: BITS_ESCAPE,
    KMS_PER_BIT: KMS_PER_BIT,
    velocity: velocity,
    stateOf: stateOf,
    frame: frame,
    toScreen: toScreen,
    model: model,
    point: point,
    path: path,
    incomingPath: incomingPath,
    toPathData: toPathData,
    smoothstep: smoothstep,
    clamp: clamp,
  };
})();
