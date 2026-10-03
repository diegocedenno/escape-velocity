/* Generador de contraseñas: alfabetos, azar sin sesgo y entropía.
   Toda la aleatoriedad sale de crypto.getRandomValues; aquí no hay Math.random
   ni DOM, así que el archivo se puede probar con Node. */
(function () {
  "use strict";

  var App = (window.EscapeVelocity = window.EscapeVelocity || {});

  var TYPES = ["lower", "upper", "digits", "symbols"];
  var SETS = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    // Sin comillas, espacios, barras invertidas ni "|": dan guerra en formularios y terminales.
    symbols: "!#$%&*+-=?@^_~.,:;()[]{}",
  };
  var AMBIGUOUS = "0O1lI";
  var MIN_LENGTH = 4;
  var MAX_LENGTH = 64;

  /* ---------- azar ---------- */

  var pool = new Uint32Array(64);
  var cursor = pool.length;

  function nextUint32() {
    if (cursor >= pool.length) {
      window.crypto.getRandomValues(pool);
      cursor = 0;
    }
    return pool[cursor++];
  }

  // Entero uniforme en [0, n). Un `% n` directo favorece a los valores bajos
  // cuando 2^32 no es múltiplo de n; se descarta la cola sobrante y se repite.
  function randomBelow(n) {
    var limit = Math.floor(4294967296 / n) * n;
    var value;
    do {
      value = nextUint32();
    } while (value >= limit);
    return value % n;
  }

  // Fisher–Yates con la misma fuente de azar.
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = randomBelow(i + 1);
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /* ---------- alfabetos ---------- */

  function charsOf(type, noAmbiguous) {
    var chars = SETS[type];
    if (!noAmbiguous) return chars;
    var out = "";
    for (var i = 0; i < chars.length; i++) {
      if (AMBIGUOUS.indexOf(chars[i]) === -1) out += chars[i];
    }
    return out;
  }

  function activeTypes(config) {
    return TYPES.filter(function (type) {
      return Boolean(config[type]);
    });
  }

  function alphabet(config) {
    return activeTypes(config)
      .map(function (type) {
        return charsOf(type, config.noAmbiguous);
      })
      .join("");
  }

  function typeOf(ch) {
    for (var i = 0; i < TYPES.length; i++) {
      if (SETS[TYPES[i]].indexOf(ch) !== -1) return TYPES[i];
    }
    return null;
  }

  /* ---------- contraseña ---------- */

  function clampLength(value) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) return 16;
    return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, n));
  }

  // Un carácter garantizado de cada tipo activo, el resto del alfabeto completo,
  // y al final se baraja para que los garantizados no queden siempre delante.
  function generate(config) {
    var types = activeTypes(config);
    if (!types.length) return "";
    var length = clampLength(config.length);
    var all = alphabet(config);
    var chars = [];

    types.forEach(function (type) {
      var set = charsOf(type, config.noAmbiguous);
      chars.push(set[randomBelow(set.length)]);
    });
    while (chars.length < length) chars.push(all[randomBelow(all.length)]);

    return shuffle(chars).join("");
  }

  // Entropía = longitud × log2(tamaño del alfabeto). Es la cota habitual: exigir
  // un carácter de cada tipo descarta algunas combinaciones (un cuarto de bit con
  // 16 caracteres, unos pocos bits con 4) y ese coste aquí no se descuenta.
  function entropy(config) {
    var size = alphabet(config).length;
    var length = clampLength(config.length);
    var perChar = size > 1 ? Math.log(size) / Math.LN2 : 0;
    return { bits: length * perChar, perChar: perChar, size: size, length: length };
  }

  App.generator = {
    TYPES: TYPES,
    SETS: SETS,
    AMBIGUOUS: AMBIGUOUS,
    MIN_LENGTH: MIN_LENGTH,
    MAX_LENGTH: MAX_LENGTH,
    randomBelow: randomBelow,
    shuffle: shuffle,
    charsOf: charsOf,
    activeTypes: activeTypes,
    alphabet: alphabet,
    typeOf: typeOf,
    clampLength: clampLength,
    generate: generate,
    entropy: entropy,
  };
})();
