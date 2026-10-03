/* Panel: configuración, contraseña en pantalla, portapapeles y persistencia.
   Solo se guarda la configuración; la contraseña nunca sale de la memoria de la página. */
(function () {
  "use strict";

  var App = window.EscapeVelocity;
  var gen = App.generator;
  var flight = App.flight;
  var STORE_KEY = "escape-velocity:v1";
  var GAUGE_MAX = flight.V_ESCAPE * 2;
  var EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

  var DEFAULTS = { length: 16, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false };
  var LABELS = { suborbital: "suborbital", orbit: "en órbita", escape: "escape" };
  var STATUS = {
    suborbital: "suborbital · vuelve a caer",
    orbit: "en órbita",
    escape: "velocidad de escape alcanzada",
  };
  var SCENE_TEXT = {
    suborbital: "sube y vuelve a caer sobre el planeta",
    orbit: "queda en órbita alrededor del planeta",
    escape: "escapa de la gravedad del planeta rumbo a Plutón",
  };

  var els = {
    status: document.getElementById("status"),
    stage: document.getElementById("stage"),
    sky: document.getElementById("sky"),
    password: document.getElementById("password"),
    state: document.getElementById("state"),
    bits: document.getElementById("bits"),
    speed: document.getElementById("speed"),
    alphabet: document.getElementById("alphabet"),
    length: document.getElementById("length"),
    lengthValue: document.getElementById("length-value"),
    ambiguous: document.getElementById("opt-ambiguous"),
    types: Array.prototype.slice.call(document.querySelectorAll(".opt-input[data-type]")),
    regen: document.getElementById("regen"),
    copy: document.getElementById("copy"),
    copyLabel: document.getElementById("copy-label"),
    announce: document.getElementById("announce"),
    gaugeFill: document.getElementById("gauge-fill"),
    gaugeNeedle: document.getElementById("gauge-needle"),
  };

  var password = "";
  var current = { bits: 0, v: 0, state: "suborbital" };
  var statusTimer = 0;
  var copyTimer = 0;
  var announceTimer = 0;

  /* ---------- persistencia ---------- */

  function load() {
    var config = {};
    var saved = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null");
    } catch (err) {
      saved = null;
    }
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};

    config.length = typeof saved.length === "number" ? gen.clampLength(saved.length) : DEFAULTS.length;
    gen.TYPES.concat("noAmbiguous").forEach(function (key) {
      config[key] = typeof saved[key] === "boolean" ? saved[key] : DEFAULTS[key];
    });
    // Una configuración guardada sin ningún tipo no sirve: vuelven los de fábrica.
    if (!gen.activeTypes(config).length) {
      gen.TYPES.forEach(function (type) {
        config[type] = DEFAULTS[type];
      });
    }
    return config;
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(config));
    } catch (err) {
      /* almacenamiento no disponible: el generador sigue funcionando */
    }
  }

  /* ---------- vista ---------- */

  function reduced() {
    return window.Pluton.reducedMotion();
  }

  function setStatus(label, text, isError) {
    els.status.textContent = label + ": ";
    var strong = document.createElement("b");
    strong.textContent = text;
    els.status.appendChild(strong);
    els.status.classList.toggle("is-error", Boolean(isError));
  }

  function flightStatus() {
    window.clearTimeout(statusTimer);
    setStatus("status", STATUS[current.state]);
  }

  // Aviso pasajero en la cabecera; luego vuelve el estado del vuelo.
  function flashStatus(label, text, isError) {
    window.clearTimeout(statusTimer);
    setStatus(label, text, isError);
    statusTimer = window.setTimeout(flightStatus, 2400);
  }

  function announce(text, delay) {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(function () {
      els.announce.textContent = text;
    }, delay || 0);
  }

  function resetCopy() {
    window.clearTimeout(copyTimer);
    els.copyLabel.textContent = "copiar";
  }

  // Cada carácter en su span, coloreado por tipo.
  function showPassword(animate) {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < password.length; i++) {
      var span = document.createElement("span");
      span.className = "c-" + gen.typeOf(password[i]);
      span.textContent = password[i];
      fragment.appendChild(span);
    }
    els.password.textContent = "";
    els.password.appendChild(fragment);

    var n = password.length;
    els.password.dataset.size = n <= 12 ? "l" : n <= 24 ? "m" : n <= 40 ? "s" : "xs";

    if (animate && els.password.animate) {
      els.password.animate(
        reduced()
          ? [{ opacity: 0.2 }, { opacity: 1 }]
          : [
              { opacity: 0.2, transform: "translateY(5px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
        { duration: 300, easing: EASE_OUT }
      );
    }
  }

  function showFlight() {
    var info = gen.entropy(config);
    var v = flight.velocity(info.bits);
    var state = flight.stateOf(v);
    var stateChanged = state !== current.state;
    current = { bits: info.bits, v: v, state: state };

    els.bits.textContent = flight.formatTenths(info.bits);
    els.speed.textContent = flight.formatTenths(v);
    els.alphabet.textContent = String(info.size);
    els.state.textContent = LABELS[state];
    els.state.dataset.state = state;

    var p = flight.clamp(v / GAUGE_MAX, 0, 1);
    els.gaugeFill.style.transform = "scaleX(" + p.toFixed(4) + ")";
    els.gaugeNeedle.style.transform = "translateX(" + ((p - 1) * 100).toFixed(2) + "%)";

    els.sky.setAttribute(
      "aria-label",
      "Trayectoria del cohete a " + flight.formatTenths(v) + " kilómetros por segundo: " + SCENE_TEXT[state]
    );
    if (stateChanged || !els.status.classList.contains("is-error")) flightStatus();
    scene.setVelocity(v);
  }

  function syncControls() {
    els.length.value = String(config.length);
    els.lengthValue.textContent = String(config.length);
    var span = gen.MAX_LENGTH - gen.MIN_LENGTH;
    els.length.style.setProperty("--fill", (((config.length - gen.MIN_LENGTH) / span) * 100).toFixed(2) + "%");
    els.types.forEach(function (input) {
      input.checked = config[input.dataset.type];
    });
    els.ambiguous.checked = config.noAmbiguous;
  }

  /* ---------- acciones ---------- */

  function generate(animate) {
    password = gen.generate(config);
    resetCopy();
    showPassword(animate);
    announce(
      "Contraseña nueva de " +
        password.length +
        " caracteres: " +
        flight.formatTenths(current.bits) +
        " bits de entropía, " +
        flight.formatTenths(current.v) +
        " kilómetros por segundo, " +
        LABELS[current.state],
      500
    );
  }

  // La configuración cambió: cifras, escena y contraseña nuevas.
  function update(animate) {
    syncControls();
    showFlight();
    generate(animate);
    save();
  }

  function shake(el) {
    if (!el.animate || reduced()) return;
    el.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 320, easing: "cubic-bezier(0.65, 0, 0.35, 1)" }
    );
  }

  // Copia de reserva para cuando navigator.clipboard no existe o se niega.
  function legacyCopy(text) {
    var active = document.activeElement;
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    area.remove();
    if (active && active.focus) active.focus({ preventScroll: true });
    return ok;
  }

  function copied(ok) {
    window.clearTimeout(copyTimer);
    if (ok) {
      els.copyLabel.textContent = "copiada";
      flashStatus("status", "copiada al portapapeles");
      announce("Contraseña copiada al portapapeles");
      copyTimer = window.setTimeout(resetCopy, 2400);
      return;
    }
    // Último recurso: dejarla seleccionada para copiarla a mano.
    var selection = window.getSelection();
    if (selection) {
      var range = document.createRange();
      range.selectNodeContents(els.password);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    flashStatus("aviso", "selecciónala y pulsa Ctrl+C", true);
    announce("No se pudo copiar automáticamente. La contraseña está seleccionada: pulsa Control más C.");
  }

  function copy() {
    var text = password;
    var fallback = function () {
      copied(legacyCopy(text));
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copied(true);
        }, fallback);
      } else {
        fallback();
      }
    } catch (err) {
      fallback();
    }
  }

  /* ---------- eventos ---------- */

  els.length.addEventListener("input", function () {
    config.length = gen.clampLength(els.length.value);
    update(false);
  });

  els.types.forEach(function (input) {
    input.addEventListener("change", function () {
      var type = input.dataset.type;
      config[type] = input.checked;
      // Sin ningún tipo no hay alfabeto: el último activo no se puede apagar.
      if (!gen.activeTypes(config).length) {
        config[type] = true;
        input.checked = true;
        shake(input.nextElementSibling);
        flashStatus("aviso", "hace falta al menos un tipo", true);
        announce("Hace falta al menos un tipo de carácter activo");
        return;
      }
      update(true);
    });
  });

  els.ambiguous.addEventListener("change", function () {
    config.noAmbiguous = els.ambiguous.checked;
    update(true);
  });

  els.regen.addEventListener("click", function () {
    generate(true);
    scene.relaunch();
  });

  els.copy.addEventListener("click", copy);

  /* ---------- arranque ---------- */

  var config = load();
  var scene = App.createScene({
    stage: els.stage,
    svg: els.sky,
    telemetry: document.getElementById("telemetry"),
  });

  App.scene = scene;

  syncControls();
  showFlight();
  generate(false);
})();
