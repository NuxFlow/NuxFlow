#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err2) => function __init() {
  if (err2) throw err2[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e3) {
    throw err2 = [e3], e3;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e3) {
    throw mod = 0, e3;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/sisteransi@1.0.5/node_modules/sisteransi/src/index.js
var require_src = __commonJS({
  "../../node_modules/.pnpm/sisteransi@1.0.5/node_modules/sisteransi/src/index.js"(exports2, module2) {
    "use strict";
    var ESC = "\x1B";
    var CSI = `${ESC}[`;
    var beep = "\x07";
    var cursor = {
      to(x4, y5) {
        if (!y5) return `${CSI}${x4 + 1}G`;
        return `${CSI}${y5 + 1};${x4 + 1}H`;
      },
      move(x4, y5) {
        let ret = "";
        if (x4 < 0) ret += `${CSI}${-x4}D`;
        else if (x4 > 0) ret += `${CSI}${x4}C`;
        if (y5 < 0) ret += `${CSI}${-y5}A`;
        else if (y5 > 0) ret += `${CSI}${y5}B`;
        return ret;
      },
      up: (count = 1) => `${CSI}${count}A`,
      down: (count = 1) => `${CSI}${count}B`,
      forward: (count = 1) => `${CSI}${count}C`,
      backward: (count = 1) => `${CSI}${count}D`,
      nextLine: (count = 1) => `${CSI}E`.repeat(count),
      prevLine: (count = 1) => `${CSI}F`.repeat(count),
      left: `${CSI}G`,
      hide: `${CSI}?25l`,
      show: `${CSI}?25h`,
      save: `${ESC}7`,
      restore: `${ESC}8`
    };
    var scroll = {
      up: (count = 1) => `${CSI}S`.repeat(count),
      down: (count = 1) => `${CSI}T`.repeat(count)
    };
    var erase = {
      screen: `${CSI}2J`,
      up: (count = 1) => `${CSI}1J`.repeat(count),
      down: (count = 1) => `${CSI}J`.repeat(count),
      line: `${CSI}2K`,
      lineEnd: `${CSI}K`,
      lineStart: `${CSI}1K`,
      lines(count) {
        let clear = "";
        for (let i3 = 0; i3 < count; i3++)
          clear += this.line + (i3 < count - 1 ? cursor.up() : "");
        if (count)
          clear += cursor.left;
        return clear;
      }
    };
    module2.exports = { cursor, scroll, erase, beep };
  }
});

// ../../node_modules/.pnpm/picocolors@1.1.1/node_modules/picocolors/picocolors.js
var require_picocolors = __commonJS({
  "../../node_modules/.pnpm/picocolors@1.1.1/node_modules/picocolors/picocolors.js"(exports2, module2) {
    var p2 = process || {};
    var argv2 = p2.argv || [];
    var env2 = p2.env || {};
    var isColorSupported2 = !(!!env2.NO_COLOR || argv2.includes("--no-color")) && (!!env2.FORCE_COLOR || argv2.includes("--color") || p2.platform === "win32" || (p2.stdout || {}).isTTY && env2.TERM !== "dumb" || !!env2.CI);
    var formatter = (open, close, replace = open) => (input) => {
      let string = "" + input, index = string.indexOf(close, open.length);
      return ~index ? open + replaceClose2(string, close, replace, index) + close : open + string + close;
    };
    var replaceClose2 = (string, close, replace, index) => {
      let result = "", cursor = 0;
      do {
        result += string.substring(cursor, index) + replace;
        cursor = index + close.length;
        index = string.indexOf(close, cursor);
      } while (~index);
      return result + string.substring(cursor);
    };
    var createColors2 = (enabled = isColorSupported2) => {
      let f4 = enabled ? formatter : () => String;
      return {
        isColorSupported: enabled,
        reset: f4("\x1B[0m", "\x1B[0m"),
        bold: f4("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
        dim: f4("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
        italic: f4("\x1B[3m", "\x1B[23m"),
        underline: f4("\x1B[4m", "\x1B[24m"),
        inverse: f4("\x1B[7m", "\x1B[27m"),
        hidden: f4("\x1B[8m", "\x1B[28m"),
        strikethrough: f4("\x1B[9m", "\x1B[29m"),
        black: f4("\x1B[30m", "\x1B[39m"),
        red: f4("\x1B[31m", "\x1B[39m"),
        green: f4("\x1B[32m", "\x1B[39m"),
        yellow: f4("\x1B[33m", "\x1B[39m"),
        blue: f4("\x1B[34m", "\x1B[39m"),
        magenta: f4("\x1B[35m", "\x1B[39m"),
        cyan: f4("\x1B[36m", "\x1B[39m"),
        white: f4("\x1B[37m", "\x1B[39m"),
        gray: f4("\x1B[90m", "\x1B[39m"),
        bgBlack: f4("\x1B[40m", "\x1B[49m"),
        bgRed: f4("\x1B[41m", "\x1B[49m"),
        bgGreen: f4("\x1B[42m", "\x1B[49m"),
        bgYellow: f4("\x1B[43m", "\x1B[49m"),
        bgBlue: f4("\x1B[44m", "\x1B[49m"),
        bgMagenta: f4("\x1B[45m", "\x1B[49m"),
        bgCyan: f4("\x1B[46m", "\x1B[49m"),
        bgWhite: f4("\x1B[47m", "\x1B[49m"),
        blackBright: f4("\x1B[90m", "\x1B[39m"),
        redBright: f4("\x1B[91m", "\x1B[39m"),
        greenBright: f4("\x1B[92m", "\x1B[39m"),
        yellowBright: f4("\x1B[93m", "\x1B[39m"),
        blueBright: f4("\x1B[94m", "\x1B[39m"),
        magentaBright: f4("\x1B[95m", "\x1B[39m"),
        cyanBright: f4("\x1B[96m", "\x1B[39m"),
        whiteBright: f4("\x1B[97m", "\x1B[39m"),
        bgBlackBright: f4("\x1B[100m", "\x1B[49m"),
        bgRedBright: f4("\x1B[101m", "\x1B[49m"),
        bgGreenBright: f4("\x1B[102m", "\x1B[49m"),
        bgYellowBright: f4("\x1B[103m", "\x1B[49m"),
        bgBlueBright: f4("\x1B[104m", "\x1B[49m"),
        bgMagentaBright: f4("\x1B[105m", "\x1B[49m"),
        bgCyanBright: f4("\x1B[106m", "\x1B[49m"),
        bgWhiteBright: f4("\x1B[107m", "\x1B[49m")
      };
    };
    module2.exports = createColors2();
    module2.exports.createColors = createColors2;
  }
});

// ../../node_modules/.pnpm/consola@3.4.2/node_modules/consola/dist/chunks/prompt.mjs
var prompt_exports = {};
__export(prompt_exports, {
  kCancel: () => kCancel,
  prompt: () => prompt
});
function getDefaultExportFromCjs(x4) {
  return x4 && x4.__esModule && Object.prototype.hasOwnProperty.call(x4, "default") ? x4["default"] : x4;
}
function requireSrc() {
  if (hasRequiredSrc) return src;
  hasRequiredSrc = 1;
  const ESC = "\x1B";
  const CSI = `${ESC}[`;
  const beep = "\x07";
  const cursor = {
    to(x4, y5) {
      if (!y5) return `${CSI}${x4 + 1}G`;
      return `${CSI}${y5 + 1};${x4 + 1}H`;
    },
    move(x4, y5) {
      let ret = "";
      if (x4 < 0) ret += `${CSI}${-x4}D`;
      else if (x4 > 0) ret += `${CSI}${x4}C`;
      if (y5 < 0) ret += `${CSI}${-y5}A`;
      else if (y5 > 0) ret += `${CSI}${y5}B`;
      return ret;
    },
    up: (count = 1) => `${CSI}${count}A`,
    down: (count = 1) => `${CSI}${count}B`,
    forward: (count = 1) => `${CSI}${count}C`,
    backward: (count = 1) => `${CSI}${count}D`,
    nextLine: (count = 1) => `${CSI}E`.repeat(count),
    prevLine: (count = 1) => `${CSI}F`.repeat(count),
    left: `${CSI}G`,
    hide: `${CSI}?25l`,
    show: `${CSI}?25h`,
    save: `${ESC}7`,
    restore: `${ESC}8`
  };
  const scroll = {
    up: (count = 1) => `${CSI}S`.repeat(count),
    down: (count = 1) => `${CSI}T`.repeat(count)
  };
  const erase = {
    screen: `${CSI}2J`,
    up: (count = 1) => `${CSI}1J`.repeat(count),
    down: (count = 1) => `${CSI}J`.repeat(count),
    line: `${CSI}2K`,
    lineEnd: `${CSI}K`,
    lineStart: `${CSI}1K`,
    lines(count) {
      let clear = "";
      for (let i3 = 0; i3 < count; i3++)
        clear += this.line + (i3 < count - 1 ? cursor.up() : "");
      if (count)
        clear += cursor.left;
      return clear;
    }
  };
  src = { cursor, scroll, erase, beep };
  return src;
}
function requirePicocolors() {
  if (hasRequiredPicocolors) return picocolors.exports;
  hasRequiredPicocolors = 1;
  let p2 = process || {}, argv2 = p2.argv || [], env2 = p2.env || {};
  let isColorSupported2 = !(!!env2.NO_COLOR || argv2.includes("--no-color")) && (!!env2.FORCE_COLOR || argv2.includes("--color") || p2.platform === "win32" || (p2.stdout || {}).isTTY && env2.TERM !== "dumb" || !!env2.CI);
  let formatter = (open, close, replace = open) => (input) => {
    let string = "" + input, index = string.indexOf(close, open.length);
    return ~index ? open + replaceClose2(string, close, replace, index) + close : open + string + close;
  };
  let replaceClose2 = (string, close, replace, index) => {
    let result = "", cursor = 0;
    do {
      result += string.substring(cursor, index) + replace;
      cursor = index + close.length;
      index = string.indexOf(close, cursor);
    } while (~index);
    return result + string.substring(cursor);
  };
  let createColors2 = (enabled = isColorSupported2) => {
    let f4 = enabled ? formatter : () => String;
    return {
      isColorSupported: enabled,
      reset: f4("\x1B[0m", "\x1B[0m"),
      bold: f4("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
      dim: f4("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
      italic: f4("\x1B[3m", "\x1B[23m"),
      underline: f4("\x1B[4m", "\x1B[24m"),
      inverse: f4("\x1B[7m", "\x1B[27m"),
      hidden: f4("\x1B[8m", "\x1B[28m"),
      strikethrough: f4("\x1B[9m", "\x1B[29m"),
      black: f4("\x1B[30m", "\x1B[39m"),
      red: f4("\x1B[31m", "\x1B[39m"),
      green: f4("\x1B[32m", "\x1B[39m"),
      yellow: f4("\x1B[33m", "\x1B[39m"),
      blue: f4("\x1B[34m", "\x1B[39m"),
      magenta: f4("\x1B[35m", "\x1B[39m"),
      cyan: f4("\x1B[36m", "\x1B[39m"),
      white: f4("\x1B[37m", "\x1B[39m"),
      gray: f4("\x1B[90m", "\x1B[39m"),
      bgBlack: f4("\x1B[40m", "\x1B[49m"),
      bgRed: f4("\x1B[41m", "\x1B[49m"),
      bgGreen: f4("\x1B[42m", "\x1B[49m"),
      bgYellow: f4("\x1B[43m", "\x1B[49m"),
      bgBlue: f4("\x1B[44m", "\x1B[49m"),
      bgMagenta: f4("\x1B[45m", "\x1B[49m"),
      bgCyan: f4("\x1B[46m", "\x1B[49m"),
      bgWhite: f4("\x1B[47m", "\x1B[49m"),
      blackBright: f4("\x1B[90m", "\x1B[39m"),
      redBright: f4("\x1B[91m", "\x1B[39m"),
      greenBright: f4("\x1B[92m", "\x1B[39m"),
      yellowBright: f4("\x1B[93m", "\x1B[39m"),
      blueBright: f4("\x1B[94m", "\x1B[39m"),
      magentaBright: f4("\x1B[95m", "\x1B[39m"),
      cyanBright: f4("\x1B[96m", "\x1B[39m"),
      whiteBright: f4("\x1B[97m", "\x1B[39m"),
      bgBlackBright: f4("\x1B[100m", "\x1B[49m"),
      bgRedBright: f4("\x1B[101m", "\x1B[49m"),
      bgGreenBright: f4("\x1B[102m", "\x1B[49m"),
      bgYellowBright: f4("\x1B[103m", "\x1B[49m"),
      bgBlueBright: f4("\x1B[104m", "\x1B[49m"),
      bgMagentaBright: f4("\x1B[105m", "\x1B[49m"),
      bgCyanBright: f4("\x1B[106m", "\x1B[49m"),
      bgWhiteBright: f4("\x1B[107m", "\x1B[49m")
    };
  };
  picocolors.exports = createColors2();
  picocolors.exports.createColors = createColors2;
  return picocolors.exports;
}
function J2({ onlyFirst: t2 = false } = {}) {
  const F3 = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"].join("|");
  return new RegExp(F3, t2 ? void 0 : "g");
}
function T$1(t2) {
  if (typeof t2 != "string") throw new TypeError(`Expected a \`string\`, got \`${typeof t2}\``);
  return t2.replace(Q2, "");
}
function O2(t2) {
  return t2 && t2.__esModule && Object.prototype.hasOwnProperty.call(t2, "default") ? t2.default : t2;
}
function A$1(t2, u4 = {}) {
  if (typeof t2 != "string" || t2.length === 0 || (u4 = { ambiguousIsNarrow: true, ...u4 }, t2 = T$1(t2), t2.length === 0)) return 0;
  t2 = t2.replace(FD2(), "  ");
  const F3 = u4.ambiguousIsNarrow ? 1 : 2;
  let e3 = 0;
  for (const s2 of t2) {
    const i3 = s2.codePointAt(0);
    if (i3 <= 31 || i3 >= 127 && i3 <= 159 || i3 >= 768 && i3 <= 879) continue;
    switch (DD2.eastAsianWidth(s2)) {
      case "F":
      case "W":
        e3 += 2;
        break;
      case "A":
        e3 += F3;
        break;
      default:
        e3 += 1;
    }
  }
  return e3;
}
function sD2() {
  const t2 = /* @__PURE__ */ new Map();
  for (const [u4, F3] of Object.entries(r2)) {
    for (const [e3, s2] of Object.entries(F3)) r2[e3] = { open: `\x1B[${s2[0]}m`, close: `\x1B[${s2[1]}m` }, F3[e3] = r2[e3], t2.set(s2[0], s2[1]);
    Object.defineProperty(r2, u4, { value: F3, enumerable: false });
  }
  return Object.defineProperty(r2, "codes", { value: t2, enumerable: false }), r2.color.close = "\x1B[39m", r2.bgColor.close = "\x1B[49m", r2.color.ansi = L$1(), r2.color.ansi256 = N3(), r2.color.ansi16m = I2(), r2.bgColor.ansi = L$1(m3), r2.bgColor.ansi256 = N3(m3), r2.bgColor.ansi16m = I2(m3), Object.defineProperties(r2, { rgbToAnsi256: { value: (u4, F3, e3) => u4 === F3 && F3 === e3 ? u4 < 8 ? 16 : u4 > 248 ? 231 : Math.round((u4 - 8) / 247 * 24) + 232 : 16 + 36 * Math.round(u4 / 255 * 5) + 6 * Math.round(F3 / 255 * 5) + Math.round(e3 / 255 * 5), enumerable: false }, hexToRgb: { value: (u4) => {
    const F3 = /[a-f\d]{6}|[a-f\d]{3}/i.exec(u4.toString(16));
    if (!F3) return [0, 0, 0];
    let [e3] = F3;
    e3.length === 3 && (e3 = [...e3].map((i3) => i3 + i3).join(""));
    const s2 = Number.parseInt(e3, 16);
    return [s2 >> 16 & 255, s2 >> 8 & 255, s2 & 255];
  }, enumerable: false }, hexToAnsi256: { value: (u4) => r2.rgbToAnsi256(...r2.hexToRgb(u4)), enumerable: false }, ansi256ToAnsi: { value: (u4) => {
    if (u4 < 8) return 30 + u4;
    if (u4 < 16) return 90 + (u4 - 8);
    let F3, e3, s2;
    if (u4 >= 232) F3 = ((u4 - 232) * 10 + 8) / 255, e3 = F3, s2 = F3;
    else {
      u4 -= 16;
      const C3 = u4 % 36;
      F3 = Math.floor(u4 / 36) / 5, e3 = Math.floor(C3 / 6) / 5, s2 = C3 % 6 / 5;
    }
    const i3 = Math.max(F3, e3, s2) * 2;
    if (i3 === 0) return 30;
    let D2 = 30 + (Math.round(s2) << 2 | Math.round(e3) << 1 | Math.round(F3));
    return i3 === 2 && (D2 += 60), D2;
  }, enumerable: false }, rgbToAnsi: { value: (u4, F3, e3) => r2.ansi256ToAnsi(r2.rgbToAnsi256(u4, F3, e3)), enumerable: false }, hexToAnsi: { value: (u4) => r2.ansi256ToAnsi(r2.hexToAnsi256(u4)), enumerable: false } }), r2;
}
function G3(t2, u4, F3) {
  return String(t2).normalize().replace(/\r\n/g, `
`).split(`
`).map((e3) => oD2(e3, u4, F3)).join(`
`);
}
function k$1(t2, u4) {
  if (typeof t2 == "string") return c2.aliases.get(t2) === u4;
  for (const F3 of t2) if (F3 !== void 0 && k$1(F3, u4)) return true;
  return false;
}
function lD2(t2, u4) {
  if (t2 === u4) return;
  const F3 = t2.split(`
`), e3 = u4.split(`
`), s2 = [];
  for (let i3 = 0; i3 < Math.max(F3.length, e3.length); i3++) F3[i3] !== e3[i3] && s2.push(i3);
  return s2;
}
function d$1(t2, u4) {
  const F3 = t2;
  F3.isTTY && F3.setRawMode(u4);
}
function ce2() {
  return import_node_process3.default.platform !== "win32" ? import_node_process3.default.env.TERM !== "linux" : !!import_node_process3.default.env.CI || !!import_node_process3.default.env.WT_SESSION || !!import_node_process3.default.env.TERMINUS_SUBLIME || import_node_process3.default.env.ConEmuTask === "{cmd::Cmder}" || import_node_process3.default.env.TERM_PROGRAM === "Terminus-Sublime" || import_node_process3.default.env.TERM_PROGRAM === "vscode" || import_node_process3.default.env.TERM === "xterm-256color" || import_node_process3.default.env.TERM === "alacritty" || import_node_process3.default.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
async function prompt(message, opts = {}) {
  const handleCancel = (value) => {
    if (typeof value !== "symbol" || value.toString() !== "Symbol(clack:cancel)") {
      return value;
    }
    switch (opts.cancel) {
      case "reject": {
        const error = new Error("Prompt cancelled.");
        error.name = "ConsolaPromptCancelledError";
        if (Error.captureStackTrace) {
          Error.captureStackTrace(error, prompt);
        }
        throw error;
      }
      case "undefined": {
        return void 0;
      }
      case "null": {
        return null;
      }
      case "symbol": {
        return kCancel;
      }
      default:
      case "default": {
        return opts.default ?? opts.initial;
      }
    }
  };
  if (!opts.type || opts.type === "text") {
    return await he({
      message,
      defaultValue: opts.default,
      placeholder: opts.placeholder,
      initialValue: opts.initial
    }).then(handleCancel);
  }
  if (opts.type === "confirm") {
    return await ye({
      message,
      initialValue: opts.initial
    }).then(handleCancel);
  }
  if (opts.type === "select") {
    return await ve({
      message,
      options: opts.options.map(
        (o3) => typeof o3 === "string" ? { value: o3, label: o3 } : o3
      ),
      initialValue: opts.initial
    }).then(handleCancel);
  }
  if (opts.type === "multiselect") {
    return await fe2({
      message,
      options: opts.options.map(
        (o3) => typeof o3 === "string" ? { value: o3, label: o3 } : o3
      ),
      required: opts.required,
      initialValues: opts.initial
    }).then(handleCancel);
  }
  throw new Error(`Unknown prompt type: ${opts.type}`);
}
var import_node_process3, import_node_readline2, import_node_tty2, src, hasRequiredSrc, srcExports, picocolors, hasRequiredPicocolors, picocolorsExports, e2, Q2, P$1, X3, DD2, uD2, FD2, m3, L$1, N3, I2, r2, tD2, eD2, iD2, v2, CD2, w$1, W$1, rD2, R3, y3, V$1, z2, ED2, _2, nD2, oD2, aD2, c2, S3, AD2, pD2, h2, x2, fD2, bD, mD, Y, wD2, SD, $D, q, jD2, PD2, V3, u2, le2, L3, W2, C, o, d2, k2, P2, A3, T2, F, w2, B2, he, ye, ve, fe2, kCancel;
var init_prompt = __esm({
  "../../node_modules/.pnpm/consola@3.4.2/node_modules/consola/dist/chunks/prompt.mjs"() {
    import_node_process3 = __toESM(require("node:process"), 1);
    import_node_readline2 = __toESM(require("node:readline"), 1);
    import_node_tty2 = require("node:tty");
    srcExports = requireSrc();
    picocolors = { exports: {} };
    picocolorsExports = /* @__PURE__ */ requirePicocolors();
    e2 = /* @__PURE__ */ getDefaultExportFromCjs(picocolorsExports);
    Q2 = J2();
    P$1 = { exports: {} };
    (function(t2) {
      var u4 = {};
      t2.exports = u4, u4.eastAsianWidth = function(e3) {
        var s2 = e3.charCodeAt(0), i3 = e3.length == 2 ? e3.charCodeAt(1) : 0, D2 = s2;
        return 55296 <= s2 && s2 <= 56319 && 56320 <= i3 && i3 <= 57343 && (s2 &= 1023, i3 &= 1023, D2 = s2 << 10 | i3, D2 += 65536), D2 == 12288 || 65281 <= D2 && D2 <= 65376 || 65504 <= D2 && D2 <= 65510 ? "F" : D2 == 8361 || 65377 <= D2 && D2 <= 65470 || 65474 <= D2 && D2 <= 65479 || 65482 <= D2 && D2 <= 65487 || 65490 <= D2 && D2 <= 65495 || 65498 <= D2 && D2 <= 65500 || 65512 <= D2 && D2 <= 65518 ? "H" : 4352 <= D2 && D2 <= 4447 || 4515 <= D2 && D2 <= 4519 || 4602 <= D2 && D2 <= 4607 || 9001 <= D2 && D2 <= 9002 || 11904 <= D2 && D2 <= 11929 || 11931 <= D2 && D2 <= 12019 || 12032 <= D2 && D2 <= 12245 || 12272 <= D2 && D2 <= 12283 || 12289 <= D2 && D2 <= 12350 || 12353 <= D2 && D2 <= 12438 || 12441 <= D2 && D2 <= 12543 || 12549 <= D2 && D2 <= 12589 || 12593 <= D2 && D2 <= 12686 || 12688 <= D2 && D2 <= 12730 || 12736 <= D2 && D2 <= 12771 || 12784 <= D2 && D2 <= 12830 || 12832 <= D2 && D2 <= 12871 || 12880 <= D2 && D2 <= 13054 || 13056 <= D2 && D2 <= 19903 || 19968 <= D2 && D2 <= 42124 || 42128 <= D2 && D2 <= 42182 || 43360 <= D2 && D2 <= 43388 || 44032 <= D2 && D2 <= 55203 || 55216 <= D2 && D2 <= 55238 || 55243 <= D2 && D2 <= 55291 || 63744 <= D2 && D2 <= 64255 || 65040 <= D2 && D2 <= 65049 || 65072 <= D2 && D2 <= 65106 || 65108 <= D2 && D2 <= 65126 || 65128 <= D2 && D2 <= 65131 || 110592 <= D2 && D2 <= 110593 || 127488 <= D2 && D2 <= 127490 || 127504 <= D2 && D2 <= 127546 || 127552 <= D2 && D2 <= 127560 || 127568 <= D2 && D2 <= 127569 || 131072 <= D2 && D2 <= 194367 || 177984 <= D2 && D2 <= 196605 || 196608 <= D2 && D2 <= 262141 ? "W" : 32 <= D2 && D2 <= 126 || 162 <= D2 && D2 <= 163 || 165 <= D2 && D2 <= 166 || D2 == 172 || D2 == 175 || 10214 <= D2 && D2 <= 10221 || 10629 <= D2 && D2 <= 10630 ? "Na" : D2 == 161 || D2 == 164 || 167 <= D2 && D2 <= 168 || D2 == 170 || 173 <= D2 && D2 <= 174 || 176 <= D2 && D2 <= 180 || 182 <= D2 && D2 <= 186 || 188 <= D2 && D2 <= 191 || D2 == 198 || D2 == 208 || 215 <= D2 && D2 <= 216 || 222 <= D2 && D2 <= 225 || D2 == 230 || 232 <= D2 && D2 <= 234 || 236 <= D2 && D2 <= 237 || D2 == 240 || 242 <= D2 && D2 <= 243 || 247 <= D2 && D2 <= 250 || D2 == 252 || D2 == 254 || D2 == 257 || D2 == 273 || D2 == 275 || D2 == 283 || 294 <= D2 && D2 <= 295 || D2 == 299 || 305 <= D2 && D2 <= 307 || D2 == 312 || 319 <= D2 && D2 <= 322 || D2 == 324 || 328 <= D2 && D2 <= 331 || D2 == 333 || 338 <= D2 && D2 <= 339 || 358 <= D2 && D2 <= 359 || D2 == 363 || D2 == 462 || D2 == 464 || D2 == 466 || D2 == 468 || D2 == 470 || D2 == 472 || D2 == 474 || D2 == 476 || D2 == 593 || D2 == 609 || D2 == 708 || D2 == 711 || 713 <= D2 && D2 <= 715 || D2 == 717 || D2 == 720 || 728 <= D2 && D2 <= 731 || D2 == 733 || D2 == 735 || 768 <= D2 && D2 <= 879 || 913 <= D2 && D2 <= 929 || 931 <= D2 && D2 <= 937 || 945 <= D2 && D2 <= 961 || 963 <= D2 && D2 <= 969 || D2 == 1025 || 1040 <= D2 && D2 <= 1103 || D2 == 1105 || D2 == 8208 || 8211 <= D2 && D2 <= 8214 || 8216 <= D2 && D2 <= 8217 || 8220 <= D2 && D2 <= 8221 || 8224 <= D2 && D2 <= 8226 || 8228 <= D2 && D2 <= 8231 || D2 == 8240 || 8242 <= D2 && D2 <= 8243 || D2 == 8245 || D2 == 8251 || D2 == 8254 || D2 == 8308 || D2 == 8319 || 8321 <= D2 && D2 <= 8324 || D2 == 8364 || D2 == 8451 || D2 == 8453 || D2 == 8457 || D2 == 8467 || D2 == 8470 || 8481 <= D2 && D2 <= 8482 || D2 == 8486 || D2 == 8491 || 8531 <= D2 && D2 <= 8532 || 8539 <= D2 && D2 <= 8542 || 8544 <= D2 && D2 <= 8555 || 8560 <= D2 && D2 <= 8569 || D2 == 8585 || 8592 <= D2 && D2 <= 8601 || 8632 <= D2 && D2 <= 8633 || D2 == 8658 || D2 == 8660 || D2 == 8679 || D2 == 8704 || 8706 <= D2 && D2 <= 8707 || 8711 <= D2 && D2 <= 8712 || D2 == 8715 || D2 == 8719 || D2 == 8721 || D2 == 8725 || D2 == 8730 || 8733 <= D2 && D2 <= 8736 || D2 == 8739 || D2 == 8741 || 8743 <= D2 && D2 <= 8748 || D2 == 8750 || 8756 <= D2 && D2 <= 8759 || 8764 <= D2 && D2 <= 8765 || D2 == 8776 || D2 == 8780 || D2 == 8786 || 8800 <= D2 && D2 <= 8801 || 8804 <= D2 && D2 <= 8807 || 8810 <= D2 && D2 <= 8811 || 8814 <= D2 && D2 <= 8815 || 8834 <= D2 && D2 <= 8835 || 8838 <= D2 && D2 <= 8839 || D2 == 8853 || D2 == 8857 || D2 == 8869 || D2 == 8895 || D2 == 8978 || 9312 <= D2 && D2 <= 9449 || 9451 <= D2 && D2 <= 9547 || 9552 <= D2 && D2 <= 9587 || 9600 <= D2 && D2 <= 9615 || 9618 <= D2 && D2 <= 9621 || 9632 <= D2 && D2 <= 9633 || 9635 <= D2 && D2 <= 9641 || 9650 <= D2 && D2 <= 9651 || 9654 <= D2 && D2 <= 9655 || 9660 <= D2 && D2 <= 9661 || 9664 <= D2 && D2 <= 9665 || 9670 <= D2 && D2 <= 9672 || D2 == 9675 || 9678 <= D2 && D2 <= 9681 || 9698 <= D2 && D2 <= 9701 || D2 == 9711 || 9733 <= D2 && D2 <= 9734 || D2 == 9737 || 9742 <= D2 && D2 <= 9743 || 9748 <= D2 && D2 <= 9749 || D2 == 9756 || D2 == 9758 || D2 == 9792 || D2 == 9794 || 9824 <= D2 && D2 <= 9825 || 9827 <= D2 && D2 <= 9829 || 9831 <= D2 && D2 <= 9834 || 9836 <= D2 && D2 <= 9837 || D2 == 9839 || 9886 <= D2 && D2 <= 9887 || 9918 <= D2 && D2 <= 9919 || 9924 <= D2 && D2 <= 9933 || 9935 <= D2 && D2 <= 9953 || D2 == 9955 || 9960 <= D2 && D2 <= 9983 || D2 == 10045 || D2 == 10071 || 10102 <= D2 && D2 <= 10111 || 11093 <= D2 && D2 <= 11097 || 12872 <= D2 && D2 <= 12879 || 57344 <= D2 && D2 <= 63743 || 65024 <= D2 && D2 <= 65039 || D2 == 65533 || 127232 <= D2 && D2 <= 127242 || 127248 <= D2 && D2 <= 127277 || 127280 <= D2 && D2 <= 127337 || 127344 <= D2 && D2 <= 127386 || 917760 <= D2 && D2 <= 917999 || 983040 <= D2 && D2 <= 1048573 || 1048576 <= D2 && D2 <= 1114109 ? "A" : "N";
      }, u4.characterLength = function(e3) {
        var s2 = this.eastAsianWidth(e3);
        return s2 == "F" || s2 == "W" || s2 == "A" ? 2 : 1;
      };
      function F3(e3) {
        return e3.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]/g) || [];
      }
      u4.length = function(e3) {
        for (var s2 = F3(e3), i3 = 0, D2 = 0; D2 < s2.length; D2++) i3 = i3 + this.characterLength(s2[D2]);
        return i3;
      }, u4.slice = function(e3, s2, i3) {
        textLen = u4.length(e3), s2 = s2 || 0, i3 = i3 || 1, s2 < 0 && (s2 = textLen + s2), i3 < 0 && (i3 = textLen + i3);
        for (var D2 = "", C3 = 0, o3 = F3(e3), E2 = 0; E2 < o3.length; E2++) {
          var a3 = o3[E2], n2 = u4.length(a3);
          if (C3 >= s2 - (n2 == 2 ? 1 : 0)) if (C3 + n2 <= i3) D2 += a3;
          else break;
          C3 += n2;
        }
        return D2;
      };
    })(P$1);
    X3 = P$1.exports;
    DD2 = O2(X3);
    uD2 = function() {
      return /\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67)\uDB40\uDC7F|(?:\uD83E\uDDD1\uD83C\uDFFF\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFE])|(?:\uD83E\uDDD1\uD83C\uDFFE\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFD\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFC\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFB\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFC-\uDFFF])|\uD83D\uDC68(?:\uD83C\uDFFB(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFC-\uDFFF])|[\u2695\u2696\u2708]\uFE0F|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))?|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFE])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])\uFE0F|\u200D(?:(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D[\uDC66\uDC67])|\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC)?|(?:\uD83D\uDC69(?:\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69]))|\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1)(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC69(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83E\uDDD1(?:\u200D(?:\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83D\uDC69\u200D\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D\uDC69\u200D\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83E\uDDD1(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDC69(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDE36\u200D\uD83C\uDF2B|\uD83C\uDFF3\uFE0F\u200D\u26A7|\uD83D\uDC3B\u200D\u2744|(?:(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF])\u200D[\u2640\u2642]|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|\uD83C\uDFF4\u200D\u2620|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])\u200D[\u2640\u2642]|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u2600-\u2604\u260E\u2611\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26B0\u26B1\u26C8\u26CF\u26D1\u26D3\u26E9\u26F0\u26F1\u26F4\u26F7\u26F8\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u3030\u303D\u3297\u3299]|\uD83C[\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]|\uD83D[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3])\uFE0F|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|\uD83D\uDC69\u200D\uD83D\uDC67|\uD83D\uDC69\u200D\uD83D\uDC66|\uD83D\uDE35\u200D\uD83D\uDCAB|\uD83D\uDE2E\u200D\uD83D\uDCA8|\uD83D\uDC15\u200D\uD83E\uDDBA|\uD83E\uDDD1(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83D\uDC69(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF6\uD83C\uDDE6|\uD83C\uDDF4\uD83C\uDDF2|\uD83D\uDC08\u200D\u2B1B|\u2764\uFE0F\u200D(?:\uD83D\uDD25|\uD83E\uDE79)|\uD83D\uDC41\uFE0F|\uD83C\uDFF3\uFE0F|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|[#\*0-9]\uFE0F\u20E3|\u2764\uFE0F|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|\uD83C\uDFF4|(?:[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270C\u270D]|\uD83D[\uDD74\uDD90])(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC08\uDC15\uDC3B\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE2E\uDE35\uDE36\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5]|\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD]|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF]|[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0D\uDD0E\uDD10-\uDD17\uDD1D\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78\uDD7A-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCB\uDDD0\uDDE0-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6]|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26A7\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDED5-\uDED7\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])\uFE0F|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDC8F\uDC91\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1F\uDD26\uDD30-\uDD39\uDD3C-\uDD3E\uDD77\uDDB5\uDDB6\uDDB8\uDDB9\uDDBB\uDDCD-\uDDCF\uDDD1-\uDDDD])/g;
    };
    FD2 = O2(uD2);
    m3 = 10;
    L$1 = (t2 = 0) => (u4) => `\x1B[${u4 + t2}m`;
    N3 = (t2 = 0) => (u4) => `\x1B[${38 + t2};5;${u4}m`;
    I2 = (t2 = 0) => (u4, F3, e3) => `\x1B[${38 + t2};2;${u4};${F3};${e3}m`;
    r2 = { modifier: { reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], overline: [53, 55], inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29] }, color: { black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], blackBright: [90, 39], gray: [90, 39], grey: [90, 39], redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39], blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39] }, bgColor: { bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49], bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49], bgBlackBright: [100, 49], bgGray: [100, 49], bgGrey: [100, 49], bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49], bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49], bgWhiteBright: [107, 49] } };
    Object.keys(r2.modifier);
    tD2 = Object.keys(r2.color);
    eD2 = Object.keys(r2.bgColor);
    [...tD2, ...eD2];
    iD2 = sD2();
    v2 = /* @__PURE__ */ new Set(["\x1B", "\x9B"]);
    CD2 = 39;
    w$1 = "\x07";
    W$1 = "[";
    rD2 = "]";
    R3 = "m";
    y3 = `${rD2}8;;`;
    V$1 = (t2) => `${v2.values().next().value}${W$1}${t2}${R3}`;
    z2 = (t2) => `${v2.values().next().value}${y3}${t2}${w$1}`;
    ED2 = (t2) => t2.split(" ").map((u4) => A$1(u4));
    _2 = (t2, u4, F3) => {
      const e3 = [...u4];
      let s2 = false, i3 = false, D2 = A$1(T$1(t2[t2.length - 1]));
      for (const [C3, o3] of e3.entries()) {
        const E2 = A$1(o3);
        if (D2 + E2 <= F3 ? t2[t2.length - 1] += o3 : (t2.push(o3), D2 = 0), v2.has(o3) && (s2 = true, i3 = e3.slice(C3 + 1).join("").startsWith(y3)), s2) {
          i3 ? o3 === w$1 && (s2 = false, i3 = false) : o3 === R3 && (s2 = false);
          continue;
        }
        D2 += E2, D2 === F3 && C3 < e3.length - 1 && (t2.push(""), D2 = 0);
      }
      !D2 && t2[t2.length - 1].length > 0 && t2.length > 1 && (t2[t2.length - 2] += t2.pop());
    };
    nD2 = (t2) => {
      const u4 = t2.split(" ");
      let F3 = u4.length;
      for (; F3 > 0 && !(A$1(u4[F3 - 1]) > 0); ) F3--;
      return F3 === u4.length ? t2 : u4.slice(0, F3).join(" ") + u4.slice(F3).join("");
    };
    oD2 = (t2, u4, F3 = {}) => {
      if (F3.trim !== false && t2.trim() === "") return "";
      let e3 = "", s2, i3;
      const D2 = ED2(t2);
      let C3 = [""];
      for (const [E2, a3] of t2.split(" ").entries()) {
        F3.trim !== false && (C3[C3.length - 1] = C3[C3.length - 1].trimStart());
        let n2 = A$1(C3[C3.length - 1]);
        if (E2 !== 0 && (n2 >= u4 && (F3.wordWrap === false || F3.trim === false) && (C3.push(""), n2 = 0), (n2 > 0 || F3.trim === false) && (C3[C3.length - 1] += " ", n2++)), F3.hard && D2[E2] > u4) {
          const B3 = u4 - n2, p2 = 1 + Math.floor((D2[E2] - B3 - 1) / u4);
          Math.floor((D2[E2] - 1) / u4) < p2 && C3.push(""), _2(C3, a3, u4);
          continue;
        }
        if (n2 + D2[E2] > u4 && n2 > 0 && D2[E2] > 0) {
          if (F3.wordWrap === false && n2 < u4) {
            _2(C3, a3, u4);
            continue;
          }
          C3.push("");
        }
        if (n2 + D2[E2] > u4 && F3.wordWrap === false) {
          _2(C3, a3, u4);
          continue;
        }
        C3[C3.length - 1] += a3;
      }
      F3.trim !== false && (C3 = C3.map((E2) => nD2(E2)));
      const o3 = [...C3.join(`
`)];
      for (const [E2, a3] of o3.entries()) {
        if (e3 += a3, v2.has(a3)) {
          const { groups: B3 } = new RegExp(`(?:\\${W$1}(?<code>\\d+)m|\\${y3}(?<uri>.*)${w$1})`).exec(o3.slice(E2).join("")) || { groups: {} };
          if (B3.code !== void 0) {
            const p2 = Number.parseFloat(B3.code);
            s2 = p2 === CD2 ? void 0 : p2;
          } else B3.uri !== void 0 && (i3 = B3.uri.length === 0 ? void 0 : B3.uri);
        }
        const n2 = iD2.codes.get(Number(s2));
        o3[E2 + 1] === `
` ? (i3 && (e3 += z2("")), s2 && n2 && (e3 += V$1(n2))) : a3 === `
` && (s2 && n2 && (e3 += V$1(s2)), i3 && (e3 += z2(i3)));
      }
      return e3;
    };
    aD2 = ["up", "down", "left", "right", "space", "enter", "cancel"];
    c2 = { actions: new Set(aD2), aliases: /* @__PURE__ */ new Map([["k", "up"], ["j", "down"], ["h", "left"], ["l", "right"], ["", "cancel"], ["escape", "cancel"]]) };
    globalThis.process.platform.startsWith("win");
    S3 = /* @__PURE__ */ Symbol("clack:cancel");
    AD2 = Object.defineProperty;
    pD2 = (t2, u4, F3) => u4 in t2 ? AD2(t2, u4, { enumerable: true, configurable: true, writable: true, value: F3 }) : t2[u4] = F3;
    h2 = (t2, u4, F3) => (pD2(t2, typeof u4 != "symbol" ? u4 + "" : u4, F3), F3);
    x2 = class {
      constructor(u4, F3 = true) {
        h2(this, "input"), h2(this, "output"), h2(this, "_abortSignal"), h2(this, "rl"), h2(this, "opts"), h2(this, "_render"), h2(this, "_track", false), h2(this, "_prevFrame", ""), h2(this, "_subscribers", /* @__PURE__ */ new Map()), h2(this, "_cursor", 0), h2(this, "state", "initial"), h2(this, "error", ""), h2(this, "value");
        const { input: e3 = import_node_process3.stdin, output: s2 = import_node_process3.stdout, render: i3, signal: D2, ...C3 } = u4;
        this.opts = C3, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = i3.bind(this), this._track = F3, this._abortSignal = D2, this.input = e3, this.output = s2;
      }
      unsubscribe() {
        this._subscribers.clear();
      }
      setSubscriber(u4, F3) {
        const e3 = this._subscribers.get(u4) ?? [];
        e3.push(F3), this._subscribers.set(u4, e3);
      }
      on(u4, F3) {
        this.setSubscriber(u4, { cb: F3 });
      }
      once(u4, F3) {
        this.setSubscriber(u4, { cb: F3, once: true });
      }
      emit(u4, ...F3) {
        const e3 = this._subscribers.get(u4) ?? [], s2 = [];
        for (const i3 of e3) i3.cb(...F3), i3.once && s2.push(() => e3.splice(e3.indexOf(i3), 1));
        for (const i3 of s2) i3();
      }
      prompt() {
        return new Promise((u4, F3) => {
          if (this._abortSignal) {
            if (this._abortSignal.aborted) return this.state = "cancel", this.close(), u4(S3);
            this._abortSignal.addEventListener("abort", () => {
              this.state = "cancel", this.close();
            }, { once: true });
          }
          const e3 = new import_node_tty2.WriteStream(0);
          e3._write = (s2, i3, D2) => {
            this._track && (this.value = this.rl?.line.replace(/\t/g, ""), this._cursor = this.rl?.cursor ?? 0, this.emit("value", this.value)), D2();
          }, this.input.pipe(e3), this.rl = import_node_readline2.default.createInterface({ input: this.input, output: e3, tabSize: 2, prompt: "", escapeCodeTimeout: 50 }), import_node_readline2.default.emitKeypressEvents(this.input, this.rl), this.rl.prompt(), this.opts.initialValue !== void 0 && this._track && this.rl.write(this.opts.initialValue), this.input.on("keypress", this.onKeypress), d$1(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
            this.output.write(srcExports.cursor.show), this.output.off("resize", this.render), d$1(this.input, false), u4(this.value);
          }), this.once("cancel", () => {
            this.output.write(srcExports.cursor.show), this.output.off("resize", this.render), d$1(this.input, false), u4(S3);
          });
        });
      }
      onKeypress(u4, F3) {
        if (this.state === "error" && (this.state = "active"), F3?.name && (!this._track && c2.aliases.has(F3.name) && this.emit("cursor", c2.aliases.get(F3.name)), c2.actions.has(F3.name) && this.emit("cursor", F3.name)), u4 && (u4.toLowerCase() === "y" || u4.toLowerCase() === "n") && this.emit("confirm", u4.toLowerCase() === "y"), u4 === "	" && this.opts.placeholder && (this.value || (this.rl?.write(this.opts.placeholder), this.emit("value", this.opts.placeholder))), u4 && this.emit("key", u4.toLowerCase()), F3?.name === "return") {
          if (this.opts.validate) {
            const e3 = this.opts.validate(this.value);
            e3 && (this.error = e3 instanceof Error ? e3.message : e3, this.state = "error", this.rl?.write(this.value));
          }
          this.state !== "error" && (this.state = "submit");
        }
        k$1([u4, F3?.name, F3?.sequence], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
      }
      close() {
        this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), d$1(this.input, false), this.rl?.close(), this.rl = void 0, this.emit(`${this.state}`, this.value), this.unsubscribe();
      }
      restoreCursor() {
        const u4 = G3(this._prevFrame, process.stdout.columns, { hard: true }).split(`
`).length - 1;
        this.output.write(srcExports.cursor.move(-999, u4 * -1));
      }
      render() {
        const u4 = G3(this._render(this) ?? "", process.stdout.columns, { hard: true });
        if (u4 !== this._prevFrame) {
          if (this.state === "initial") this.output.write(srcExports.cursor.hide);
          else {
            const F3 = lD2(this._prevFrame, u4);
            if (this.restoreCursor(), F3 && F3?.length === 1) {
              const e3 = F3[0];
              this.output.write(srcExports.cursor.move(0, e3)), this.output.write(srcExports.erase.lines(1));
              const s2 = u4.split(`
`);
              this.output.write(s2[e3]), this._prevFrame = u4, this.output.write(srcExports.cursor.move(0, s2.length - e3 - 1));
              return;
            }
            if (F3 && F3?.length > 1) {
              const e3 = F3[0];
              this.output.write(srcExports.cursor.move(0, e3)), this.output.write(srcExports.erase.down());
              const s2 = u4.split(`
`).slice(e3);
              this.output.write(s2.join(`
`)), this._prevFrame = u4;
              return;
            }
            this.output.write(srcExports.erase.down());
          }
          this.output.write(u4), this.state === "initial" && (this.state = "active"), this._prevFrame = u4;
        }
      }
    };
    fD2 = class extends x2 {
      get cursor() {
        return this.value ? 0 : 1;
      }
      get _value() {
        return this.cursor === 0;
      }
      constructor(u4) {
        super(u4, false), this.value = !!u4.initialValue, this.on("value", () => {
          this.value = this._value;
        }), this.on("confirm", (F3) => {
          this.output.write(srcExports.cursor.move(0, -1)), this.value = F3, this.state = "submit", this.close();
        }), this.on("cursor", () => {
          this.value = !this.value;
        });
      }
    };
    bD = Object.defineProperty;
    mD = (t2, u4, F3) => u4 in t2 ? bD(t2, u4, { enumerable: true, configurable: true, writable: true, value: F3 }) : t2[u4] = F3;
    Y = (t2, u4, F3) => (mD(t2, typeof u4 != "symbol" ? u4 + "" : u4, F3), F3);
    wD2 = class extends x2 {
      constructor(u4) {
        super(u4, false), Y(this, "options"), Y(this, "cursor", 0), this.options = u4.options, this.value = [...u4.initialValues ?? []], this.cursor = Math.max(this.options.findIndex(({ value: F3 }) => F3 === u4.cursorAt), 0), this.on("key", (F3) => {
          F3 === "a" && this.toggleAll();
        }), this.on("cursor", (F3) => {
          switch (F3) {
            case "left":
            case "up":
              this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
              break;
            case "down":
            case "right":
              this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
              break;
            case "space":
              this.toggleValue();
              break;
          }
        });
      }
      get _value() {
        return this.options[this.cursor].value;
      }
      toggleAll() {
        const u4 = this.value.length === this.options.length;
        this.value = u4 ? [] : this.options.map((F3) => F3.value);
      }
      toggleValue() {
        const u4 = this.value.includes(this._value);
        this.value = u4 ? this.value.filter((F3) => F3 !== this._value) : [...this.value, this._value];
      }
    };
    SD = Object.defineProperty;
    $D = (t2, u4, F3) => u4 in t2 ? SD(t2, u4, { enumerable: true, configurable: true, writable: true, value: F3 }) : t2[u4] = F3;
    q = (t2, u4, F3) => ($D(t2, typeof u4 != "symbol" ? u4 + "" : u4, F3), F3);
    jD2 = class extends x2 {
      constructor(u4) {
        super(u4, false), q(this, "options"), q(this, "cursor", 0), this.options = u4.options, this.cursor = this.options.findIndex(({ value: F3 }) => F3 === u4.initialValue), this.cursor === -1 && (this.cursor = 0), this.changeValue(), this.on("cursor", (F3) => {
          switch (F3) {
            case "left":
            case "up":
              this.cursor = this.cursor === 0 ? this.options.length - 1 : this.cursor - 1;
              break;
            case "down":
            case "right":
              this.cursor = this.cursor === this.options.length - 1 ? 0 : this.cursor + 1;
              break;
          }
          this.changeValue();
        });
      }
      get _value() {
        return this.options[this.cursor];
      }
      changeValue() {
        this.value = this._value.value;
      }
    };
    PD2 = class extends x2 {
      get valueWithCursor() {
        if (this.state === "submit") return this.value;
        if (this.cursor >= this.value.length) return `${this.value}\u2588`;
        const u4 = this.value.slice(0, this.cursor), [F3, ...e$1] = this.value.slice(this.cursor);
        return `${u4}${e2.inverse(F3)}${e$1.join("")}`;
      }
      get cursor() {
        return this._cursor;
      }
      constructor(u4) {
        super(u4), this.on("finalize", () => {
          this.value || (this.value = u4.defaultValue);
        });
      }
    };
    V3 = ce2();
    u2 = (t2, n2) => V3 ? t2 : n2;
    le2 = u2("\u276F", ">");
    L3 = u2("\u25A0", "x");
    W2 = u2("\u25B2", "x");
    C = u2("\u2714", "\u221A");
    o = u2("");
    d2 = u2("");
    k2 = u2("\u25CF", ">");
    P2 = u2("\u25CB", " ");
    A3 = u2("\u25FB", "[\u2022]");
    T2 = u2("\u25FC", "[+]");
    F = u2("\u25FB", "[ ]");
    w2 = (t2) => {
      switch (t2) {
        case "initial":
        case "active":
          return e2.cyan(le2);
        case "cancel":
          return e2.red(L3);
        case "error":
          return e2.yellow(W2);
        case "submit":
          return e2.green(C);
      }
    };
    B2 = (t2) => {
      const { cursor: n2, options: s2, style: r4 } = t2, i3 = t2.maxItems ?? Number.POSITIVE_INFINITY, a3 = Math.max(process.stdout.rows - 4, 0), c4 = Math.min(a3, Math.max(i3, 5));
      let l3 = 0;
      n2 >= l3 + c4 - 3 ? l3 = Math.max(Math.min(n2 - c4 + 3, s2.length - c4), 0) : n2 < l3 + 2 && (l3 = Math.max(n2 - 2, 0));
      const $2 = c4 < s2.length && l3 > 0, p2 = c4 < s2.length && l3 + c4 < s2.length;
      return s2.slice(l3, l3 + c4).map((M3, v3, x4) => {
        const j3 = v3 === 0 && $2, E2 = v3 === x4.length - 1 && p2;
        return j3 || E2 ? e2.dim("...") : r4(M3, v3 + l3 === n2);
      });
    };
    he = (t2) => new PD2({ validate: t2.validate, placeholder: t2.placeholder, defaultValue: t2.defaultValue, initialValue: t2.initialValue, render() {
      const n2 = `${e2.gray(o)}
${w2(this.state)} ${t2.message}
`, s2 = t2.placeholder ? e2.inverse(t2.placeholder[0]) + e2.dim(t2.placeholder.slice(1)) : e2.inverse(e2.hidden("_")), r4 = this.value ? this.valueWithCursor : s2;
      switch (this.state) {
        case "error":
          return `${n2.trim()}
${e2.yellow(o)} ${r4}
${e2.yellow(d2)} ${e2.yellow(this.error)}
`;
        case "submit":
          return `${n2}${e2.gray(o)} ${e2.dim(this.value || t2.placeholder)}`;
        case "cancel":
          return `${n2}${e2.gray(o)} ${e2.strikethrough(e2.dim(this.value ?? ""))}${this.value?.trim() ? `
${e2.gray(o)}` : ""}`;
        default:
          return `${n2}${e2.cyan(o)} ${r4}
${e2.cyan(d2)}
`;
      }
    } }).prompt();
    ye = (t2) => {
      const n2 = t2.active ?? "Yes", s2 = t2.inactive ?? "No";
      return new fD2({ active: n2, inactive: s2, initialValue: t2.initialValue ?? true, render() {
        const r4 = `${e2.gray(o)}
${w2(this.state)} ${t2.message}
`, i3 = this.value ? n2 : s2;
        switch (this.state) {
          case "submit":
            return `${r4}${e2.gray(o)} ${e2.dim(i3)}`;
          case "cancel":
            return `${r4}${e2.gray(o)} ${e2.strikethrough(e2.dim(i3))}
${e2.gray(o)}`;
          default:
            return `${r4}${e2.cyan(o)} ${this.value ? `${e2.green(k2)} ${n2}` : `${e2.dim(P2)} ${e2.dim(n2)}`} ${e2.dim("/")} ${this.value ? `${e2.dim(P2)} ${e2.dim(s2)}` : `${e2.green(k2)} ${s2}`}
${e2.cyan(d2)}
`;
        }
      } }).prompt();
    };
    ve = (t2) => {
      const n2 = (s2, r4) => {
        const i3 = s2.label ?? String(s2.value);
        switch (r4) {
          case "selected":
            return `${e2.dim(i3)}`;
          case "active":
            return `${e2.green(k2)} ${i3} ${s2.hint ? e2.dim(`(${s2.hint})`) : ""}`;
          case "cancelled":
            return `${e2.strikethrough(e2.dim(i3))}`;
          default:
            return `${e2.dim(P2)} ${e2.dim(i3)}`;
        }
      };
      return new jD2({ options: t2.options, initialValue: t2.initialValue, render() {
        const s2 = `${e2.gray(o)}
${w2(this.state)} ${t2.message}
`;
        switch (this.state) {
          case "submit":
            return `${s2}${e2.gray(o)} ${n2(this.options[this.cursor], "selected")}`;
          case "cancel":
            return `${s2}${e2.gray(o)} ${n2(this.options[this.cursor], "cancelled")}
${e2.gray(o)}`;
          default:
            return `${s2}${e2.cyan(o)} ${B2({ cursor: this.cursor, options: this.options, maxItems: t2.maxItems, style: (r4, i3) => n2(r4, i3 ? "active" : "inactive") }).join(`
${e2.cyan(o)}  `)}
${e2.cyan(d2)}
`;
        }
      } }).prompt();
    };
    fe2 = (t2) => {
      const n2 = (s2, r4) => {
        const i3 = s2.label ?? String(s2.value);
        return r4 === "active" ? `${e2.cyan(A3)} ${i3} ${s2.hint ? e2.dim(`(${s2.hint})`) : ""}` : r4 === "selected" ? `${e2.green(T2)} ${e2.dim(i3)}` : r4 === "cancelled" ? `${e2.strikethrough(e2.dim(i3))}` : r4 === "active-selected" ? `${e2.green(T2)} ${i3} ${s2.hint ? e2.dim(`(${s2.hint})`) : ""}` : r4 === "submitted" ? `${e2.dim(i3)}` : `${e2.dim(F)} ${e2.dim(i3)}`;
      };
      return new wD2({ options: t2.options, initialValues: t2.initialValues, required: t2.required ?? true, cursorAt: t2.cursorAt, validate(s2) {
        if (this.required && s2.length === 0) return `Please select at least one option.
${e2.reset(e2.dim(`Press ${e2.gray(e2.bgWhite(e2.inverse(" space ")))} to select, ${e2.gray(e2.bgWhite(e2.inverse(" enter ")))} to submit`))}`;
      }, render() {
        const s2 = `${e2.gray(o)}
${w2(this.state)} ${t2.message}
`, r4 = (i3, a3) => {
          const c4 = this.value.includes(i3.value);
          return a3 && c4 ? n2(i3, "active-selected") : c4 ? n2(i3, "selected") : n2(i3, a3 ? "active" : "inactive");
        };
        switch (this.state) {
          case "submit":
            return `${s2}${e2.gray(o)} ${this.options.filter(({ value: i3 }) => this.value.includes(i3)).map((i3) => n2(i3, "submitted")).join(e2.dim(", ")) || e2.dim("none")}`;
          case "cancel": {
            const i3 = this.options.filter(({ value: a3 }) => this.value.includes(a3)).map((a3) => n2(a3, "cancelled")).join(e2.dim(", "));
            return `${s2}${e2.gray(o)} ${i3.trim() ? `${i3}
${e2.gray(o)}` : ""}`;
          }
          case "error": {
            const i3 = this.error.split(`
`).map((a3, c4) => c4 === 0 ? `${e2.yellow(d2)} ${e2.yellow(a3)}` : `   ${a3}`).join(`
`);
            return `${s2 + e2.yellow(o)} ${B2({ options: this.options, cursor: this.cursor, maxItems: t2.maxItems, style: r4 }).join(`
${e2.yellow(o)}  `)}
${i3}
`;
          }
          default:
            return `${s2}${e2.cyan(o)} ${B2({ options: this.options, cursor: this.cursor, maxItems: t2.maxItems, style: r4 }).join(`
${e2.cyan(o)}  `)}
${e2.cyan(d2)}
`;
        }
      } }).prompt();
    };
    `${e2.gray(o)}  `;
    kCancel = /* @__PURE__ */ Symbol.for("cancel");
  }
});

// ../../node_modules/.pnpm/universalify@2.0.1/node_modules/universalify/index.js
var require_universalify = __commonJS({
  "../../node_modules/.pnpm/universalify@2.0.1/node_modules/universalify/index.js"(exports2) {
    "use strict";
    exports2.fromCallback = function(fn) {
      return Object.defineProperty(function(...args) {
        if (typeof args[args.length - 1] === "function") fn.apply(this, args);
        else {
          return new Promise((resolve3, reject) => {
            args.push((err2, res) => err2 != null ? reject(err2) : resolve3(res));
            fn.apply(this, args);
          });
        }
      }, "name", { value: fn.name });
    };
    exports2.fromPromise = function(fn) {
      return Object.defineProperty(function(...args) {
        const cb = args[args.length - 1];
        if (typeof cb !== "function") return fn.apply(this, args);
        else {
          args.pop();
          fn.apply(this, args).then((r4) => cb(null, r4), cb);
        }
      }, "name", { value: fn.name });
    };
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/polyfills.js"(exports2, module2) {
    var constants = require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform2 = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d3) {
        cwd = null;
        chdir.call(process, d3);
      };
      if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module2.exports = patch;
    function patch(fs) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs);
      }
      if (!fs.lutimes) {
        patchLutimes(fs);
      }
      fs.chown = chownFix(fs.chown);
      fs.fchown = chownFix(fs.fchown);
      fs.lchown = chownFix(fs.lchown);
      fs.chmod = chmodFix(fs.chmod);
      fs.fchmod = chmodFix(fs.fchmod);
      fs.lchmod = chmodFix(fs.lchmod);
      fs.chownSync = chownFixSync(fs.chownSync);
      fs.fchownSync = chownFixSync(fs.fchownSync);
      fs.lchownSync = chownFixSync(fs.lchownSync);
      fs.chmodSync = chmodFixSync(fs.chmodSync);
      fs.fchmodSync = chmodFixSync(fs.fchmodSync);
      fs.lchmodSync = chmodFixSync(fs.lchmodSync);
      fs.stat = statFix(fs.stat);
      fs.fstat = statFix(fs.fstat);
      fs.lstat = statFix(fs.lstat);
      fs.statSync = statFixSync(fs.statSync);
      fs.fstatSync = statFixSync(fs.fstatSync);
      fs.lstatSync = statFixSync(fs.lstatSync);
      if (fs.chmod && !fs.lchmod) {
        fs.lchmod = function(path, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchmodSync = function() {
        };
      }
      if (fs.chown && !fs.lchown) {
        fs.lchown = function(path, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchownSync = function() {
        };
      }
      if (platform2 === "win32") {
        fs.rename = typeof fs.rename !== "function" ? fs.rename : (function(fs$rename) {
          function rename(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb) cb(er);
            });
          }
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
          return rename;
        })(fs.rename);
      }
      fs.read = typeof fs.read !== "function" ? fs.read : (function(fs$read) {
        function read(fd2, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _4, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs, fd2, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs, fd2, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
        return read;
      })(fs.read);
      fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : /* @__PURE__ */ (function(fs$readSync) {
        return function(fd2, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs, fd2, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      })(fs.readSync);
      function patchLchmod(fs2) {
        fs2.lchmod = function(path, mode, callback) {
          fs2.open(
            path,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err2, fd2) {
              if (err2) {
                if (callback) callback(err2);
                return;
              }
              fs2.fchmod(fd2, mode, function(err3) {
                fs2.close(fd2, function(err22) {
                  if (callback) callback(err3 || err22);
                });
              });
            }
          );
        };
        fs2.lchmodSync = function(path, mode) {
          var fd2 = fs2.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs2.fchmodSync(fd2, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd2);
              } catch (er) {
              }
            } else {
              fs2.closeSync(fd2);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs2) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
          fs2.lutimes = function(path, at, mt, cb) {
            fs2.open(path, constants.O_SYMLINK, function(er, fd2) {
              if (er) {
                if (cb) cb(er);
                return;
              }
              fs2.futimes(fd2, at, mt, function(er2) {
                fs2.close(fd2, function(er22) {
                  if (cb) cb(er2 || er22);
                });
              });
            });
          };
          fs2.lutimesSync = function(path, at, mt) {
            var fd2 = fs2.openSync(path, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs2.futimesSync(fd2, at, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs2.closeSync(fd2);
                } catch (er) {
                }
              } else {
                fs2.closeSync(fd2);
              }
            }
            return ret;
          };
        } else if (fs2.futimes) {
          fs2.lutimes = function(_a2, _b2, _c2, cb) {
            if (cb) process.nextTick(cb);
          };
          fs2.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig) return orig;
        return function(target, mode, cb) {
          return orig.call(fs, target, mode, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig) return orig;
        return function(target, mode) {
          try {
            return orig.call(fs, target, mode);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig) return orig;
        return function(target, uid, gid, cb) {
          return orig.call(fs, target, uid, gid, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig) return orig;
        return function(target, uid, gid) {
          try {
            return orig.call(fs, target, uid, gid);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig) return orig;
        return function(target, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0) stats.uid += 4294967296;
              if (stats.gid < 0) stats.gid += 4294967296;
            }
            if (cb) cb.apply(this, arguments);
          }
          return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig) return orig;
        return function(target, options) {
          var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/legacy-streams.js"(exports2, module2) {
    var Stream = require("stream").Stream;
    module2.exports = legacy;
    function legacy(fs) {
      return {
        ReadStream,
        WriteStream: WriteStream2
      };
      function ReadStream(path, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path, options);
        Stream.call(this);
        var self = this;
        this.path = path;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding) this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs.open(this.path, this.flags, this.mode, function(err2, fd2) {
          if (err2) {
            self.emit("error", err2);
            self.readable = false;
            return;
          }
          self.fd = fd2;
          self.emit("open", fd2);
          self._read();
        });
      }
      function WriteStream2(path, options) {
        if (!(this instanceof WriteStream2)) return new WriteStream2(path, options);
        Stream.call(this);
        this.path = path;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/clone.js"(exports2, module2) {
    "use strict";
    module2.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// ../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "../../node_modules/.pnpm/graceful-fs@4.2.11/node_modules/graceful-fs/graceful-fs.js"(exports2, module2) {
    var fs = require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util = require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = /* @__PURE__ */ Symbol.for("graceful-fs.queue");
      previousSymbol = /* @__PURE__ */ Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue3) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue3;
        }
      });
    }
    var debug = noop;
    if (util.debuglog)
      debug = util.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug = function() {
        var m4 = util.format.apply(util, arguments);
        m4 = "GFS4: " + m4.split(/\n/).join("\nGFS4: ");
        console.error(m4);
      };
    if (!fs[gracefulQueue]) {
      queue2 = global[gracefulQueue] || [];
      publishQueue(fs, queue2);
      fs.close = (function(fs$close) {
        function close(fd2, cb) {
          return fs$close.call(fs, fd2, function(err2) {
            if (!err2) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      })(fs.close);
      fs.closeSync = (function(fs$closeSync) {
        function closeSync(fd2) {
          fs$closeSync.apply(fs, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync;
      })(fs.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug(fs[gracefulQueue]);
          require("assert").equal(fs[gracefulQueue].length, 0);
        });
      }
    }
    var queue2;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs[gracefulQueue]);
    }
    module2.exports = patch(clone(fs));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
      module2.exports = patch(fs);
      fs.__patched = true;
    }
    function patch(fs2) {
      polyfills(fs2);
      fs2.gracefulify = patch;
      fs2.createReadStream = createReadStream;
      fs2.createWriteStream = createWriteStream;
      var fs$readFile = fs2.readFile;
      fs2.readFile = readFile5;
      function readFile5(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path, options, cb);
        function go$readFile(path2, options2, cb2, startTime) {
          return fs$readFile(path2, options2, function(err2) {
            if (err2 && (err2.code === "EMFILE" || err2.code === "ENFILE"))
              enqueue([go$readFile, [path2, options2, cb2], err2, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs2.writeFile;
      fs2.writeFile = writeFile3;
      function writeFile3(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path, data, options, cb);
        function go$writeFile(path2, data2, options2, cb2, startTime) {
          return fs$writeFile(path2, data2, options2, function(err2) {
            if (err2 && (err2.code === "EMFILE" || err2.code === "ENFILE"))
              enqueue([go$writeFile, [path2, data2, options2, cb2], err2, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs2.appendFile;
      if (fs$appendFile)
        fs2.appendFile = appendFile;
      function appendFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path, data, options, cb);
        function go$appendFile(path2, data2, options2, cb2, startTime) {
          return fs$appendFile(path2, data2, options2, function(err2) {
            if (err2 && (err2.code === "EMFILE" || err2.code === "ENFILE"))
              enqueue([go$appendFile, [path2, data2, options2, cb2], err2, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs2.copyFile;
      if (fs$copyFile)
        fs2.copyFile = copyFile;
      function copyFile(src2, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src2, dest, flags, cb);
        function go$copyFile(src3, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src3, dest2, flags2, function(err2) {
            if (err2 && (err2.code === "EMFILE" || err2.code === "ENFILE"))
              enqueue([go$copyFile, [src3, dest2, flags2, cb2], err2, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs2.readdir;
      fs2.readdir = readdir2;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir2(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, options2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path, options, cb);
        function fs$readdirCallback(path2, options2, cb2, startTime) {
          return function(err2, files) {
            if (err2 && (err2.code === "EMFILE" || err2.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path2, options2, cb2],
                err2,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err2, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs2);
        ReadStream = legStreams.ReadStream;
        WriteStream2 = legStreams.WriteStream;
      }
      var fs$ReadStream = fs2.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs2.WriteStream;
      if (fs$WriteStream) {
        WriteStream2.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream2.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs2, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs2, "WriteStream", {
        get: function() {
          return WriteStream2;
        },
        set: function(val) {
          WriteStream2 = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs2, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream2;
      Object.defineProperty(fs2, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err2, fd2) {
          if (err2) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err2);
          } else {
            that.fd = fd2;
            that.emit("open", fd2);
            that.read();
          }
        });
      }
      function WriteStream2(path, options) {
        if (this instanceof WriteStream2)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream2.apply(Object.create(WriteStream2.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err2, fd2) {
          if (err2) {
            that.destroy();
            that.emit("error", err2);
          } else {
            that.fd = fd2;
            that.emit("open", fd2);
          }
        });
      }
      function createReadStream(path, options) {
        return new fs2.ReadStream(path, options);
      }
      function createWriteStream(path, options) {
        return new fs2.WriteStream(path, options);
      }
      var fs$open = fs2.open;
      fs2.open = open;
      function open(path, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path, flags, mode, cb);
        function go$open(path2, flags2, mode2, cb2, startTime) {
          return fs$open(path2, flags2, mode2, function(err2, fd2) {
            if (err2 && (err2.code === "EMFILE" || err2.code === "ENFILE"))
              enqueue([go$open, [path2, flags2, mode2, cb2], err2, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs2;
    }
    function enqueue(elem) {
      debug("ENQUEUE", elem[0].name, elem[1]);
      fs[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i3 = 0; i3 < fs[gracefulQueue].length; ++i3) {
        if (fs[gracefulQueue][i3].length > 2) {
          fs[gracefulQueue][i3][3] = now;
          fs[gracefulQueue][i3][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs[gracefulQueue].length === 0)
        return;
      var elem = fs[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err2 = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err2);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/fs/index.js
var require_fs = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/fs/index.js"(exports2) {
    "use strict";
    var u4 = require_universalify().fromCallback;
    var fs = require_graceful_fs();
    var api = [
      "access",
      "appendFile",
      "chmod",
      "chown",
      "close",
      "copyFile",
      "cp",
      "fchmod",
      "fchown",
      "fdatasync",
      "fstat",
      "fsync",
      "ftruncate",
      "futimes",
      "glob",
      "lchmod",
      "lchown",
      "lutimes",
      "link",
      "lstat",
      "mkdir",
      "mkdtemp",
      "open",
      "opendir",
      "readdir",
      "readFile",
      "readlink",
      "realpath",
      "rename",
      "rm",
      "rmdir",
      "stat",
      "statfs",
      "symlink",
      "truncate",
      "unlink",
      "utimes",
      "writeFile"
    ].filter((key) => {
      return typeof fs[key] === "function";
    });
    Object.assign(exports2, fs);
    api.forEach((method) => {
      exports2[method] = u4(fs[method]);
    });
    exports2.exists = function(filename, callback) {
      if (typeof callback === "function") {
        return fs.exists(filename, callback);
      }
      return new Promise((resolve3) => {
        return fs.exists(filename, resolve3);
      });
    };
    exports2.read = function(fd2, buffer, offset, length, position, callback) {
      if (typeof callback === "function") {
        return fs.read(fd2, buffer, offset, length, position, callback);
      }
      return new Promise((resolve3, reject) => {
        fs.read(fd2, buffer, offset, length, position, (err2, bytesRead, buffer2) => {
          if (err2) return reject(err2);
          resolve3({ bytesRead, buffer: buffer2 });
        });
      });
    };
    exports2.write = function(fd2, buffer, ...args) {
      if (typeof args[args.length - 1] === "function") {
        return fs.write(fd2, buffer, ...args);
      }
      return new Promise((resolve3, reject) => {
        fs.write(fd2, buffer, ...args, (err2, bytesWritten, buffer2) => {
          if (err2) return reject(err2);
          resolve3({ bytesWritten, buffer: buffer2 });
        });
      });
    };
    exports2.readv = function(fd2, buffers, ...args) {
      if (typeof args[args.length - 1] === "function") {
        return fs.readv(fd2, buffers, ...args);
      }
      return new Promise((resolve3, reject) => {
        fs.readv(fd2, buffers, ...args, (err2, bytesRead, buffers2) => {
          if (err2) return reject(err2);
          resolve3({ bytesRead, buffers: buffers2 });
        });
      });
    };
    exports2.writev = function(fd2, buffers, ...args) {
      if (typeof args[args.length - 1] === "function") {
        return fs.writev(fd2, buffers, ...args);
      }
      return new Promise((resolve3, reject) => {
        fs.writev(fd2, buffers, ...args, (err2, bytesWritten, buffers2) => {
          if (err2) return reject(err2);
          resolve3({ bytesWritten, buffers: buffers2 });
        });
      });
    };
    if (typeof fs.realpath.native === "function") {
      exports2.realpath.native = u4(fs.realpath.native);
    } else {
      process.emitWarning(
        "fs.realpath.native is not a function. Is fs being monkey-patched?",
        "Warning",
        "fs-extra-WARN0003"
      );
    }
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/mkdirs/utils.js
var require_utils = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/mkdirs/utils.js"(exports2, module2) {
    "use strict";
    var path = require("path");
    module2.exports.checkPath = function checkPath(pth) {
      if (process.platform === "win32") {
        const pathHasInvalidWinCharacters = /[<>:"|?*]/.test(pth.replace(path.parse(pth).root, ""));
        if (pathHasInvalidWinCharacters) {
          const error = new Error(`Path contains invalid characters: ${pth}`);
          error.code = "EINVAL";
          throw error;
        }
      }
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/mkdirs/make-dir.js
var require_make_dir = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/mkdirs/make-dir.js"(exports2, module2) {
    "use strict";
    var fs = require_fs();
    var { checkPath } = require_utils();
    var getMode = (options) => {
      const defaults = { mode: 511 };
      if (typeof options === "number") return options;
      return { ...defaults, ...options }.mode;
    };
    module2.exports.makeDir = async (dir, options) => {
      checkPath(dir);
      return fs.mkdir(dir, {
        mode: getMode(options),
        recursive: true
      });
    };
    module2.exports.makeDirSync = (dir, options) => {
      checkPath(dir);
      return fs.mkdirSync(dir, {
        mode: getMode(options),
        recursive: true
      });
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/mkdirs/index.js
var require_mkdirs = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/mkdirs/index.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    var { makeDir: _makeDir, makeDirSync } = require_make_dir();
    var makeDir = u4(_makeDir);
    module2.exports = {
      mkdirs: makeDir,
      mkdirsSync: makeDirSync,
      // alias
      mkdirp: makeDir,
      mkdirpSync: makeDirSync,
      ensureDir: makeDir,
      ensureDirSync: makeDirSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/path-exists/index.js
var require_path_exists = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/path-exists/index.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    var fs = require_fs();
    function pathExists(path) {
      return fs.access(path).then(() => true).catch(() => false);
    }
    module2.exports = {
      pathExists: u4(pathExists),
      pathExistsSync: fs.existsSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/util/utimes.js
var require_utimes = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/util/utimes.js"(exports2, module2) {
    "use strict";
    var fs = require_fs();
    var u4 = require_universalify().fromPromise;
    async function utimesMillis(path, atime, mtime) {
      const fd2 = await fs.open(path, "r+");
      let error = null;
      try {
        await fs.futimes(fd2, atime, mtime);
      } catch (futimesErr) {
        error = futimesErr;
      } finally {
        try {
          await fs.close(fd2);
        } catch (closeErr) {
          if (!error) error = closeErr;
        }
      }
      if (error) {
        throw error;
      }
    }
    function utimesMillisSync(path, atime, mtime) {
      const fd2 = fs.openSync(path, "r+");
      let error = null;
      try {
        fs.futimesSync(fd2, atime, mtime);
      } catch (futimesErr) {
        error = futimesErr;
      } finally {
        try {
          fs.closeSync(fd2);
        } catch (closeErr) {
          if (!error) error = closeErr;
        }
      }
      if (error) {
        throw error;
      }
    }
    module2.exports = {
      utimesMillis: u4(utimesMillis),
      utimesMillisSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/util/stat.js
var require_stat = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/util/stat.js"(exports2, module2) {
    "use strict";
    var fs = require_fs();
    var path = require("path");
    var u4 = require_universalify().fromPromise;
    function getStats(src2, dest, opts) {
      const statFunc = opts.dereference ? (file) => fs.stat(file, { bigint: true }) : (file) => fs.lstat(file, { bigint: true });
      return Promise.all([
        statFunc(src2),
        statFunc(dest).catch((err2) => {
          if (err2.code === "ENOENT") return null;
          throw err2;
        })
      ]).then(([srcStat, destStat]) => ({ srcStat, destStat }));
    }
    function getStatsSync(src2, dest, opts) {
      let destStat;
      const statFunc = opts.dereference ? (file) => fs.statSync(file, { bigint: true }) : (file) => fs.lstatSync(file, { bigint: true });
      const srcStat = statFunc(src2);
      try {
        destStat = statFunc(dest);
      } catch (err2) {
        if (err2.code === "ENOENT") return { srcStat, destStat: null };
        throw err2;
      }
      return { srcStat, destStat };
    }
    async function checkPaths(src2, dest, funcName, opts) {
      const { srcStat, destStat } = await getStats(src2, dest, opts);
      if (destStat) {
        if (areIdentical(srcStat, destStat)) {
          const srcBaseName = path.basename(src2);
          const destBaseName = path.basename(dest);
          if (funcName === "move" && srcBaseName !== destBaseName && isCosmeticRename(srcBaseName, destBaseName)) {
            return { srcStat, destStat, isChangingCase: true };
          }
          throw new Error("Source and destination must not be the same.");
        }
        if (srcStat.isDirectory() && !destStat.isDirectory()) {
          throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src2}'.`);
        }
        if (!srcStat.isDirectory() && destStat.isDirectory()) {
          throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src2}'.`);
        }
      }
      if (srcStat.isDirectory() && isSrcSubdir(src2, dest)) {
        throw new Error(errMsg(src2, dest, funcName));
      }
      return { srcStat, destStat };
    }
    function checkPathsSync(src2, dest, funcName, opts) {
      const { srcStat, destStat } = getStatsSync(src2, dest, opts);
      if (destStat) {
        if (areIdentical(srcStat, destStat)) {
          const srcBaseName = path.basename(src2);
          const destBaseName = path.basename(dest);
          if (funcName === "move" && srcBaseName !== destBaseName && isCosmeticRename(srcBaseName, destBaseName)) {
            return { srcStat, destStat, isChangingCase: true };
          }
          throw new Error("Source and destination must not be the same.");
        }
        if (srcStat.isDirectory() && !destStat.isDirectory()) {
          throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src2}'.`);
        }
        if (!srcStat.isDirectory() && destStat.isDirectory()) {
          throw new Error(`Cannot overwrite directory '${dest}' with non-directory '${src2}'.`);
        }
      }
      if (srcStat.isDirectory() && isSrcSubdir(src2, dest)) {
        throw new Error(errMsg(src2, dest, funcName));
      }
      return { srcStat, destStat };
    }
    function isCosmeticRename(srcBaseName, destBaseName) {
      return srcBaseName.toLowerCase().normalize("NFC") === destBaseName.toLowerCase().normalize("NFC");
    }
    async function checkParentPaths(src2, srcStat, dest, funcName) {
      const srcParent = path.resolve(path.dirname(src2));
      const destParent = path.resolve(path.dirname(dest));
      if (destParent === srcParent || destParent === path.parse(destParent).root) return;
      let destStat;
      try {
        destStat = await fs.stat(destParent, { bigint: true });
      } catch (err2) {
        if (err2.code === "ENOENT") return checkParentPaths(src2, srcStat, destParent, funcName);
        throw err2;
      }
      if (areIdentical(srcStat, destStat)) {
        throw new Error(errMsg(src2, dest, funcName));
      }
      return checkParentPaths(src2, srcStat, destParent, funcName);
    }
    function checkParentPathsSync(src2, srcStat, dest, funcName) {
      const srcParent = path.resolve(path.dirname(src2));
      const destParent = path.resolve(path.dirname(dest));
      if (destParent === srcParent || destParent === path.parse(destParent).root) return;
      let destStat;
      try {
        destStat = fs.statSync(destParent, { bigint: true });
      } catch (err2) {
        if (err2.code === "ENOENT") return checkParentPathsSync(src2, srcStat, destParent, funcName);
        throw err2;
      }
      if (areIdentical(srcStat, destStat)) {
        throw new Error(errMsg(src2, dest, funcName));
      }
      return checkParentPathsSync(src2, srcStat, destParent, funcName);
    }
    function areIdentical(srcStat, destStat) {
      return destStat.ino !== void 0 && destStat.dev !== void 0 && destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
    }
    function isSrcSubdir(src2, dest) {
      const srcArr = path.resolve(src2).split(path.sep).filter((i3) => i3);
      const destArr = path.resolve(dest).split(path.sep).filter((i3) => i3);
      return srcArr.every((cur, i3) => destArr[i3] === cur);
    }
    function errMsg(src2, dest, funcName) {
      return `Cannot ${funcName} '${src2}' to a subdirectory of itself, '${dest}'.`;
    }
    module2.exports = {
      // checkPaths
      checkPaths: u4(checkPaths),
      checkPathsSync,
      // checkParent
      checkParentPaths: u4(checkParentPaths),
      checkParentPathsSync,
      // Misc
      isSrcSubdir,
      areIdentical
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/util/async.js
var require_async = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/util/async.js"(exports2, module2) {
    "use strict";
    async function asyncIteratorConcurrentProcess(iterator, fn) {
      const promises = [];
      for await (const item of iterator) {
        promises.push(
          fn(item).then(
            () => null,
            (err2) => err2 ?? new Error("unknown error")
          )
        );
      }
      await Promise.all(
        promises.map(
          (promise) => promise.then((possibleErr) => {
            if (possibleErr !== null) throw possibleErr;
          })
        )
      );
    }
    module2.exports = {
      asyncIteratorConcurrentProcess
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/copy/copy.js
var require_copy = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/copy/copy.js"(exports2, module2) {
    "use strict";
    var fs = require_fs();
    var path = require("path");
    var { mkdirs } = require_mkdirs();
    var { pathExists } = require_path_exists();
    var { utimesMillis } = require_utimes();
    var stat = require_stat();
    var { asyncIteratorConcurrentProcess } = require_async();
    async function copy(src2, dest, opts = {}) {
      if (typeof opts === "function") {
        opts = { filter: opts };
      }
      opts.clobber = "clobber" in opts ? !!opts.clobber : true;
      opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
      if (opts.preserveTimestamps && process.arch === "ia32") {
        process.emitWarning(
          "Using the preserveTimestamps option in 32-bit node is not recommended;\n\n	see https://github.com/jprichardson/node-fs-extra/issues/269",
          "Warning",
          "fs-extra-WARN0001"
        );
      }
      const { srcStat, destStat } = await stat.checkPaths(src2, dest, "copy", opts);
      await stat.checkParentPaths(src2, srcStat, dest, "copy");
      const include = await runFilter(src2, dest, opts);
      if (!include) return;
      const destParent = path.dirname(dest);
      const dirExists = await pathExists(destParent);
      if (!dirExists) {
        await mkdirs(destParent);
      }
      await getStatsAndPerformCopy(destStat, src2, dest, opts);
    }
    async function runFilter(src2, dest, opts) {
      if (!opts.filter) return true;
      return opts.filter(src2, dest);
    }
    async function getStatsAndPerformCopy(destStat, src2, dest, opts) {
      const statFn = opts.dereference ? fs.stat : fs.lstat;
      const srcStat = await statFn(src2);
      if (srcStat.isDirectory()) return onDir(srcStat, destStat, src2, dest, opts);
      if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) return onFile(srcStat, destStat, src2, dest, opts);
      if (srcStat.isSymbolicLink()) return onLink(destStat, src2, dest, opts);
      if (srcStat.isSocket()) throw new Error(`Cannot copy a socket file: ${src2}`);
      if (srcStat.isFIFO()) throw new Error(`Cannot copy a FIFO pipe: ${src2}`);
      throw new Error(`Unknown file: ${src2}`);
    }
    async function onFile(srcStat, destStat, src2, dest, opts) {
      if (!destStat) return copyFile(srcStat, src2, dest, opts);
      if (opts.overwrite) {
        await fs.unlink(dest);
        return copyFile(srcStat, src2, dest, opts);
      }
      if (opts.errorOnExist) {
        throw new Error(`'${dest}' already exists`);
      }
    }
    async function copyFile(srcStat, src2, dest, opts) {
      await fs.copyFile(src2, dest);
      if (opts.preserveTimestamps) {
        if (fileIsNotWritable(srcStat.mode)) {
          await makeFileWritable(dest, srcStat.mode);
        }
        const updatedSrcStat = await fs.stat(src2);
        await utimesMillis(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
      }
      return fs.chmod(dest, srcStat.mode);
    }
    function fileIsNotWritable(srcMode) {
      return (srcMode & 128) === 0;
    }
    function makeFileWritable(dest, srcMode) {
      return fs.chmod(dest, srcMode | 128);
    }
    async function onDir(srcStat, destStat, src2, dest, opts) {
      if (!destStat) {
        await fs.mkdir(dest);
      }
      await asyncIteratorConcurrentProcess(await fs.opendir(src2), async (item) => {
        const srcItem = path.join(src2, item.name);
        const destItem = path.join(dest, item.name);
        const include = await runFilter(srcItem, destItem, opts);
        if (include) {
          const { destStat: destStat2 } = await stat.checkPaths(srcItem, destItem, "copy", opts);
          await getStatsAndPerformCopy(destStat2, srcItem, destItem, opts);
        }
      });
      if (!destStat) {
        await fs.chmod(dest, srcStat.mode);
      }
    }
    async function onLink(destStat, src2, dest, opts) {
      let resolvedSrc = await fs.readlink(src2);
      if (opts.dereference) {
        resolvedSrc = path.resolve(process.cwd(), resolvedSrc);
      }
      if (!destStat) {
        return fs.symlink(resolvedSrc, dest);
      }
      let resolvedDest = null;
      try {
        resolvedDest = await fs.readlink(dest);
      } catch (e3) {
        if (e3.code === "EINVAL" || e3.code === "UNKNOWN") return fs.symlink(resolvedSrc, dest);
        throw e3;
      }
      if (opts.dereference) {
        resolvedDest = path.resolve(process.cwd(), resolvedDest);
      }
      if (resolvedSrc !== resolvedDest) {
        if (stat.isSrcSubdir(resolvedSrc, resolvedDest)) {
          throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
        }
        if (stat.isSrcSubdir(resolvedDest, resolvedSrc)) {
          throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
        }
      }
      await fs.unlink(dest);
      return fs.symlink(resolvedSrc, dest);
    }
    module2.exports = copy;
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/copy/copy-sync.js
var require_copy_sync = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/copy/copy-sync.js"(exports2, module2) {
    "use strict";
    var fs = require_graceful_fs();
    var path = require("path");
    var mkdirsSync = require_mkdirs().mkdirsSync;
    var utimesMillisSync = require_utimes().utimesMillisSync;
    var stat = require_stat();
    function copySync(src2, dest, opts) {
      if (typeof opts === "function") {
        opts = { filter: opts };
      }
      opts = opts || {};
      opts.clobber = "clobber" in opts ? !!opts.clobber : true;
      opts.overwrite = "overwrite" in opts ? !!opts.overwrite : opts.clobber;
      if (opts.preserveTimestamps && process.arch === "ia32") {
        process.emitWarning(
          "Using the preserveTimestamps option in 32-bit node is not recommended;\n\n	see https://github.com/jprichardson/node-fs-extra/issues/269",
          "Warning",
          "fs-extra-WARN0002"
        );
      }
      const { srcStat, destStat } = stat.checkPathsSync(src2, dest, "copy", opts);
      stat.checkParentPathsSync(src2, srcStat, dest, "copy");
      if (opts.filter && !opts.filter(src2, dest)) return;
      const destParent = path.dirname(dest);
      if (!fs.existsSync(destParent)) mkdirsSync(destParent);
      return getStats(destStat, src2, dest, opts);
    }
    function getStats(destStat, src2, dest, opts) {
      const statSync = opts.dereference ? fs.statSync : fs.lstatSync;
      const srcStat = statSync(src2);
      if (srcStat.isDirectory()) return onDir(srcStat, destStat, src2, dest, opts);
      else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) return onFile(srcStat, destStat, src2, dest, opts);
      else if (srcStat.isSymbolicLink()) return onLink(destStat, src2, dest, opts);
      else if (srcStat.isSocket()) throw new Error(`Cannot copy a socket file: ${src2}`);
      else if (srcStat.isFIFO()) throw new Error(`Cannot copy a FIFO pipe: ${src2}`);
      throw new Error(`Unknown file: ${src2}`);
    }
    function onFile(srcStat, destStat, src2, dest, opts) {
      if (!destStat) return copyFile(srcStat, src2, dest, opts);
      return mayCopyFile(srcStat, src2, dest, opts);
    }
    function mayCopyFile(srcStat, src2, dest, opts) {
      if (opts.overwrite) {
        fs.unlinkSync(dest);
        return copyFile(srcStat, src2, dest, opts);
      } else if (opts.errorOnExist) {
        throw new Error(`'${dest}' already exists`);
      }
    }
    function copyFile(srcStat, src2, dest, opts) {
      fs.copyFileSync(src2, dest);
      if (opts.preserveTimestamps) handleTimestamps(srcStat.mode, src2, dest);
      return setDestMode(dest, srcStat.mode);
    }
    function handleTimestamps(srcMode, src2, dest) {
      if (fileIsNotWritable(srcMode)) makeFileWritable(dest, srcMode);
      return setDestTimestamps(src2, dest);
    }
    function fileIsNotWritable(srcMode) {
      return (srcMode & 128) === 0;
    }
    function makeFileWritable(dest, srcMode) {
      return setDestMode(dest, srcMode | 128);
    }
    function setDestMode(dest, srcMode) {
      return fs.chmodSync(dest, srcMode);
    }
    function setDestTimestamps(src2, dest) {
      const updatedSrcStat = fs.statSync(src2);
      return utimesMillisSync(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
    }
    function onDir(srcStat, destStat, src2, dest, opts) {
      if (!destStat) return mkDirAndCopy(srcStat.mode, src2, dest, opts);
      return copyDir(src2, dest, opts);
    }
    function mkDirAndCopy(srcMode, src2, dest, opts) {
      fs.mkdirSync(dest);
      copyDir(src2, dest, opts);
      return setDestMode(dest, srcMode);
    }
    function copyDir(src2, dest, opts) {
      const dir = fs.opendirSync(src2);
      try {
        let dirent;
        while ((dirent = dir.readSync()) !== null) {
          copyDirItem(dirent.name, src2, dest, opts);
        }
      } finally {
        dir.closeSync();
      }
    }
    function copyDirItem(item, src2, dest, opts) {
      const srcItem = path.join(src2, item);
      const destItem = path.join(dest, item);
      if (opts.filter && !opts.filter(srcItem, destItem)) return;
      const { destStat } = stat.checkPathsSync(srcItem, destItem, "copy", opts);
      return getStats(destStat, srcItem, destItem, opts);
    }
    function onLink(destStat, src2, dest, opts) {
      let resolvedSrc = fs.readlinkSync(src2);
      if (opts.dereference) {
        resolvedSrc = path.resolve(process.cwd(), resolvedSrc);
      }
      if (!destStat) {
        return fs.symlinkSync(resolvedSrc, dest);
      } else {
        let resolvedDest;
        try {
          resolvedDest = fs.readlinkSync(dest);
        } catch (err2) {
          if (err2.code === "EINVAL" || err2.code === "UNKNOWN") return fs.symlinkSync(resolvedSrc, dest);
          throw err2;
        }
        if (opts.dereference) {
          resolvedDest = path.resolve(process.cwd(), resolvedDest);
        }
        if (resolvedSrc !== resolvedDest) {
          if (stat.isSrcSubdir(resolvedSrc, resolvedDest)) {
            throw new Error(`Cannot copy '${resolvedSrc}' to a subdirectory of itself, '${resolvedDest}'.`);
          }
          if (stat.isSrcSubdir(resolvedDest, resolvedSrc)) {
            throw new Error(`Cannot overwrite '${resolvedDest}' with '${resolvedSrc}'.`);
          }
        }
        return copyLink(resolvedSrc, dest);
      }
    }
    function copyLink(resolvedSrc, dest) {
      fs.unlinkSync(dest);
      return fs.symlinkSync(resolvedSrc, dest);
    }
    module2.exports = copySync;
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/copy/index.js
var require_copy2 = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/copy/index.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    module2.exports = {
      copy: u4(require_copy()),
      copySync: require_copy_sync()
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/remove/index.js
var require_remove = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/remove/index.js"(exports2, module2) {
    "use strict";
    var fs = require_graceful_fs();
    var u4 = require_universalify().fromCallback;
    function remove(path, callback) {
      fs.rm(path, { recursive: true, force: true }, callback);
    }
    function removeSync(path) {
      fs.rmSync(path, { recursive: true, force: true });
    }
    module2.exports = {
      remove: u4(remove),
      removeSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/empty/index.js
var require_empty = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/empty/index.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    var fs = require_fs();
    var path = require("path");
    var mkdir2 = require_mkdirs();
    var remove = require_remove();
    var emptyDir = u4(async function emptyDir2(dir) {
      let items;
      try {
        items = await fs.readdir(dir);
      } catch (err2) {
        if (err2.code !== "ENOENT") throw err2;
        return mkdir2.mkdirs(dir);
      }
      return Promise.all(items.map((item) => remove.remove(path.join(dir, item))));
    });
    function emptyDirSync(dir) {
      let items;
      try {
        items = fs.readdirSync(dir);
      } catch (err2) {
        if (err2.code !== "ENOENT") throw err2;
        return mkdir2.mkdirsSync(dir);
      }
      items.forEach((item) => {
        item = path.join(dir, item);
        remove.removeSync(item);
      });
    }
    module2.exports = {
      emptyDirSync,
      emptydirSync: emptyDirSync,
      emptyDir,
      emptydir: emptyDir
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/file.js
var require_file = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/file.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    var path = require("path");
    var fs = require_fs();
    var mkdir2 = require_mkdirs();
    async function createFile(file) {
      let stats;
      try {
        stats = await fs.stat(file);
      } catch {
      }
      if (stats && stats.isFile()) return;
      const dir = path.dirname(file);
      let dirStats = null;
      try {
        dirStats = await fs.stat(dir);
      } catch (err2) {
        if (err2.code === "ENOENT") {
          await mkdir2.mkdirs(dir);
          await fs.writeFile(file, "");
          return;
        } else {
          throw err2;
        }
      }
      if (dirStats.isDirectory()) {
        await fs.writeFile(file, "");
      } else {
        await fs.readdir(dir);
      }
    }
    function createFileSync(file) {
      let stats;
      try {
        stats = fs.statSync(file);
      } catch {
      }
      if (stats && stats.isFile()) return;
      const dir = path.dirname(file);
      try {
        if (!fs.statSync(dir).isDirectory()) {
          fs.readdirSync(dir);
        }
      } catch (err2) {
        if (err2 && err2.code === "ENOENT") mkdir2.mkdirsSync(dir);
        else throw err2;
      }
      fs.writeFileSync(file, "");
    }
    module2.exports = {
      createFile: u4(createFile),
      createFileSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/link.js
var require_link = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/link.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    var path = require("path");
    var fs = require_fs();
    var mkdir2 = require_mkdirs();
    var { pathExists } = require_path_exists();
    var { areIdentical } = require_stat();
    async function createLink(srcpath, dstpath) {
      let dstStat;
      try {
        dstStat = await fs.lstat(dstpath, { bigint: true });
      } catch {
      }
      let srcStat;
      try {
        srcStat = await fs.lstat(srcpath, { bigint: true });
      } catch (err2) {
        err2.message = err2.message.replace("lstat", "ensureLink");
        throw err2;
      }
      if (dstStat && areIdentical(srcStat, dstStat)) return;
      const dir = path.dirname(dstpath);
      const dirExists = await pathExists(dir);
      if (!dirExists) {
        await mkdir2.mkdirs(dir);
      }
      await fs.link(srcpath, dstpath);
    }
    function createLinkSync(srcpath, dstpath) {
      let dstStat;
      try {
        dstStat = fs.lstatSync(dstpath, { bigint: true });
      } catch {
      }
      try {
        const srcStat = fs.lstatSync(srcpath, { bigint: true });
        if (dstStat && areIdentical(srcStat, dstStat)) return;
      } catch (err2) {
        err2.message = err2.message.replace("lstat", "ensureLink");
        throw err2;
      }
      const dir = path.dirname(dstpath);
      const dirExists = fs.existsSync(dir);
      if (dirExists) return fs.linkSync(srcpath, dstpath);
      mkdir2.mkdirsSync(dir);
      return fs.linkSync(srcpath, dstpath);
    }
    module2.exports = {
      createLink: u4(createLink),
      createLinkSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/symlink-paths.js
var require_symlink_paths = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/symlink-paths.js"(exports2, module2) {
    "use strict";
    var path = require("path");
    var fs = require_fs();
    var { pathExists } = require_path_exists();
    var u4 = require_universalify().fromPromise;
    async function symlinkPaths(srcpath, dstpath) {
      if (path.isAbsolute(srcpath)) {
        try {
          await fs.lstat(srcpath);
        } catch (err2) {
          err2.message = err2.message.replace("lstat", "ensureSymlink");
          throw err2;
        }
        return {
          toCwd: srcpath,
          toDst: srcpath
        };
      }
      const dstdir = path.dirname(dstpath);
      const relativeToDst = path.join(dstdir, srcpath);
      const exists = await pathExists(relativeToDst);
      if (exists) {
        return {
          toCwd: relativeToDst,
          toDst: srcpath
        };
      }
      try {
        await fs.lstat(srcpath);
      } catch (err2) {
        err2.message = err2.message.replace("lstat", "ensureSymlink");
        throw err2;
      }
      return {
        toCwd: srcpath,
        toDst: path.relative(dstdir, srcpath)
      };
    }
    function symlinkPathsSync(srcpath, dstpath) {
      if (path.isAbsolute(srcpath)) {
        const exists2 = fs.existsSync(srcpath);
        if (!exists2) throw new Error("absolute srcpath does not exist");
        return {
          toCwd: srcpath,
          toDst: srcpath
        };
      }
      const dstdir = path.dirname(dstpath);
      const relativeToDst = path.join(dstdir, srcpath);
      const exists = fs.existsSync(relativeToDst);
      if (exists) {
        return {
          toCwd: relativeToDst,
          toDst: srcpath
        };
      }
      const srcExists = fs.existsSync(srcpath);
      if (!srcExists) throw new Error("relative srcpath does not exist");
      return {
        toCwd: srcpath,
        toDst: path.relative(dstdir, srcpath)
      };
    }
    module2.exports = {
      symlinkPaths: u4(symlinkPaths),
      symlinkPathsSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/symlink-type.js
var require_symlink_type = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/symlink-type.js"(exports2, module2) {
    "use strict";
    var fs = require_fs();
    var u4 = require_universalify().fromPromise;
    async function symlinkType(srcpath, type) {
      if (type) return type;
      let stats;
      try {
        stats = await fs.lstat(srcpath);
      } catch {
        return "file";
      }
      return stats && stats.isDirectory() ? "dir" : "file";
    }
    function symlinkTypeSync(srcpath, type) {
      if (type) return type;
      let stats;
      try {
        stats = fs.lstatSync(srcpath);
      } catch {
        return "file";
      }
      return stats && stats.isDirectory() ? "dir" : "file";
    }
    module2.exports = {
      symlinkType: u4(symlinkType),
      symlinkTypeSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/symlink.js
var require_symlink = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/symlink.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    var path = require("path");
    var fs = require_fs();
    var { mkdirs, mkdirsSync } = require_mkdirs();
    var { symlinkPaths, symlinkPathsSync } = require_symlink_paths();
    var { symlinkType, symlinkTypeSync } = require_symlink_type();
    var { pathExists } = require_path_exists();
    var { areIdentical } = require_stat();
    async function createSymlink(srcpath, dstpath, type) {
      let stats;
      try {
        stats = await fs.lstat(dstpath);
      } catch {
      }
      if (stats && stats.isSymbolicLink()) {
        let srcStat;
        if (path.isAbsolute(srcpath)) {
          srcStat = await fs.stat(srcpath, { bigint: true });
        } else {
          const dstdir = path.dirname(dstpath);
          const relativeToDst = path.join(dstdir, srcpath);
          try {
            srcStat = await fs.stat(relativeToDst, { bigint: true });
          } catch {
            srcStat = await fs.stat(srcpath, { bigint: true });
          }
        }
        let dstStat;
        try {
          dstStat = await fs.stat(dstpath, { bigint: true });
        } catch (err2) {
          if (err2.code !== "ENOENT") throw err2;
        }
        if (dstStat && areIdentical(srcStat, dstStat)) return;
      }
      const relative = await symlinkPaths(srcpath, dstpath);
      srcpath = relative.toDst;
      const toType = await symlinkType(relative.toCwd, type);
      const dir = path.dirname(dstpath);
      if (!await pathExists(dir)) {
        await mkdirs(dir);
      }
      return fs.symlink(srcpath, dstpath, toType);
    }
    function createSymlinkSync(srcpath, dstpath, type) {
      let stats;
      try {
        stats = fs.lstatSync(dstpath);
      } catch {
      }
      if (stats && stats.isSymbolicLink()) {
        let srcStat;
        if (path.isAbsolute(srcpath)) {
          srcStat = fs.statSync(srcpath, { bigint: true });
        } else {
          const dstdir = path.dirname(dstpath);
          const relativeToDst = path.join(dstdir, srcpath);
          try {
            srcStat = fs.statSync(relativeToDst, { bigint: true });
          } catch {
            srcStat = fs.statSync(srcpath, { bigint: true });
          }
        }
        let dstStat;
        try {
          dstStat = fs.statSync(dstpath, { bigint: true });
        } catch (err2) {
          if (err2.code !== "ENOENT") throw err2;
        }
        if (dstStat && areIdentical(srcStat, dstStat)) return;
      }
      const relative = symlinkPathsSync(srcpath, dstpath);
      srcpath = relative.toDst;
      type = symlinkTypeSync(relative.toCwd, type);
      const dir = path.dirname(dstpath);
      const exists = fs.existsSync(dir);
      if (exists) return fs.symlinkSync(srcpath, dstpath, type);
      mkdirsSync(dir);
      return fs.symlinkSync(srcpath, dstpath, type);
    }
    module2.exports = {
      createSymlink: u4(createSymlink),
      createSymlinkSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/index.js
var require_ensure = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/ensure/index.js"(exports2, module2) {
    "use strict";
    var { createFile, createFileSync } = require_file();
    var { createLink, createLinkSync } = require_link();
    var { createSymlink, createSymlinkSync } = require_symlink();
    module2.exports = {
      // file
      createFile,
      createFileSync,
      ensureFile: createFile,
      ensureFileSync: createFileSync,
      // link
      createLink,
      createLinkSync,
      ensureLink: createLink,
      ensureLinkSync: createLinkSync,
      // symlink
      createSymlink,
      createSymlinkSync,
      ensureSymlink: createSymlink,
      ensureSymlinkSync: createSymlinkSync
    };
  }
});

// ../../node_modules/.pnpm/jsonfile@6.2.1/node_modules/jsonfile/utils.js
var require_utils2 = __commonJS({
  "../../node_modules/.pnpm/jsonfile@6.2.1/node_modules/jsonfile/utils.js"(exports2, module2) {
    function stringify(obj, { EOL = "\n", finalEOL = true, replacer = null, spaces } = {}) {
      const EOF = finalEOL ? EOL : "";
      const str = JSON.stringify(obj, replacer, spaces);
      if (str === void 0) {
        throw new TypeError(`Converting ${typeof obj} value to JSON is not supported`);
      }
      return str.replace(/\n/g, EOL) + EOF;
    }
    function stripBom(content) {
      if (Buffer.isBuffer(content)) content = content.toString("utf8");
      return content.replace(/^\uFEFF/, "");
    }
    module2.exports = { stringify, stripBom };
  }
});

// ../../node_modules/.pnpm/jsonfile@6.2.1/node_modules/jsonfile/index.js
var require_jsonfile = __commonJS({
  "../../node_modules/.pnpm/jsonfile@6.2.1/node_modules/jsonfile/index.js"(exports2, module2) {
    var _fs;
    try {
      _fs = require_graceful_fs();
    } catch (_4) {
      _fs = require("fs");
    }
    var universalify = require_universalify();
    var { stringify, stripBom } = require_utils2();
    async function _readFile(file, options = {}) {
      if (typeof options === "string") {
        options = { encoding: options };
      }
      const fs = options.fs || _fs;
      const shouldThrow = "throws" in options ? options.throws : true;
      let data = await universalify.fromCallback(fs.readFile)(file, options);
      data = stripBom(data);
      let obj;
      try {
        obj = JSON.parse(data, options ? options.reviver : null);
      } catch (err2) {
        if (shouldThrow) {
          err2.message = `${file}: ${err2.message}`;
          throw err2;
        } else {
          return null;
        }
      }
      return obj;
    }
    var readFile5 = universalify.fromPromise(_readFile);
    function readFileSync(file, options = {}) {
      if (typeof options === "string") {
        options = { encoding: options };
      }
      const fs = options.fs || _fs;
      const shouldThrow = "throws" in options ? options.throws : true;
      try {
        let content = fs.readFileSync(file, options);
        content = stripBom(content);
        return JSON.parse(content, options.reviver);
      } catch (err2) {
        if (shouldThrow) {
          err2.message = `${file}: ${err2.message}`;
          throw err2;
        } else {
          return null;
        }
      }
    }
    async function _writeFile(file, obj, options = {}) {
      const fs = options.fs || _fs;
      const str = stringify(obj, options);
      await universalify.fromCallback(fs.writeFile)(file, str, options);
    }
    var writeFile3 = universalify.fromPromise(_writeFile);
    function writeFileSync(file, obj, options = {}) {
      const fs = options.fs || _fs;
      const str = stringify(obj, options);
      return fs.writeFileSync(file, str, options);
    }
    module2.exports = {
      readFile: readFile5,
      readFileSync,
      writeFile: writeFile3,
      writeFileSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/json/jsonfile.js
var require_jsonfile2 = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/json/jsonfile.js"(exports2, module2) {
    "use strict";
    var jsonFile = require_jsonfile();
    module2.exports = {
      // jsonfile exports
      readJson: jsonFile.readFile,
      readJsonSync: jsonFile.readFileSync,
      writeJson: jsonFile.writeFile,
      writeJsonSync: jsonFile.writeFileSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/output-file/index.js
var require_output_file = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/output-file/index.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    var fs = require_fs();
    var path = require("path");
    var mkdir2 = require_mkdirs();
    var pathExists = require_path_exists().pathExists;
    async function outputFile3(file, data, encoding = "utf-8") {
      const dir = path.dirname(file);
      if (!await pathExists(dir)) {
        await mkdir2.mkdirs(dir);
      }
      return fs.writeFile(file, data, encoding);
    }
    function outputFileSync(file, ...args) {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) {
        mkdir2.mkdirsSync(dir);
      }
      fs.writeFileSync(file, ...args);
    }
    module2.exports = {
      outputFile: u4(outputFile3),
      outputFileSync
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/json/output-json.js
var require_output_json = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/json/output-json.js"(exports2, module2) {
    "use strict";
    var { stringify } = require_utils2();
    var { outputFile: outputFile3 } = require_output_file();
    async function outputJson(file, data, options = {}) {
      const str = stringify(data, options);
      await outputFile3(file, str, options);
    }
    module2.exports = outputJson;
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/json/output-json-sync.js
var require_output_json_sync = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/json/output-json-sync.js"(exports2, module2) {
    "use strict";
    var { stringify } = require_utils2();
    var { outputFileSync } = require_output_file();
    function outputJsonSync(file, data, options) {
      const str = stringify(data, options);
      outputFileSync(file, str, options);
    }
    module2.exports = outputJsonSync;
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/json/index.js
var require_json = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/json/index.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    var jsonFile = require_jsonfile2();
    jsonFile.outputJson = u4(require_output_json());
    jsonFile.outputJsonSync = require_output_json_sync();
    jsonFile.outputJSON = jsonFile.outputJson;
    jsonFile.outputJSONSync = jsonFile.outputJsonSync;
    jsonFile.writeJSON = jsonFile.writeJson;
    jsonFile.writeJSONSync = jsonFile.writeJsonSync;
    jsonFile.readJSON = jsonFile.readJson;
    jsonFile.readJSONSync = jsonFile.readJsonSync;
    module2.exports = jsonFile;
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/move/move.js
var require_move = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/move/move.js"(exports2, module2) {
    "use strict";
    var fs = require_fs();
    var path = require("path");
    var { copy } = require_copy2();
    var { remove } = require_remove();
    var { mkdirp } = require_mkdirs();
    var { pathExists } = require_path_exists();
    var stat = require_stat();
    async function move(src2, dest, opts = {}) {
      const overwrite = opts.overwrite || opts.clobber || false;
      const { srcStat, isChangingCase = false } = await stat.checkPaths(src2, dest, "move", opts);
      await stat.checkParentPaths(src2, srcStat, dest, "move");
      const destParent = path.dirname(dest);
      const parsedParentPath = path.parse(destParent);
      if (parsedParentPath.root !== destParent) {
        await mkdirp(destParent);
      }
      return doRename(src2, dest, overwrite, isChangingCase);
    }
    async function doRename(src2, dest, overwrite, isChangingCase) {
      if (!isChangingCase) {
        if (overwrite) {
          await remove(dest);
        } else if (await pathExists(dest)) {
          throw new Error("dest already exists.");
        }
      }
      try {
        await fs.rename(src2, dest);
      } catch (err2) {
        if (err2.code !== "EXDEV") {
          throw err2;
        }
        await moveAcrossDevice(src2, dest, overwrite);
      }
    }
    async function moveAcrossDevice(src2, dest, overwrite) {
      const opts = {
        overwrite,
        errorOnExist: true,
        preserveTimestamps: true
      };
      await copy(src2, dest, opts);
      return remove(src2);
    }
    module2.exports = move;
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/move/move-sync.js
var require_move_sync = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/move/move-sync.js"(exports2, module2) {
    "use strict";
    var fs = require_graceful_fs();
    var path = require("path");
    var copySync = require_copy2().copySync;
    var removeSync = require_remove().removeSync;
    var mkdirpSync = require_mkdirs().mkdirpSync;
    var stat = require_stat();
    function moveSync(src2, dest, opts) {
      opts = opts || {};
      const overwrite = opts.overwrite || opts.clobber || false;
      const { srcStat, isChangingCase = false } = stat.checkPathsSync(src2, dest, "move", opts);
      stat.checkParentPathsSync(src2, srcStat, dest, "move");
      if (!isParentRoot(dest)) mkdirpSync(path.dirname(dest));
      return doRename(src2, dest, overwrite, isChangingCase);
    }
    function isParentRoot(dest) {
      const parent = path.dirname(dest);
      const parsedPath = path.parse(parent);
      return parsedPath.root === parent;
    }
    function doRename(src2, dest, overwrite, isChangingCase) {
      if (isChangingCase) return rename(src2, dest, overwrite);
      if (overwrite) {
        removeSync(dest);
        return rename(src2, dest, overwrite);
      }
      if (fs.existsSync(dest)) throw new Error("dest already exists.");
      return rename(src2, dest, overwrite);
    }
    function rename(src2, dest, overwrite) {
      try {
        fs.renameSync(src2, dest);
      } catch (err2) {
        if (err2.code !== "EXDEV") throw err2;
        return moveAcrossDevice(src2, dest, overwrite);
      }
    }
    function moveAcrossDevice(src2, dest, overwrite) {
      const opts = {
        overwrite,
        errorOnExist: true,
        preserveTimestamps: true
      };
      copySync(src2, dest, opts);
      return removeSync(src2);
    }
    module2.exports = moveSync;
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/move/index.js
var require_move2 = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/move/index.js"(exports2, module2) {
    "use strict";
    var u4 = require_universalify().fromPromise;
    module2.exports = {
      move: u4(require_move()),
      moveSync: require_move_sync()
    };
  }
});

// ../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/index.js
var require_lib = __commonJS({
  "../../node_modules/.pnpm/fs-extra@11.4.1/node_modules/fs-extra/lib/index.js"(exports2, module2) {
    "use strict";
    module2.exports = {
      // Export promiseified graceful-fs:
      ...require_fs(),
      // Export extra methods:
      ...require_copy2(),
      ...require_empty(),
      ...require_ensure(),
      ...require_json(),
      ...require_mkdirs(),
      ...require_move2(),
      ...require_output_file(),
      ...require_path_exists(),
      ...require_remove()
    };
  }
});

// ../../node_modules/.pnpm/citty@0.2.2/node_modules/citty/dist/_chunks/libs/scule.mjs
var NUMBER_CHAR_RE = /\d/;
var STR_SPLITTERS = [
  "-",
  "_",
  "/",
  "."
];
function isUppercase(char = "") {
  if (NUMBER_CHAR_RE.test(char)) return;
  return char !== char.toLowerCase();
}
function splitByCase(str, separators) {
  const splitters = separators ?? STR_SPLITTERS;
  const parts = [];
  if (!str || typeof str !== "string") return parts;
  let buff = "";
  let previousUpper;
  let previousSplitter;
  for (const char of str) {
    const isSplitter = splitters.includes(char);
    if (isSplitter === true) {
      parts.push(buff);
      buff = "";
      previousUpper = void 0;
      continue;
    }
    const isUpper = isUppercase(char);
    if (previousSplitter === false) {
      if (previousUpper === false && isUpper === true) {
        parts.push(buff);
        buff = char;
        previousUpper = isUpper;
        continue;
      }
      if (previousUpper === true && isUpper === false && buff.length > 1) {
        const lastChar = buff.at(-1);
        parts.push(buff.slice(0, Math.max(0, buff.length - 1)));
        buff = lastChar + char;
        previousUpper = isUpper;
        continue;
      }
    }
    buff += char;
    previousUpper = isUpper;
    previousSplitter = isSplitter;
  }
  parts.push(buff);
  return parts;
}
function upperFirst(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : "";
}
function lowerFirst(str) {
  return str ? str[0].toLowerCase() + str.slice(1) : "";
}
function pascalCase(str, opts) {
  return str ? (Array.isArray(str) ? str : splitByCase(str)).map((p2) => upperFirst(opts?.normalize ? p2.toLowerCase() : p2)).join("") : "";
}
function camelCase(str, opts) {
  return lowerFirst(pascalCase(str || "", opts));
}
function kebabCase(str, joiner) {
  return str ? (Array.isArray(str) ? str : splitByCase(str)).map((p2) => p2.toLowerCase()).join(joiner ?? "-") : "";
}
function snakeCase(str) {
  return kebabCase(str || "", "_");
}

// ../../node_modules/.pnpm/citty@0.2.2/node_modules/citty/dist/index.mjs
var import_node_util = require("node:util");
function toArray(val) {
  if (Array.isArray(val)) return val;
  return val === void 0 ? [] : [val];
}
function formatLineColumns(lines, linePrefix = "") {
  const maxLength = [];
  for (const line of lines) for (const [i3, element] of line.entries()) maxLength[i3] = Math.max(maxLength[i3] || 0, element.length);
  return lines.map((l3) => l3.map((c4, i3) => linePrefix + c4[i3 === 0 ? "padStart" : "padEnd"](maxLength[i3])).join("  ")).join("\n");
}
function resolveValue(input) {
  return typeof input === "function" ? input() : input;
}
var CLIError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.name = "CLIError";
    this.code = code;
  }
};
function parseRawArgs(args = [], opts = {}) {
  const booleans = new Set(opts.boolean || []);
  const strings = new Set(opts.string || []);
  const aliasMap = opts.alias || {};
  const defaults = opts.default || {};
  const aliasToMain = /* @__PURE__ */ new Map();
  const mainToAliases = /* @__PURE__ */ new Map();
  for (const [key, value] of Object.entries(aliasMap)) {
    const targets = value;
    for (const target of targets) {
      aliasToMain.set(key, target);
      if (!mainToAliases.has(target)) mainToAliases.set(target, []);
      mainToAliases.get(target).push(key);
      aliasToMain.set(target, key);
      if (!mainToAliases.has(key)) mainToAliases.set(key, []);
      mainToAliases.get(key).push(target);
    }
  }
  const options = {};
  function getType(name) {
    if (booleans.has(name)) return "boolean";
    const aliases = mainToAliases.get(name) || [];
    for (const alias of aliases) if (booleans.has(alias)) return "boolean";
    return "string";
  }
  function isStringType(name) {
    if (strings.has(name)) return true;
    const aliases = mainToAliases.get(name) || [];
    for (const alias of aliases) if (strings.has(alias)) return true;
    return false;
  }
  const allOptions = /* @__PURE__ */ new Set([
    ...booleans,
    ...strings,
    ...Object.keys(aliasMap),
    ...Object.values(aliasMap).flat(),
    ...Object.keys(defaults)
  ]);
  for (const name of allOptions) if (!options[name]) options[name] = {
    type: getType(name),
    default: defaults[name]
  };
  for (const [alias, main2] of aliasToMain.entries()) if (alias.length === 1 && options[main2] && !options[main2].short) options[main2].short = alias;
  const processedArgs = [];
  const negatedFlags = {};
  for (let i3 = 0; i3 < args.length; i3++) {
    const arg = args[i3];
    if (arg === "--") {
      processedArgs.push(...args.slice(i3));
      break;
    }
    if (arg.startsWith("--no-")) {
      const flagName = arg.slice(5);
      negatedFlags[flagName] = true;
      continue;
    }
    processedArgs.push(arg);
  }
  let parsed;
  try {
    parsed = (0, import_node_util.parseArgs)({
      args: processedArgs,
      options: Object.keys(options).length > 0 ? options : void 0,
      allowPositionals: true,
      strict: false
    });
  } catch {
    parsed = {
      values: {},
      positionals: processedArgs
    };
  }
  const out = { _: [] };
  out._ = parsed.positionals;
  for (const [key, value] of Object.entries(parsed.values)) {
    let coerced = value;
    if (getType(key) === "boolean" && typeof value === "string") coerced = value !== "false";
    else if (isStringType(key) && typeof value === "boolean") coerced = "";
    out[key] = coerced;
  }
  for (const [name] of Object.entries(negatedFlags)) {
    out[name] = false;
    const mainName = aliasToMain.get(name);
    if (mainName) out[mainName] = false;
    const aliases = mainToAliases.get(name);
    if (aliases) for (const alias of aliases) out[alias] = false;
  }
  for (const [alias, main2] of aliasToMain.entries()) {
    if (out[alias] !== void 0 && out[main2] === void 0) out[main2] = out[alias];
    if (out[main2] !== void 0 && out[alias] === void 0) out[alias] = out[main2];
    if (out[alias] !== out[main2] && defaults[main2] === out[main2]) out[main2] = out[alias];
  }
  return out;
}
var noColor = /* @__PURE__ */ (() => {
  const env2 = globalThis.process?.env ?? {};
  return env2.NO_COLOR === "1" || env2.TERM === "dumb" || env2.TEST || env2.CI;
})();
var _c = (c4, r4 = 39) => (t2) => noColor ? t2 : `\x1B[${c4}m${t2}\x1B[${r4}m`;
var bold = /* @__PURE__ */ _c(1, 22);
var cyan = /* @__PURE__ */ _c(36);
var gray = /* @__PURE__ */ _c(90);
var underline = /* @__PURE__ */ _c(4, 24);
function parseArgs(rawArgs, argsDef) {
  const parseOptions = {
    boolean: [],
    string: [],
    alias: {},
    default: {}
  };
  const args = resolveArgs(argsDef);
  for (const arg of args) {
    if (arg.type === "positional") continue;
    if (arg.type === "string" || arg.type === "enum") parseOptions.string.push(arg.name);
    else if (arg.type === "boolean") parseOptions.boolean.push(arg.name);
    if (arg.default !== void 0) parseOptions.default[arg.name] = arg.default;
    if (arg.alias) parseOptions.alias[arg.name] = arg.alias;
    const camelName = camelCase(arg.name);
    const kebabName = kebabCase(arg.name);
    if (camelName !== arg.name || kebabName !== arg.name) {
      const existingAliases = toArray(parseOptions.alias[arg.name] || []);
      if (camelName !== arg.name && !existingAliases.includes(camelName)) existingAliases.push(camelName);
      if (kebabName !== arg.name && !existingAliases.includes(kebabName)) existingAliases.push(kebabName);
      if (existingAliases.length > 0) parseOptions.alias[arg.name] = existingAliases;
    }
  }
  const parsed = parseRawArgs(rawArgs, parseOptions);
  const [...positionalArguments] = parsed._;
  const parsedArgsProxy = new Proxy(parsed, { get(target, prop) {
    return target[prop] ?? target[camelCase(prop)] ?? target[kebabCase(prop)];
  } });
  for (const [, arg] of args.entries()) if (arg.type === "positional") {
    const nextPositionalArgument = positionalArguments.shift();
    if (nextPositionalArgument !== void 0) parsedArgsProxy[arg.name] = nextPositionalArgument;
    else if (arg.default === void 0 && arg.required !== false) throw new CLIError(`Missing required positional argument: ${arg.name.toUpperCase()}`, "EARG");
    else parsedArgsProxy[arg.name] = arg.default;
  } else if (arg.type === "enum") {
    const argument = parsedArgsProxy[arg.name];
    const options = arg.options || [];
    if (argument !== void 0 && options.length > 0 && !options.includes(argument)) throw new CLIError(`Invalid value for argument: ${cyan(`--${arg.name}`)} (${cyan(argument)}). Expected one of: ${options.map((o3) => cyan(o3)).join(", ")}.`, "EARG");
  } else if (arg.required && parsedArgsProxy[arg.name] === void 0) throw new CLIError(`Missing required argument: --${arg.name}`, "EARG");
  return parsedArgsProxy;
}
function resolveArgs(argsDef) {
  const args = [];
  for (const [name, argDef] of Object.entries(argsDef || {})) args.push({
    ...argDef,
    name,
    alias: toArray(argDef.alias)
  });
  return args;
}
async function resolvePlugins(plugins) {
  return Promise.all(plugins.map((p2) => resolveValue(p2)));
}
function defineCommand(def) {
  return def;
}
async function runCommand(cmd, opts) {
  const cmdArgs = await resolveValue(cmd.args || {});
  const parsedArgs = parseArgs(opts.rawArgs, cmdArgs);
  const context = {
    rawArgs: opts.rawArgs,
    args: parsedArgs,
    data: opts.data,
    cmd
  };
  const plugins = await resolvePlugins(cmd.plugins ?? []);
  let result;
  let runError;
  try {
    for (const plugin of plugins) await plugin.setup?.(context);
    if (typeof cmd.setup === "function") await cmd.setup(context);
    const subCommands = await resolveValue(cmd.subCommands);
    if (subCommands && Object.keys(subCommands).length > 0) {
      const subCommandArgIndex = findSubCommandIndex(opts.rawArgs, cmdArgs);
      const explicitName = opts.rawArgs[subCommandArgIndex];
      if (explicitName) {
        const subCommand = await _findSubCommand(subCommands, explicitName);
        if (!subCommand) throw new CLIError(`Unknown command ${cyan(explicitName)}`, "E_UNKNOWN_COMMAND");
        await runCommand(subCommand, { rawArgs: opts.rawArgs.slice(subCommandArgIndex + 1) });
      } else {
        const defaultSubCommand = await resolveValue(cmd.default);
        if (defaultSubCommand) {
          if (cmd.run) throw new CLIError(`Cannot specify both 'run' and 'default' on the same command.`, "E_DEFAULT_CONFLICT");
          const subCommand = await _findSubCommand(subCommands, defaultSubCommand);
          if (!subCommand) throw new CLIError(`Default sub command ${cyan(defaultSubCommand)} not found in subCommands.`, "E_UNKNOWN_COMMAND");
          await runCommand(subCommand, { rawArgs: opts.rawArgs });
        } else if (!cmd.run) throw new CLIError(`No command specified.`, "E_NO_COMMAND");
      }
    }
    if (typeof cmd.run === "function") result = await cmd.run(context);
  } catch (error) {
    runError = error;
  }
  const cleanupErrors = [];
  if (typeof cmd.cleanup === "function") try {
    await cmd.cleanup(context);
  } catch (error) {
    cleanupErrors.push(error);
  }
  for (const plugin of [...plugins].reverse()) try {
    await plugin.cleanup?.(context);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (runError) throw runError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new Error("Multiple cleanup errors", { cause: cleanupErrors });
  return { result };
}
async function resolveSubCommand(cmd, rawArgs, parent) {
  const subCommands = await resolveValue(cmd.subCommands);
  if (subCommands && Object.keys(subCommands).length > 0) {
    const subCommandArgIndex = findSubCommandIndex(rawArgs, await resolveValue(cmd.args || {}));
    const subCommandName = rawArgs[subCommandArgIndex];
    const subCommand = await _findSubCommand(subCommands, subCommandName);
    if (subCommand) return resolveSubCommand(subCommand, rawArgs.slice(subCommandArgIndex + 1), cmd);
  }
  return [cmd, parent];
}
async function _findSubCommand(subCommands, name) {
  if (name in subCommands) return resolveValue(subCommands[name]);
  for (const sub of Object.values(subCommands)) {
    const resolved = await resolveValue(sub);
    const meta = await resolveValue(resolved?.meta);
    if (meta?.alias) {
      if (toArray(meta.alias).includes(name)) return resolved;
    }
  }
}
function findSubCommandIndex(rawArgs, argsDef) {
  for (let i3 = 0; i3 < rawArgs.length; i3++) {
    const arg = rawArgs[i3];
    if (arg === "--") return -1;
    if (arg.startsWith("-")) {
      if (!arg.includes("=") && _isValueFlag(arg, argsDef)) i3++;
      continue;
    }
    return i3;
  }
  return -1;
}
function _isValueFlag(flag, argsDef) {
  const name = flag.replace(/^-{1,2}/, "");
  const normalized = camelCase(name);
  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type !== "string" && def.type !== "enum") continue;
    if (normalized === camelCase(key)) return true;
    if ((Array.isArray(def.alias) ? def.alias : def.alias ? [def.alias] : []).includes(name)) return true;
  }
  return false;
}
async function showUsage(cmd, parent) {
  try {
    console.log(await renderUsage(cmd, parent) + "\n");
  } catch (error) {
    console.error(error);
  }
}
var negativePrefixRe = /^no[-A-Z]/;
async function renderUsage(cmd, parent) {
  const cmdMeta = await resolveValue(cmd.meta || {});
  const cmdArgs = resolveArgs(await resolveValue(cmd.args || {}));
  const parentMeta = await resolveValue(parent?.meta || {});
  const commandName = `${parentMeta.name ? `${parentMeta.name} ` : ""}` + (cmdMeta.name || process.argv[1]);
  const argLines = [];
  const posLines = [];
  const commandsLines = [];
  const usageLine = [];
  for (const arg of cmdArgs) if (arg.type === "positional") {
    const name = arg.name.toUpperCase();
    const isRequired = arg.required !== false && arg.default === void 0;
    posLines.push([cyan(name + renderValueHint(arg)), renderDescription(arg, isRequired)]);
    usageLine.push(isRequired ? `<${name}>` : `[${name}]`);
  } else {
    const isRequired = arg.required === true && arg.default === void 0;
    const argStr = [...(arg.alias || []).map((a3) => `-${a3}`), `--${arg.name}`].join(", ") + renderValueHint(arg);
    argLines.push([cyan(argStr), renderDescription(arg, isRequired)]);
    if (arg.type === "boolean" && (arg.default === true || arg.negativeDescription) && !negativePrefixRe.test(arg.name)) {
      const negativeArgStr = [...(arg.alias || []).map((a3) => `--no-${a3}`), `--no-${arg.name}`].join(", ");
      argLines.push([cyan(negativeArgStr), [arg.negativeDescription, isRequired ? gray("(Required)") : ""].filter(Boolean).join(" ")]);
    }
    if (isRequired) usageLine.push(`--${arg.name}` + renderValueHint(arg));
  }
  if (cmd.subCommands) {
    const commandNames = [];
    const subCommands = await resolveValue(cmd.subCommands);
    for (const [name, sub] of Object.entries(subCommands)) {
      const meta = await resolveValue((await resolveValue(sub))?.meta);
      if (meta?.hidden) continue;
      const aliases = toArray(meta?.alias);
      const label = [name, ...aliases].join(", ");
      commandsLines.push([cyan(label), meta?.description || ""]);
      commandNames.push(name, ...aliases);
    }
    usageLine.push(commandNames.join("|"));
  }
  const usageLines = [];
  const version = cmdMeta.version || parentMeta.version;
  usageLines.push(gray(`${cmdMeta.description} (${commandName + (version ? ` v${version}` : "")})`), "");
  const hasOptions = argLines.length > 0 || posLines.length > 0;
  usageLines.push(`${underline(bold("USAGE"))} ${cyan(`${commandName}${hasOptions ? " [OPTIONS]" : ""} ${usageLine.join(" ")}`)}`, "");
  if (posLines.length > 0) {
    usageLines.push(underline(bold("ARGUMENTS")), "");
    usageLines.push(formatLineColumns(posLines, "  "));
    usageLines.push("");
  }
  if (argLines.length > 0) {
    usageLines.push(underline(bold("OPTIONS")), "");
    usageLines.push(formatLineColumns(argLines, "  "));
    usageLines.push("");
  }
  if (commandsLines.length > 0) {
    usageLines.push(underline(bold("COMMANDS")), "");
    usageLines.push(formatLineColumns(commandsLines, "  "));
    usageLines.push("", `Use ${cyan(`${commandName} <command> --help`)} for more information about a command.`);
  }
  return usageLines.filter((l3) => typeof l3 === "string").join("\n");
}
function renderValueHint(arg) {
  const valueHint = arg.valueHint ? `=<${arg.valueHint}>` : "";
  const fallbackValueHint = valueHint || `=<${snakeCase(arg.name)}>`;
  if (!arg.type || arg.type === "positional" || arg.type === "boolean") return valueHint;
  if (arg.type === "enum" && arg.options?.length) return `=<${arg.options.join("|")}>`;
  return fallbackValueHint;
}
function renderDescription(arg, required) {
  const requiredHint = required ? gray("(Required)") : "";
  const defaultHint = arg.default === void 0 ? "" : gray(`(Default: ${arg.default})`);
  return [
    arg.description,
    requiredHint,
    defaultHint
  ].filter(Boolean).join(" ");
}
async function runMain(cmd, opts = {}) {
  const rawArgs = opts.rawArgs || process.argv.slice(2);
  const showUsage$1 = opts.showUsage || showUsage;
  try {
    const builtinFlags = await _resolveBuiltinFlags(cmd);
    if (builtinFlags.help.length > 0 && rawArgs.some((arg) => builtinFlags.help.includes(arg))) {
      await showUsage$1(...await resolveSubCommand(cmd, rawArgs));
      process.exit(0);
    } else if (rawArgs.length === 1 && builtinFlags.version.includes(rawArgs[0])) {
      const meta = typeof cmd.meta === "function" ? await cmd.meta() : await cmd.meta;
      if (!meta?.version) throw new CLIError("No version specified", "E_NO_VERSION");
      console.log(meta.version);
    } else await runCommand(cmd, { rawArgs });
  } catch (error) {
    if (error instanceof CLIError) {
      await showUsage$1(...await resolveSubCommand(cmd, rawArgs));
      console.error(error.message);
    } else console.error(error, "\n");
    process.exit(1);
  }
}
async function _resolveBuiltinFlags(cmd) {
  const argsDef = await resolveValue(cmd.args || {});
  const userNames = /* @__PURE__ */ new Set();
  const userAliases = /* @__PURE__ */ new Set();
  for (const [name, def] of Object.entries(argsDef)) {
    userNames.add(name);
    for (const alias of toArray(def.alias)) userAliases.add(alias);
  }
  return {
    help: _getBuiltinFlags("help", "h", userNames, userAliases),
    version: _getBuiltinFlags("version", "v", userNames, userAliases)
  };
}
function _getBuiltinFlags(long, short, userNames, userAliases) {
  if (userNames.has(long) || userAliases.has(long)) return [];
  if (userNames.has(short) || userAliases.has(short)) return [`--${long}`];
  return [`--${long}`, `-${short}`];
}

// ../../node_modules/.pnpm/@clack+core@0.4.1/node_modules/@clack/core/dist/index.mjs
var import_sisteransi = __toESM(require_src(), 1);
var import_node_process = require("node:process");
var f = __toESM(require("node:readline"), 1);
var import_node_readline = __toESM(require("node:readline"), 1);
var import_node_tty = require("node:tty");
var import_picocolors = __toESM(require_picocolors(), 1);
function J({ onlyFirst: t2 = false } = {}) {
  const F3 = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"].join("|");
  return new RegExp(F3, t2 ? void 0 : "g");
}
var Q = J();
function T(t2) {
  if (typeof t2 != "string") throw new TypeError(`Expected a \`string\`, got \`${typeof t2}\``);
  return t2.replace(Q, "");
}
function O(t2) {
  return t2 && t2.__esModule && Object.prototype.hasOwnProperty.call(t2, "default") ? t2.default : t2;
}
var P = { exports: {} };
(function(t2) {
  var u4 = {};
  t2.exports = u4, u4.eastAsianWidth = function(e3) {
    var s2 = e3.charCodeAt(0), i3 = e3.length == 2 ? e3.charCodeAt(1) : 0, D2 = s2;
    return 55296 <= s2 && s2 <= 56319 && 56320 <= i3 && i3 <= 57343 && (s2 &= 1023, i3 &= 1023, D2 = s2 << 10 | i3, D2 += 65536), D2 == 12288 || 65281 <= D2 && D2 <= 65376 || 65504 <= D2 && D2 <= 65510 ? "F" : D2 == 8361 || 65377 <= D2 && D2 <= 65470 || 65474 <= D2 && D2 <= 65479 || 65482 <= D2 && D2 <= 65487 || 65490 <= D2 && D2 <= 65495 || 65498 <= D2 && D2 <= 65500 || 65512 <= D2 && D2 <= 65518 ? "H" : 4352 <= D2 && D2 <= 4447 || 4515 <= D2 && D2 <= 4519 || 4602 <= D2 && D2 <= 4607 || 9001 <= D2 && D2 <= 9002 || 11904 <= D2 && D2 <= 11929 || 11931 <= D2 && D2 <= 12019 || 12032 <= D2 && D2 <= 12245 || 12272 <= D2 && D2 <= 12283 || 12289 <= D2 && D2 <= 12350 || 12353 <= D2 && D2 <= 12438 || 12441 <= D2 && D2 <= 12543 || 12549 <= D2 && D2 <= 12589 || 12593 <= D2 && D2 <= 12686 || 12688 <= D2 && D2 <= 12730 || 12736 <= D2 && D2 <= 12771 || 12784 <= D2 && D2 <= 12830 || 12832 <= D2 && D2 <= 12871 || 12880 <= D2 && D2 <= 13054 || 13056 <= D2 && D2 <= 19903 || 19968 <= D2 && D2 <= 42124 || 42128 <= D2 && D2 <= 42182 || 43360 <= D2 && D2 <= 43388 || 44032 <= D2 && D2 <= 55203 || 55216 <= D2 && D2 <= 55238 || 55243 <= D2 && D2 <= 55291 || 63744 <= D2 && D2 <= 64255 || 65040 <= D2 && D2 <= 65049 || 65072 <= D2 && D2 <= 65106 || 65108 <= D2 && D2 <= 65126 || 65128 <= D2 && D2 <= 65131 || 110592 <= D2 && D2 <= 110593 || 127488 <= D2 && D2 <= 127490 || 127504 <= D2 && D2 <= 127546 || 127552 <= D2 && D2 <= 127560 || 127568 <= D2 && D2 <= 127569 || 131072 <= D2 && D2 <= 194367 || 177984 <= D2 && D2 <= 196605 || 196608 <= D2 && D2 <= 262141 ? "W" : 32 <= D2 && D2 <= 126 || 162 <= D2 && D2 <= 163 || 165 <= D2 && D2 <= 166 || D2 == 172 || D2 == 175 || 10214 <= D2 && D2 <= 10221 || 10629 <= D2 && D2 <= 10630 ? "Na" : D2 == 161 || D2 == 164 || 167 <= D2 && D2 <= 168 || D2 == 170 || 173 <= D2 && D2 <= 174 || 176 <= D2 && D2 <= 180 || 182 <= D2 && D2 <= 186 || 188 <= D2 && D2 <= 191 || D2 == 198 || D2 == 208 || 215 <= D2 && D2 <= 216 || 222 <= D2 && D2 <= 225 || D2 == 230 || 232 <= D2 && D2 <= 234 || 236 <= D2 && D2 <= 237 || D2 == 240 || 242 <= D2 && D2 <= 243 || 247 <= D2 && D2 <= 250 || D2 == 252 || D2 == 254 || D2 == 257 || D2 == 273 || D2 == 275 || D2 == 283 || 294 <= D2 && D2 <= 295 || D2 == 299 || 305 <= D2 && D2 <= 307 || D2 == 312 || 319 <= D2 && D2 <= 322 || D2 == 324 || 328 <= D2 && D2 <= 331 || D2 == 333 || 338 <= D2 && D2 <= 339 || 358 <= D2 && D2 <= 359 || D2 == 363 || D2 == 462 || D2 == 464 || D2 == 466 || D2 == 468 || D2 == 470 || D2 == 472 || D2 == 474 || D2 == 476 || D2 == 593 || D2 == 609 || D2 == 708 || D2 == 711 || 713 <= D2 && D2 <= 715 || D2 == 717 || D2 == 720 || 728 <= D2 && D2 <= 731 || D2 == 733 || D2 == 735 || 768 <= D2 && D2 <= 879 || 913 <= D2 && D2 <= 929 || 931 <= D2 && D2 <= 937 || 945 <= D2 && D2 <= 961 || 963 <= D2 && D2 <= 969 || D2 == 1025 || 1040 <= D2 && D2 <= 1103 || D2 == 1105 || D2 == 8208 || 8211 <= D2 && D2 <= 8214 || 8216 <= D2 && D2 <= 8217 || 8220 <= D2 && D2 <= 8221 || 8224 <= D2 && D2 <= 8226 || 8228 <= D2 && D2 <= 8231 || D2 == 8240 || 8242 <= D2 && D2 <= 8243 || D2 == 8245 || D2 == 8251 || D2 == 8254 || D2 == 8308 || D2 == 8319 || 8321 <= D2 && D2 <= 8324 || D2 == 8364 || D2 == 8451 || D2 == 8453 || D2 == 8457 || D2 == 8467 || D2 == 8470 || 8481 <= D2 && D2 <= 8482 || D2 == 8486 || D2 == 8491 || 8531 <= D2 && D2 <= 8532 || 8539 <= D2 && D2 <= 8542 || 8544 <= D2 && D2 <= 8555 || 8560 <= D2 && D2 <= 8569 || D2 == 8585 || 8592 <= D2 && D2 <= 8601 || 8632 <= D2 && D2 <= 8633 || D2 == 8658 || D2 == 8660 || D2 == 8679 || D2 == 8704 || 8706 <= D2 && D2 <= 8707 || 8711 <= D2 && D2 <= 8712 || D2 == 8715 || D2 == 8719 || D2 == 8721 || D2 == 8725 || D2 == 8730 || 8733 <= D2 && D2 <= 8736 || D2 == 8739 || D2 == 8741 || 8743 <= D2 && D2 <= 8748 || D2 == 8750 || 8756 <= D2 && D2 <= 8759 || 8764 <= D2 && D2 <= 8765 || D2 == 8776 || D2 == 8780 || D2 == 8786 || 8800 <= D2 && D2 <= 8801 || 8804 <= D2 && D2 <= 8807 || 8810 <= D2 && D2 <= 8811 || 8814 <= D2 && D2 <= 8815 || 8834 <= D2 && D2 <= 8835 || 8838 <= D2 && D2 <= 8839 || D2 == 8853 || D2 == 8857 || D2 == 8869 || D2 == 8895 || D2 == 8978 || 9312 <= D2 && D2 <= 9449 || 9451 <= D2 && D2 <= 9547 || 9552 <= D2 && D2 <= 9587 || 9600 <= D2 && D2 <= 9615 || 9618 <= D2 && D2 <= 9621 || 9632 <= D2 && D2 <= 9633 || 9635 <= D2 && D2 <= 9641 || 9650 <= D2 && D2 <= 9651 || 9654 <= D2 && D2 <= 9655 || 9660 <= D2 && D2 <= 9661 || 9664 <= D2 && D2 <= 9665 || 9670 <= D2 && D2 <= 9672 || D2 == 9675 || 9678 <= D2 && D2 <= 9681 || 9698 <= D2 && D2 <= 9701 || D2 == 9711 || 9733 <= D2 && D2 <= 9734 || D2 == 9737 || 9742 <= D2 && D2 <= 9743 || 9748 <= D2 && D2 <= 9749 || D2 == 9756 || D2 == 9758 || D2 == 9792 || D2 == 9794 || 9824 <= D2 && D2 <= 9825 || 9827 <= D2 && D2 <= 9829 || 9831 <= D2 && D2 <= 9834 || 9836 <= D2 && D2 <= 9837 || D2 == 9839 || 9886 <= D2 && D2 <= 9887 || 9918 <= D2 && D2 <= 9919 || 9924 <= D2 && D2 <= 9933 || 9935 <= D2 && D2 <= 9953 || D2 == 9955 || 9960 <= D2 && D2 <= 9983 || D2 == 10045 || D2 == 10071 || 10102 <= D2 && D2 <= 10111 || 11093 <= D2 && D2 <= 11097 || 12872 <= D2 && D2 <= 12879 || 57344 <= D2 && D2 <= 63743 || 65024 <= D2 && D2 <= 65039 || D2 == 65533 || 127232 <= D2 && D2 <= 127242 || 127248 <= D2 && D2 <= 127277 || 127280 <= D2 && D2 <= 127337 || 127344 <= D2 && D2 <= 127386 || 917760 <= D2 && D2 <= 917999 || 983040 <= D2 && D2 <= 1048573 || 1048576 <= D2 && D2 <= 1114109 ? "A" : "N";
  }, u4.characterLength = function(e3) {
    var s2 = this.eastAsianWidth(e3);
    return s2 == "F" || s2 == "W" || s2 == "A" ? 2 : 1;
  };
  function F3(e3) {
    return e3.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF]/g) || [];
  }
  u4.length = function(e3) {
    for (var s2 = F3(e3), i3 = 0, D2 = 0; D2 < s2.length; D2++) i3 = i3 + this.characterLength(s2[D2]);
    return i3;
  }, u4.slice = function(e3, s2, i3) {
    textLen = u4.length(e3), s2 = s2 || 0, i3 = i3 || 1, s2 < 0 && (s2 = textLen + s2), i3 < 0 && (i3 = textLen + i3);
    for (var D2 = "", C3 = 0, o3 = F3(e3), E2 = 0; E2 < o3.length; E2++) {
      var a3 = o3[E2], n2 = u4.length(a3);
      if (C3 >= s2 - (n2 == 2 ? 1 : 0)) if (C3 + n2 <= i3) D2 += a3;
      else break;
      C3 += n2;
    }
    return D2;
  };
})(P);
var X = P.exports;
var DD = O(X);
var uD = function() {
  return /\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67)\uDB40\uDC7F|(?:\uD83E\uDDD1\uD83C\uDFFF\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFE])|(?:\uD83E\uDDD1\uD83C\uDFFE\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFD\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFC\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFB\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFC-\uDFFF])|\uD83D\uDC68(?:\uD83C\uDFFB(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFC-\uDFFF])|[\u2695\u2696\u2708]\uFE0F|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))?|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFF]))|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFE])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])\uFE0F|\u200D(?:(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D[\uDC66\uDC67])|\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC)?|(?:\uD83D\uDC69(?:\uD83C\uDFFB\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|(?:\uD83C[\uDFFC-\uDFFF])\u200D\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69]))|\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1)(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC69(?:\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83E\uDDD1(?:\u200D(?:\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83D\uDC69\u200D\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D[\uDC66\uDC67])|\uD83D\uDC69\u200D\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83E\uDDD1(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDC69(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|\uD83D\uDE36\u200D\uD83C\uDF2B|\uD83C\uDFF3\uFE0F\u200D\u26A7|\uD83D\uDC3B\u200D\u2744|(?:(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF])\u200D[\u2640\u2642]|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|\uD83C\uDFF4\u200D\u2620|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])\u200D[\u2640\u2642]|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u2600-\u2604\u260E\u2611\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26B0\u26B1\u26C8\u26CF\u26D1\u26D3\u26E9\u26F0\u26F1\u26F4\u26F7\u26F8\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u3030\u303D\u3297\u3299]|\uD83C[\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]|\uD83D[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3])\uFE0F|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|\uD83D\uDC69\u200D\uD83D\uDC67|\uD83D\uDC69\u200D\uD83D\uDC66|\uD83D\uDE35\u200D\uD83D\uDCAB|\uD83D\uDE2E\u200D\uD83D\uDCA8|\uD83D\uDC15\u200D\uD83E\uDDBA|\uD83E\uDDD1(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83D\uDC69(?:\uD83C\uDFFF|\uD83C\uDFFE|\uD83C\uDFFD|\uD83C\uDFFC|\uD83C\uDFFB)?|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF6\uD83C\uDDE6|\uD83C\uDDF4\uD83C\uDDF2|\uD83D\uDC08\u200D\u2B1B|\u2764\uFE0F\u200D(?:\uD83D\uDD25|\uD83E\uDE79)|\uD83D\uDC41\uFE0F|\uD83C\uDFF3\uFE0F|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|[#\*0-9]\uFE0F\u20E3|\u2764\uFE0F|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|\uD83C\uDFF4|(?:[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270C\u270D]|\uD83D[\uDD74\uDD90])(?:\uFE0F|\uD83C[\uDFFB-\uDFFF])|[\u270A\u270B]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC08\uDC15\uDC3B\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE2E\uDE35\uDE36\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5]|\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD4\uDDD6-\uDDDD]|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF]|[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0D\uDD0E\uDD10-\uDD17\uDD1D\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78\uDD7A-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCB\uDDD0\uDDE0-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6]|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDED5-\uDED7\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26A7\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDED5-\uDED7\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEFC\uDFE0-\uDFEB]|\uD83E[\uDD0C-\uDD3A\uDD3C-\uDD45\uDD47-\uDD78\uDD7A-\uDDCB\uDDCD-\uDDFF\uDE70-\uDE74\uDE78-\uDE7A\uDE80-\uDE86\uDE90-\uDEA8\uDEB0-\uDEB6\uDEC0-\uDEC2\uDED0-\uDED6])\uFE0F|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDC8F\uDC91\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD0C\uDD0F\uDD18-\uDD1F\uDD26\uDD30-\uDD39\uDD3C-\uDD3E\uDD77\uDDB5\uDDB6\uDDB8\uDDB9\uDDBB\uDDCD-\uDDCF\uDDD1-\uDDDD])/g;
};
var FD = O(uD);
function A(t2, u4 = {}) {
  if (typeof t2 != "string" || t2.length === 0 || (u4 = { ambiguousIsNarrow: true, ...u4 }, t2 = T(t2), t2.length === 0)) return 0;
  t2 = t2.replace(FD(), "  ");
  const F3 = u4.ambiguousIsNarrow ? 1 : 2;
  let e3 = 0;
  for (const s2 of t2) {
    const i3 = s2.codePointAt(0);
    if (i3 <= 31 || i3 >= 127 && i3 <= 159 || i3 >= 768 && i3 <= 879) continue;
    switch (DD.eastAsianWidth(s2)) {
      case "F":
      case "W":
        e3 += 2;
        break;
      case "A":
        e3 += F3;
        break;
      default:
        e3 += 1;
    }
  }
  return e3;
}
var m = 10;
var L = (t2 = 0) => (u4) => `\x1B[${u4 + t2}m`;
var N = (t2 = 0) => (u4) => `\x1B[${38 + t2};5;${u4}m`;
var I = (t2 = 0) => (u4, F3, e3) => `\x1B[${38 + t2};2;${u4};${F3};${e3}m`;
var r = { modifier: { reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], overline: [53, 55], inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29] }, color: { black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], blackBright: [90, 39], gray: [90, 39], grey: [90, 39], redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39], blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39] }, bgColor: { bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49], bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49], bgBlackBright: [100, 49], bgGray: [100, 49], bgGrey: [100, 49], bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49], bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49], bgWhiteBright: [107, 49] } };
Object.keys(r.modifier);
var tD = Object.keys(r.color);
var eD = Object.keys(r.bgColor);
[...tD, ...eD];
function sD() {
  const t2 = /* @__PURE__ */ new Map();
  for (const [u4, F3] of Object.entries(r)) {
    for (const [e3, s2] of Object.entries(F3)) r[e3] = { open: `\x1B[${s2[0]}m`, close: `\x1B[${s2[1]}m` }, F3[e3] = r[e3], t2.set(s2[0], s2[1]);
    Object.defineProperty(r, u4, { value: F3, enumerable: false });
  }
  return Object.defineProperty(r, "codes", { value: t2, enumerable: false }), r.color.close = "\x1B[39m", r.bgColor.close = "\x1B[49m", r.color.ansi = L(), r.color.ansi256 = N(), r.color.ansi16m = I(), r.bgColor.ansi = L(m), r.bgColor.ansi256 = N(m), r.bgColor.ansi16m = I(m), Object.defineProperties(r, { rgbToAnsi256: { value: (u4, F3, e3) => u4 === F3 && F3 === e3 ? u4 < 8 ? 16 : u4 > 248 ? 231 : Math.round((u4 - 8) / 247 * 24) + 232 : 16 + 36 * Math.round(u4 / 255 * 5) + 6 * Math.round(F3 / 255 * 5) + Math.round(e3 / 255 * 5), enumerable: false }, hexToRgb: { value: (u4) => {
    const F3 = /[a-f\d]{6}|[a-f\d]{3}/i.exec(u4.toString(16));
    if (!F3) return [0, 0, 0];
    let [e3] = F3;
    e3.length === 3 && (e3 = [...e3].map((i3) => i3 + i3).join(""));
    const s2 = Number.parseInt(e3, 16);
    return [s2 >> 16 & 255, s2 >> 8 & 255, s2 & 255];
  }, enumerable: false }, hexToAnsi256: { value: (u4) => r.rgbToAnsi256(...r.hexToRgb(u4)), enumerable: false }, ansi256ToAnsi: { value: (u4) => {
    if (u4 < 8) return 30 + u4;
    if (u4 < 16) return 90 + (u4 - 8);
    let F3, e3, s2;
    if (u4 >= 232) F3 = ((u4 - 232) * 10 + 8) / 255, e3 = F3, s2 = F3;
    else {
      u4 -= 16;
      const C3 = u4 % 36;
      F3 = Math.floor(u4 / 36) / 5, e3 = Math.floor(C3 / 6) / 5, s2 = C3 % 6 / 5;
    }
    const i3 = Math.max(F3, e3, s2) * 2;
    if (i3 === 0) return 30;
    let D2 = 30 + (Math.round(s2) << 2 | Math.round(e3) << 1 | Math.round(F3));
    return i3 === 2 && (D2 += 60), D2;
  }, enumerable: false }, rgbToAnsi: { value: (u4, F3, e3) => r.ansi256ToAnsi(r.rgbToAnsi256(u4, F3, e3)), enumerable: false }, hexToAnsi: { value: (u4) => r.ansi256ToAnsi(r.hexToAnsi256(u4)), enumerable: false } }), r;
}
var iD = sD();
var v = /* @__PURE__ */ new Set(["\x1B", "\x9B"]);
var CD = 39;
var w = "\x07";
var W = "[";
var rD = "]";
var R = "m";
var y = `${rD}8;;`;
var V = (t2) => `${v.values().next().value}${W}${t2}${R}`;
var z = (t2) => `${v.values().next().value}${y}${t2}${w}`;
var ED = (t2) => t2.split(" ").map((u4) => A(u4));
var _ = (t2, u4, F3) => {
  const e3 = [...u4];
  let s2 = false, i3 = false, D2 = A(T(t2[t2.length - 1]));
  for (const [C3, o3] of e3.entries()) {
    const E2 = A(o3);
    if (D2 + E2 <= F3 ? t2[t2.length - 1] += o3 : (t2.push(o3), D2 = 0), v.has(o3) && (s2 = true, i3 = e3.slice(C3 + 1).join("").startsWith(y)), s2) {
      i3 ? o3 === w && (s2 = false, i3 = false) : o3 === R && (s2 = false);
      continue;
    }
    D2 += E2, D2 === F3 && C3 < e3.length - 1 && (t2.push(""), D2 = 0);
  }
  !D2 && t2[t2.length - 1].length > 0 && t2.length > 1 && (t2[t2.length - 2] += t2.pop());
};
var nD = (t2) => {
  const u4 = t2.split(" ");
  let F3 = u4.length;
  for (; F3 > 0 && !(A(u4[F3 - 1]) > 0); ) F3--;
  return F3 === u4.length ? t2 : u4.slice(0, F3).join(" ") + u4.slice(F3).join("");
};
var oD = (t2, u4, F3 = {}) => {
  if (F3.trim !== false && t2.trim() === "") return "";
  let e3 = "", s2, i3;
  const D2 = ED(t2);
  let C3 = [""];
  for (const [E2, a3] of t2.split(" ").entries()) {
    F3.trim !== false && (C3[C3.length - 1] = C3[C3.length - 1].trimStart());
    let n2 = A(C3[C3.length - 1]);
    if (E2 !== 0 && (n2 >= u4 && (F3.wordWrap === false || F3.trim === false) && (C3.push(""), n2 = 0), (n2 > 0 || F3.trim === false) && (C3[C3.length - 1] += " ", n2++)), F3.hard && D2[E2] > u4) {
      const B3 = u4 - n2, p2 = 1 + Math.floor((D2[E2] - B3 - 1) / u4);
      Math.floor((D2[E2] - 1) / u4) < p2 && C3.push(""), _(C3, a3, u4);
      continue;
    }
    if (n2 + D2[E2] > u4 && n2 > 0 && D2[E2] > 0) {
      if (F3.wordWrap === false && n2 < u4) {
        _(C3, a3, u4);
        continue;
      }
      C3.push("");
    }
    if (n2 + D2[E2] > u4 && F3.wordWrap === false) {
      _(C3, a3, u4);
      continue;
    }
    C3[C3.length - 1] += a3;
  }
  F3.trim !== false && (C3 = C3.map((E2) => nD(E2)));
  const o3 = [...C3.join(`
`)];
  for (const [E2, a3] of o3.entries()) {
    if (e3 += a3, v.has(a3)) {
      const { groups: B3 } = new RegExp(`(?:\\${W}(?<code>\\d+)m|\\${y}(?<uri>.*)${w})`).exec(o3.slice(E2).join("")) || { groups: {} };
      if (B3.code !== void 0) {
        const p2 = Number.parseFloat(B3.code);
        s2 = p2 === CD ? void 0 : p2;
      } else B3.uri !== void 0 && (i3 = B3.uri.length === 0 ? void 0 : B3.uri);
    }
    const n2 = iD.codes.get(Number(s2));
    o3[E2 + 1] === `
` ? (i3 && (e3 += z("")), s2 && n2 && (e3 += V(n2))) : a3 === `
` && (s2 && n2 && (e3 += V(s2)), i3 && (e3 += z(i3)));
  }
  return e3;
};
function G(t2, u4, F3) {
  return String(t2).normalize().replace(/\r\n/g, `
`).split(`
`).map((e3) => oD(e3, u4, F3)).join(`
`);
}
var aD = ["up", "down", "left", "right", "space", "enter", "cancel"];
var c = { actions: new Set(aD), aliases: /* @__PURE__ */ new Map([["k", "up"], ["j", "down"], ["h", "left"], ["l", "right"], ["", "cancel"], ["escape", "cancel"]]) };
function k(t2, u4) {
  if (typeof t2 == "string") return c.aliases.get(t2) === u4;
  for (const F3 of t2) if (F3 !== void 0 && k(F3, u4)) return true;
  return false;
}
function lD(t2, u4) {
  if (t2 === u4) return;
  const F3 = t2.split(`
`), e3 = u4.split(`
`), s2 = [];
  for (let i3 = 0; i3 < Math.max(F3.length, e3.length); i3++) F3[i3] !== e3[i3] && s2.push(i3);
  return s2;
}
var xD = globalThis.process.platform.startsWith("win");
var S = /* @__PURE__ */ Symbol("clack:cancel");
function d(t2, u4) {
  const F3 = t2;
  F3.isTTY && F3.setRawMode(u4);
}
function cD({ input: t2 = import_node_process.stdin, output: u4 = import_node_process.stdout, overwrite: F3 = true, hideCursor: e3 = true } = {}) {
  const s2 = f.createInterface({ input: t2, output: u4, prompt: "", tabSize: 1 });
  f.emitKeypressEvents(t2, s2), t2.isTTY && t2.setRawMode(true);
  const i3 = (D2, { name: C3, sequence: o3 }) => {
    const E2 = String(D2);
    if (k([E2, C3, o3], "cancel")) {
      e3 && u4.write(import_sisteransi.cursor.show), process.exit(0);
      return;
    }
    if (!F3) return;
    const a3 = C3 === "return" ? 0 : -1, n2 = C3 === "return" ? -1 : 0;
    f.moveCursor(u4, a3, n2, () => {
      f.clearLine(u4, 1, () => {
        t2.once("keypress", i3);
      });
    });
  };
  return e3 && u4.write(import_sisteransi.cursor.hide), t2.once("keypress", i3), () => {
    t2.off("keypress", i3), e3 && u4.write(import_sisteransi.cursor.show), t2.isTTY && !xD && t2.setRawMode(false), s2.terminal = false, s2.close();
  };
}
var AD = Object.defineProperty;
var pD = (t2, u4, F3) => u4 in t2 ? AD(t2, u4, { enumerable: true, configurable: true, writable: true, value: F3 }) : t2[u4] = F3;
var h = (t2, u4, F3) => (pD(t2, typeof u4 != "symbol" ? u4 + "" : u4, F3), F3);
var x = class {
  constructor(u4, F3 = true) {
    h(this, "input"), h(this, "output"), h(this, "_abortSignal"), h(this, "rl"), h(this, "opts"), h(this, "_render"), h(this, "_track", false), h(this, "_prevFrame", ""), h(this, "_subscribers", /* @__PURE__ */ new Map()), h(this, "_cursor", 0), h(this, "state", "initial"), h(this, "error", ""), h(this, "value");
    const { input: e3 = import_node_process.stdin, output: s2 = import_node_process.stdout, render: i3, signal: D2, ...C3 } = u4;
    this.opts = C3, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = i3.bind(this), this._track = F3, this._abortSignal = D2, this.input = e3, this.output = s2;
  }
  unsubscribe() {
    this._subscribers.clear();
  }
  setSubscriber(u4, F3) {
    const e3 = this._subscribers.get(u4) ?? [];
    e3.push(F3), this._subscribers.set(u4, e3);
  }
  on(u4, F3) {
    this.setSubscriber(u4, { cb: F3 });
  }
  once(u4, F3) {
    this.setSubscriber(u4, { cb: F3, once: true });
  }
  emit(u4, ...F3) {
    const e3 = this._subscribers.get(u4) ?? [], s2 = [];
    for (const i3 of e3) i3.cb(...F3), i3.once && s2.push(() => e3.splice(e3.indexOf(i3), 1));
    for (const i3 of s2) i3();
  }
  prompt() {
    return new Promise((u4, F3) => {
      if (this._abortSignal) {
        if (this._abortSignal.aborted) return this.state = "cancel", this.close(), u4(S);
        this._abortSignal.addEventListener("abort", () => {
          this.state = "cancel", this.close();
        }, { once: true });
      }
      const e3 = new import_node_tty.WriteStream(0);
      e3._write = (s2, i3, D2) => {
        this._track && (this.value = this.rl?.line.replace(/\t/g, ""), this._cursor = this.rl?.cursor ?? 0, this.emit("value", this.value)), D2();
      }, this.input.pipe(e3), this.rl = import_node_readline.default.createInterface({ input: this.input, output: e3, tabSize: 2, prompt: "", escapeCodeTimeout: 50 }), import_node_readline.default.emitKeypressEvents(this.input, this.rl), this.rl.prompt(), this.opts.initialValue !== void 0 && this._track && this.rl.write(this.opts.initialValue), this.input.on("keypress", this.onKeypress), d(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), d(this.input, false), u4(this.value);
      }), this.once("cancel", () => {
        this.output.write(import_sisteransi.cursor.show), this.output.off("resize", this.render), d(this.input, false), u4(S);
      });
    });
  }
  onKeypress(u4, F3) {
    if (this.state === "error" && (this.state = "active"), F3?.name && (!this._track && c.aliases.has(F3.name) && this.emit("cursor", c.aliases.get(F3.name)), c.actions.has(F3.name) && this.emit("cursor", F3.name)), u4 && (u4.toLowerCase() === "y" || u4.toLowerCase() === "n") && this.emit("confirm", u4.toLowerCase() === "y"), u4 === "	" && this.opts.placeholder && (this.value || (this.rl?.write(this.opts.placeholder), this.emit("value", this.opts.placeholder))), u4 && this.emit("key", u4.toLowerCase()), F3?.name === "return") {
      if (this.opts.validate) {
        const e3 = this.opts.validate(this.value);
        e3 && (this.error = e3 instanceof Error ? e3.message : e3, this.state = "error", this.rl?.write(this.value));
      }
      this.state !== "error" && (this.state = "submit");
    }
    k([u4, F3?.name, F3?.sequence], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
  }
  close() {
    this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), d(this.input, false), this.rl?.close(), this.rl = void 0, this.emit(`${this.state}`, this.value), this.unsubscribe();
  }
  restoreCursor() {
    const u4 = G(this._prevFrame, process.stdout.columns, { hard: true }).split(`
`).length - 1;
    this.output.write(import_sisteransi.cursor.move(-999, u4 * -1));
  }
  render() {
    const u4 = G(this._render(this) ?? "", process.stdout.columns, { hard: true });
    if (u4 !== this._prevFrame) {
      if (this.state === "initial") this.output.write(import_sisteransi.cursor.hide);
      else {
        const F3 = lD(this._prevFrame, u4);
        if (this.restoreCursor(), F3 && F3?.length === 1) {
          const e3 = F3[0];
          this.output.write(import_sisteransi.cursor.move(0, e3)), this.output.write(import_sisteransi.erase.lines(1));
          const s2 = u4.split(`
`);
          this.output.write(s2[e3]), this._prevFrame = u4, this.output.write(import_sisteransi.cursor.move(0, s2.length - e3 - 1));
          return;
        }
        if (F3 && F3?.length > 1) {
          const e3 = F3[0];
          this.output.write(import_sisteransi.cursor.move(0, e3)), this.output.write(import_sisteransi.erase.down());
          const s2 = u4.split(`
`).slice(e3);
          this.output.write(s2.join(`
`)), this._prevFrame = u4;
          return;
        }
        this.output.write(import_sisteransi.erase.down());
      }
      this.output.write(u4), this.state === "initial" && (this.state = "active"), this._prevFrame = u4;
    }
  }
};
var fD = class extends x {
  get cursor() {
    return this.value ? 0 : 1;
  }
  get _value() {
    return this.cursor === 0;
  }
  constructor(u4) {
    super(u4, false), this.value = !!u4.initialValue, this.on("value", () => {
      this.value = this._value;
    }), this.on("confirm", (F3) => {
      this.output.write(import_sisteransi.cursor.move(0, -1)), this.value = F3, this.state = "submit", this.close();
    }), this.on("cursor", () => {
      this.value = !this.value;
    });
  }
};
var PD = class extends x {
  get valueWithCursor() {
    if (this.state === "submit") return this.value;
    if (this.cursor >= this.value.length) return `${this.value}\u2588`;
    const u4 = this.value.slice(0, this.cursor), [F3, ...e3] = this.value.slice(this.cursor);
    return `${u4}${import_picocolors.default.inverse(F3)}${e3.join("")}`;
  }
  get cursor() {
    return this._cursor;
  }
  constructor(u4) {
    super(u4), this.on("finalize", () => {
      this.value || (this.value = u4.defaultValue);
    });
  }
};

// ../../node_modules/.pnpm/@clack+prompts@0.9.1/node_modules/@clack/prompts/dist/index.mjs
var import_node_process2 = __toESM(require("node:process"), 1);
var import_picocolors2 = __toESM(require_picocolors(), 1);
var import_sisteransi2 = __toESM(require_src(), 1);
function X2() {
  return import_node_process2.default.platform !== "win32" ? import_node_process2.default.env.TERM !== "linux" : !!import_node_process2.default.env.CI || !!import_node_process2.default.env.WT_SESSION || !!import_node_process2.default.env.TERMINUS_SUBLIME || import_node_process2.default.env.ConEmuTask === "{cmd::Cmder}" || import_node_process2.default.env.TERM_PROGRAM === "Terminus-Sublime" || import_node_process2.default.env.TERM_PROGRAM === "vscode" || import_node_process2.default.env.TERM === "xterm-256color" || import_node_process2.default.env.TERM === "alacritty" || import_node_process2.default.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var E = X2();
var u = (s2, n2) => E ? s2 : n2;
var ee = u("\u25C6", "*");
var A2 = u("\u25A0", "x");
var B = u("\u25B2", "x");
var S2 = u("\u25C7", "o");
var te = u("\u250C", "T");
var a = u("\u2502", "|");
var m2 = u("\u2514", "\u2014");
var j2 = u("\u25CF", ">");
var R2 = u("\u25CB", " ");
var V2 = u("\u25FB", "[\u2022]");
var M2 = u("\u25FC", "[+]");
var G2 = u("\u25FB", "[ ]");
var se = u("\u25AA", "\u2022");
var N2 = u("\u2500", "-");
var re = u("\u256E", "+");
var ie = u("\u251C", "+");
var ne = u("\u256F", "+");
var ae = u("\u25CF", "\u2022");
var oe = u("\u25C6", "*");
var ce = u("\u25B2", "!");
var le = u("\u25A0", "x");
var y2 = (s2) => {
  switch (s2) {
    case "initial":
    case "active":
      return import_picocolors2.default.cyan(ee);
    case "cancel":
      return import_picocolors2.default.red(A2);
    case "error":
      return import_picocolors2.default.yellow(B);
    case "submit":
      return import_picocolors2.default.green(S2);
  }
};
var ue = (s2) => new PD({ validate: s2.validate, placeholder: s2.placeholder, defaultValue: s2.defaultValue, initialValue: s2.initialValue, render() {
  const n2 = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s2.message}
`, t2 = s2.placeholder ? import_picocolors2.default.inverse(s2.placeholder[0]) + import_picocolors2.default.dim(s2.placeholder.slice(1)) : import_picocolors2.default.inverse(import_picocolors2.default.hidden("_")), i3 = this.value ? this.valueWithCursor : t2;
  switch (this.state) {
    case "error":
      return `${n2.trim()}
${import_picocolors2.default.yellow(a)}  ${i3}
${import_picocolors2.default.yellow(m2)}  ${import_picocolors2.default.yellow(this.error)}
`;
    case "submit":
      return `${n2}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(this.value || s2.placeholder)}`;
    case "cancel":
      return `${n2}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(this.value ?? ""))}${this.value?.trim() ? `
${import_picocolors2.default.gray(a)}` : ""}`;
    default:
      return `${n2}${import_picocolors2.default.cyan(a)}  ${i3}
${import_picocolors2.default.cyan(m2)}
`;
  }
} }).prompt();
var me = (s2) => {
  const n2 = s2.active ?? "Yes", t2 = s2.inactive ?? "No";
  return new fD({ active: n2, inactive: t2, initialValue: s2.initialValue ?? true, render() {
    const i3 = `${import_picocolors2.default.gray(a)}
${y2(this.state)}  ${s2.message}
`, r4 = this.value ? n2 : t2;
    switch (this.state) {
      case "submit":
        return `${i3}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.dim(r4)}`;
      case "cancel":
        return `${i3}${import_picocolors2.default.gray(a)}  ${import_picocolors2.default.strikethrough(import_picocolors2.default.dim(r4))}
${import_picocolors2.default.gray(a)}`;
      default:
        return `${i3}${import_picocolors2.default.cyan(a)}  ${this.value ? `${import_picocolors2.default.green(j2)} ${n2}` : `${import_picocolors2.default.dim(R2)} ${import_picocolors2.default.dim(n2)}`} ${import_picocolors2.default.dim("/")} ${this.value ? `${import_picocolors2.default.dim(R2)} ${import_picocolors2.default.dim(t2)}` : `${import_picocolors2.default.green(j2)} ${t2}`}
${import_picocolors2.default.cyan(m2)}
`;
    }
  } }).prompt();
};
var we = (s2 = "") => {
  process.stdout.write(`${import_picocolors2.default.gray(te)}  ${s2}
`);
};
var fe = (s2 = "") => {
  process.stdout.write(`${import_picocolors2.default.gray(a)}
${import_picocolors2.default.gray(m2)}  ${s2}

`);
};
var L2 = () => {
  const s2 = E ? ["\u25D2", "\u25D0", "\u25D3", "\u25D1"] : ["\u2022", "o", "O", "0"], n2 = E ? 80 : 120, t2 = process.env.CI === "true";
  let i3, r4, c4 = false, o3 = "", l3;
  const $2 = (h3) => {
    const g4 = h3 > 1 ? "Something went wrong" : "Canceled";
    c4 && P4(g4, h3);
  }, d3 = () => $2(2), w3 = () => $2(1), b3 = () => {
    process.on("uncaughtExceptionMonitor", d3), process.on("unhandledRejection", d3), process.on("SIGINT", w3), process.on("SIGTERM", w3), process.on("exit", $2);
  }, C3 = () => {
    process.removeListener("uncaughtExceptionMonitor", d3), process.removeListener("unhandledRejection", d3), process.removeListener("SIGINT", w3), process.removeListener("SIGTERM", w3), process.removeListener("exit", $2);
  }, I4 = () => {
    if (l3 === void 0) return;
    t2 && process.stdout.write(`
`);
    const h3 = l3.split(`
`);
    process.stdout.write(import_sisteransi2.cursor.move(-999, h3.length - 1)), process.stdout.write(import_sisteransi2.erase.down(h3.length));
  }, x4 = (h3) => h3.replace(/\.+$/, ""), O4 = (h3 = "") => {
    c4 = true, i3 = cD(), o3 = x4(h3), process.stdout.write(`${import_picocolors2.default.gray(a)}
`);
    let g4 = 0, f4 = 0;
    b3(), r4 = setInterval(() => {
      if (t2 && o3 === l3) return;
      I4(), l3 = o3;
      const W3 = import_picocolors2.default.magenta(s2[g4]), _4 = t2 ? "..." : ".".repeat(Math.floor(f4)).slice(0, 3);
      process.stdout.write(`${W3}  ${o3}${_4}`), g4 = g4 + 1 < s2.length ? g4 + 1 : 0, f4 = f4 < s2.length ? f4 + 0.125 : 0;
    }, n2);
  }, P4 = (h3 = "", g4 = 0) => {
    c4 = false, clearInterval(r4), I4();
    const f4 = g4 === 0 ? import_picocolors2.default.green(S2) : g4 === 1 ? import_picocolors2.default.red(A2) : import_picocolors2.default.red(B);
    o3 = x4(h3 ?? o3), process.stdout.write(`${f4}  ${o3}
`), C3(), i3();
  };
  return { start: O4, stop: P4, message: (h3 = "") => {
    o3 = x4(h3 ?? o3);
  } };
};

// ../../node_modules/.pnpm/consola@3.4.2/node_modules/consola/dist/core.mjs
var LogLevels = {
  silent: Number.NEGATIVE_INFINITY,
  fatal: 0,
  error: 0,
  warn: 1,
  log: 2,
  info: 3,
  success: 3,
  fail: 3,
  ready: 3,
  start: 3,
  box: 3,
  debug: 4,
  trace: 5,
  verbose: Number.POSITIVE_INFINITY
};
var LogTypes = {
  // Silent
  silent: {
    level: -1
  },
  // Level 0
  fatal: {
    level: LogLevels.fatal
  },
  error: {
    level: LogLevels.error
  },
  // Level 1
  warn: {
    level: LogLevels.warn
  },
  // Level 2
  log: {
    level: LogLevels.log
  },
  // Level 3
  info: {
    level: LogLevels.info
  },
  success: {
    level: LogLevels.success
  },
  fail: {
    level: LogLevels.fail
  },
  ready: {
    level: LogLevels.info
  },
  start: {
    level: LogLevels.info
  },
  box: {
    level: LogLevels.info
  },
  // Level 4
  debug: {
    level: LogLevels.debug
  },
  // Level 5
  trace: {
    level: LogLevels.trace
  },
  // Verbose
  verbose: {
    level: LogLevels.verbose
  }
};
function isPlainObject$1(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype && Object.getPrototypeOf(prototype) !== null) {
    return false;
  }
  if (Symbol.iterator in value) {
    return false;
  }
  if (Symbol.toStringTag in value) {
    return Object.prototype.toString.call(value) === "[object Module]";
  }
  return true;
}
function _defu(baseObject, defaults, namespace = ".", merger) {
  if (!isPlainObject$1(defaults)) {
    return _defu(baseObject, {}, namespace, merger);
  }
  const object = Object.assign({}, defaults);
  for (const key in baseObject) {
    if (key === "__proto__" || key === "constructor") {
      continue;
    }
    const value = baseObject[key];
    if (value === null || value === void 0) {
      continue;
    }
    if (merger && merger(object, key, value, namespace)) {
      continue;
    }
    if (Array.isArray(value) && Array.isArray(object[key])) {
      object[key] = [...value, ...object[key]];
    } else if (isPlainObject$1(value) && isPlainObject$1(object[key])) {
      object[key] = _defu(
        value,
        object[key],
        (namespace ? `${namespace}.` : "") + key.toString(),
        merger
      );
    } else {
      object[key] = value;
    }
  }
  return object;
}
function createDefu(merger) {
  return (...arguments_) => (
    // eslint-disable-next-line unicorn/no-array-reduce
    arguments_.reduce((p2, c4) => _defu(p2, c4, "", merger), {})
  );
}
var defu = createDefu();
function isPlainObject(obj) {
  return Object.prototype.toString.call(obj) === "[object Object]";
}
function isLogObj(arg) {
  if (!isPlainObject(arg)) {
    return false;
  }
  if (!arg.message && !arg.args) {
    return false;
  }
  if (arg.stack) {
    return false;
  }
  return true;
}
var paused = false;
var queue = [];
var Consola = class _Consola {
  options;
  _lastLog;
  _mockFn;
  /**
   * Creates an instance of Consola with specified options or defaults.
   *
   * @param {Partial<ConsolaOptions>} [options={}] - Configuration options for the Consola instance.
   */
  constructor(options = {}) {
    const types = options.types || LogTypes;
    this.options = defu(
      {
        ...options,
        defaults: { ...options.defaults },
        level: _normalizeLogLevel(options.level, types),
        reporters: [...options.reporters || []]
      },
      {
        types: LogTypes,
        throttle: 1e3,
        throttleMin: 5,
        formatOptions: {
          date: true,
          colors: false,
          compact: true
        }
      }
    );
    for (const type in types) {
      const defaults = {
        type,
        ...this.options.defaults,
        ...types[type]
      };
      this[type] = this._wrapLogFn(defaults);
      this[type].raw = this._wrapLogFn(
        defaults,
        true
      );
    }
    if (this.options.mockFn) {
      this.mockTypes();
    }
    this._lastLog = {};
  }
  /**
   * Gets the current log level of the Consola instance.
   *
   * @returns {number} The current log level.
   */
  get level() {
    return this.options.level;
  }
  /**
   * Sets the minimum log level that will be output by the instance.
   *
   * @param {number} level - The new log level to set.
   */
  set level(level) {
    this.options.level = _normalizeLogLevel(
      level,
      this.options.types,
      this.options.level
    );
  }
  /**
   * Displays a prompt to the user and returns the response.
   * Throw an error if `prompt` is not supported by the current configuration.
   *
   * @template T
   * @param {string} message - The message to display in the prompt.
   * @param {T} [opts] - Optional options for the prompt. See {@link PromptOptions}.
   * @returns {promise<T>} A promise that infer with the prompt options. See {@link PromptOptions}.
   */
  prompt(message, opts) {
    if (!this.options.prompt) {
      throw new Error("prompt is not supported!");
    }
    return this.options.prompt(message, opts);
  }
  /**
   * Creates a new instance of Consola, inheriting options from the current instance, with possible overrides.
   *
   * @param {Partial<ConsolaOptions>} options - Optional overrides for the new instance. See {@link ConsolaOptions}.
   * @returns {ConsolaInstance} A new Consola instance. See {@link ConsolaInstance}.
   */
  create(options) {
    const instance = new _Consola({
      ...this.options,
      ...options
    });
    if (this._mockFn) {
      instance.mockTypes(this._mockFn);
    }
    return instance;
  }
  /**
   * Creates a new Consola instance with the specified default log object properties.
   *
   * @param {InputLogObject} defaults - Default properties to include in any log from the new instance. See {@link InputLogObject}.
   * @returns {ConsolaInstance} A new Consola instance. See {@link ConsolaInstance}.
   */
  withDefaults(defaults) {
    return this.create({
      ...this.options,
      defaults: {
        ...this.options.defaults,
        ...defaults
      }
    });
  }
  /**
   * Creates a new Consola instance with a specified tag, which will be included in every log.
   *
   * @param {string} tag - The tag to include in each log of the new instance.
   * @returns {ConsolaInstance} A new Consola instance. See {@link ConsolaInstance}.
   */
  withTag(tag) {
    return this.withDefaults({
      tag: this.options.defaults.tag ? this.options.defaults.tag + ":" + tag : tag
    });
  }
  /**
   * Adds a custom reporter to the Consola instance.
   * Reporters will be called for each log message, depending on their implementation and log level.
   *
   * @param {ConsolaReporter} reporter - The reporter to add. See {@link ConsolaReporter}.
   * @returns {Consola} The current Consola instance.
   */
  addReporter(reporter) {
    this.options.reporters.push(reporter);
    return this;
  }
  /**
   * Removes a custom reporter from the Consola instance.
   * If no reporter is specified, all reporters will be removed.
   *
   * @param {ConsolaReporter} reporter - The reporter to remove. See {@link ConsolaReporter}.
   * @returns {Consola} The current Consola instance.
   */
  removeReporter(reporter) {
    if (reporter) {
      const i3 = this.options.reporters.indexOf(reporter);
      if (i3 !== -1) {
        return this.options.reporters.splice(i3, 1);
      }
    } else {
      this.options.reporters.splice(0);
    }
    return this;
  }
  /**
   * Replaces all reporters of the Consola instance with the specified array of reporters.
   *
   * @param {ConsolaReporter[]} reporters - The new reporters to set. See {@link ConsolaReporter}.
   * @returns {Consola} The current Consola instance.
   */
  setReporters(reporters) {
    this.options.reporters = Array.isArray(reporters) ? reporters : [reporters];
    return this;
  }
  wrapAll() {
    this.wrapConsole();
    this.wrapStd();
  }
  restoreAll() {
    this.restoreConsole();
    this.restoreStd();
  }
  /**
   * Overrides console methods with Consola logging methods for consistent logging.
   */
  wrapConsole() {
    for (const type in this.options.types) {
      if (!console["__" + type]) {
        console["__" + type] = console[type];
      }
      console[type] = this[type].raw;
    }
  }
  /**
   * Restores the original console methods, removing Consola overrides.
   */
  restoreConsole() {
    for (const type in this.options.types) {
      if (console["__" + type]) {
        console[type] = console["__" + type];
        delete console["__" + type];
      }
    }
  }
  /**
   * Overrides standard output and error streams to redirect them through Consola.
   */
  wrapStd() {
    this._wrapStream(this.options.stdout, "log");
    this._wrapStream(this.options.stderr, "log");
  }
  _wrapStream(stream, type) {
    if (!stream) {
      return;
    }
    if (!stream.__write) {
      stream.__write = stream.write;
    }
    stream.write = (data) => {
      this[type].raw(String(data).trim());
    };
  }
  /**
   * Restores the original standard output and error streams, removing the Consola redirection.
   */
  restoreStd() {
    this._restoreStream(this.options.stdout);
    this._restoreStream(this.options.stderr);
  }
  _restoreStream(stream) {
    if (!stream) {
      return;
    }
    if (stream.__write) {
      stream.write = stream.__write;
      delete stream.__write;
    }
  }
  /**
   * Pauses logging, queues incoming logs until resumed.
   */
  pauseLogs() {
    paused = true;
  }
  /**
   * Resumes logging, processing any queued logs.
   */
  resumeLogs() {
    paused = false;
    const _queue = queue.splice(0);
    for (const item of _queue) {
      item[0]._logFn(item[1], item[2]);
    }
  }
  /**
   * Replaces logging methods with mocks if a mock function is provided.
   *
   * @param {ConsolaOptions["mockFn"]} mockFn - The function to use for mocking logging methods. See {@link ConsolaOptions["mockFn"]}.
   */
  mockTypes(mockFn) {
    const _mockFn = mockFn || this.options.mockFn;
    this._mockFn = _mockFn;
    if (typeof _mockFn !== "function") {
      return;
    }
    for (const type in this.options.types) {
      this[type] = _mockFn(type, this.options.types[type]) || this[type];
      this[type].raw = this[type];
    }
  }
  _wrapLogFn(defaults, isRaw) {
    return (...args) => {
      if (paused) {
        queue.push([this, defaults, args, isRaw]);
        return;
      }
      return this._logFn(defaults, args, isRaw);
    };
  }
  _logFn(defaults, args, isRaw) {
    if ((defaults.level || 0) > this.level) {
      return false;
    }
    const logObj = {
      date: /* @__PURE__ */ new Date(),
      args: [],
      ...defaults,
      level: _normalizeLogLevel(defaults.level, this.options.types)
    };
    if (!isRaw && args.length === 1 && isLogObj(args[0])) {
      Object.assign(logObj, args[0]);
    } else {
      logObj.args = [...args];
    }
    if (logObj.message) {
      logObj.args.unshift(logObj.message);
      delete logObj.message;
    }
    if (logObj.additional) {
      if (!Array.isArray(logObj.additional)) {
        logObj.additional = logObj.additional.split("\n");
      }
      logObj.args.push("\n" + logObj.additional.join("\n"));
      delete logObj.additional;
    }
    logObj.type = typeof logObj.type === "string" ? logObj.type.toLowerCase() : "log";
    logObj.tag = typeof logObj.tag === "string" ? logObj.tag : "";
    const resolveLog = (newLog = false) => {
      const repeated = (this._lastLog.count || 0) - this.options.throttleMin;
      if (this._lastLog.object && repeated > 0) {
        const args2 = [...this._lastLog.object.args];
        if (repeated > 1) {
          args2.push(`(repeated ${repeated} times)`);
        }
        this._log({ ...this._lastLog.object, args: args2 });
        this._lastLog.count = 1;
      }
      if (newLog) {
        this._lastLog.object = logObj;
        this._log(logObj);
      }
    };
    clearTimeout(this._lastLog.timeout);
    const diffTime = this._lastLog.time && logObj.date ? logObj.date.getTime() - this._lastLog.time.getTime() : 0;
    this._lastLog.time = logObj.date;
    if (diffTime < this.options.throttle) {
      try {
        const serializedLog = JSON.stringify([
          logObj.type,
          logObj.tag,
          logObj.args
        ]);
        const isSameLog = this._lastLog.serialized === serializedLog;
        this._lastLog.serialized = serializedLog;
        if (isSameLog) {
          this._lastLog.count = (this._lastLog.count || 0) + 1;
          if (this._lastLog.count > this.options.throttleMin) {
            this._lastLog.timeout = setTimeout(
              resolveLog,
              this.options.throttle
            );
            return;
          }
        }
      } catch {
      }
    }
    resolveLog(true);
  }
  _log(logObj) {
    for (const reporter of this.options.reporters) {
      reporter.log(logObj, {
        options: this.options
      });
    }
  }
};
function _normalizeLogLevel(input, types = {}, defaultLevel = 3) {
  if (input === void 0) {
    return defaultLevel;
  }
  if (typeof input === "number") {
    return input;
  }
  if (types[input] && types[input].level !== void 0) {
    return types[input].level;
  }
  return defaultLevel;
}
Consola.prototype.add = Consola.prototype.addReporter;
Consola.prototype.remove = Consola.prototype.removeReporter;
Consola.prototype.clear = Consola.prototype.removeReporter;
Consola.prototype.withScope = Consola.prototype.withTag;
Consola.prototype.mock = Consola.prototype.mockTypes;
Consola.prototype.pause = Consola.prototype.pauseLogs;
Consola.prototype.resume = Consola.prototype.resumeLogs;
function createConsola(options = {}) {
  return new Consola(options);
}

// ../../node_modules/.pnpm/consola@3.4.2/node_modules/consola/dist/shared/consola.DRwqZj3T.mjs
var import_node_util2 = require("node:util");
var import_node_path = require("node:path");
function parseStack(stack, message) {
  const cwd = process.cwd() + import_node_path.sep;
  const lines = stack.split("\n").splice(message.split("\n").length).map((l3) => l3.trim().replace("file://", "").replace(cwd, ""));
  return lines;
}
function writeStream(data, stream) {
  const write = stream.__write || stream.write;
  return write.call(stream, data);
}
var bracket = (x4) => x4 ? `[${x4}]` : "";
var BasicReporter = class {
  formatStack(stack, message, opts) {
    const indent = "  ".repeat((opts?.errorLevel || 0) + 1);
    return indent + parseStack(stack, message).join(`
${indent}`);
  }
  formatError(err2, opts) {
    const message = err2.message ?? (0, import_node_util2.formatWithOptions)(opts, err2);
    const stack = err2.stack ? this.formatStack(err2.stack, message, opts) : "";
    const level = opts?.errorLevel || 0;
    const causedPrefix = level > 0 ? `${"  ".repeat(level)}[cause]: ` : "";
    const causedError = err2.cause ? "\n\n" + this.formatError(err2.cause, { ...opts, errorLevel: level + 1 }) : "";
    return causedPrefix + message + "\n" + stack + causedError;
  }
  formatArgs(args, opts) {
    const _args = args.map((arg) => {
      if (arg && typeof arg.stack === "string") {
        return this.formatError(arg, opts);
      }
      return arg;
    });
    return (0, import_node_util2.formatWithOptions)(opts, ..._args);
  }
  formatDate(date, opts) {
    return opts.date ? date.toLocaleTimeString() : "";
  }
  filterAndJoin(arr) {
    return arr.filter(Boolean).join(" ");
  }
  formatLogObj(logObj, opts) {
    const message = this.formatArgs(logObj.args, opts);
    if (logObj.type === "box") {
      return "\n" + [
        bracket(logObj.tag),
        logObj.title && logObj.title,
        ...message.split("\n")
      ].filter(Boolean).map((l3) => " > " + l3).join("\n") + "\n";
    }
    return this.filterAndJoin([
      bracket(logObj.type),
      bracket(logObj.tag),
      message
    ]);
  }
  log(logObj, ctx) {
    const line = this.formatLogObj(logObj, {
      columns: ctx.options.stdout.columns || 0,
      ...ctx.options.formatOptions
    });
    return writeStream(
      line + "\n",
      logObj.level < 2 ? ctx.options.stderr || process.stderr : ctx.options.stdout || process.stdout
    );
  }
};

// ../../node_modules/.pnpm/consola@3.4.2/node_modules/consola/dist/index.mjs
var import_node_process4 = __toESM(require("node:process"), 1);

// ../../node_modules/.pnpm/consola@3.4.2/node_modules/consola/dist/shared/consola.DXBYu-KD.mjs
var tty = __toESM(require("node:tty"), 1);
var {
  env = {},
  argv = [],
  platform = ""
} = typeof process === "undefined" ? {} : process;
var isDisabled = "NO_COLOR" in env || argv.includes("--no-color");
var isForced = "FORCE_COLOR" in env || argv.includes("--color");
var isWindows = platform === "win32";
var isDumbTerminal = env.TERM === "dumb";
var isCompatibleTerminal = tty && tty.isatty && tty.isatty(1) && env.TERM && !isDumbTerminal;
var isCI = "CI" in env && ("GITHUB_ACTIONS" in env || "GITLAB_CI" in env || "CIRCLECI" in env);
var isColorSupported = !isDisabled && (isForced || isWindows && !isDumbTerminal || isCompatibleTerminal || isCI);
function replaceClose(index, string, close, replace, head = string.slice(0, Math.max(0, index)) + replace, tail = string.slice(Math.max(0, index + close.length)), next = tail.indexOf(close)) {
  return head + (next < 0 ? tail : replaceClose(next, tail, close, replace));
}
function clearBleed(index, string, open, close, replace) {
  return index < 0 ? open + string + close : open + replaceClose(index, string, close, replace) + close;
}
function filterEmpty(open, close, replace = open, at = open.length + 1) {
  return (string) => string || !(string === "" || string === void 0) ? clearBleed(
    ("" + string).indexOf(close, at),
    string,
    open,
    close,
    replace
  ) : "";
}
function init(open, close, replace) {
  return filterEmpty(`\x1B[${open}m`, `\x1B[${close}m`, replace);
}
var colorDefs = {
  reset: init(0, 0),
  bold: init(1, 22, "\x1B[22m\x1B[1m"),
  dim: init(2, 22, "\x1B[22m\x1B[2m"),
  italic: init(3, 23),
  underline: init(4, 24),
  inverse: init(7, 27),
  hidden: init(8, 28),
  strikethrough: init(9, 29),
  black: init(30, 39),
  red: init(31, 39),
  green: init(32, 39),
  yellow: init(33, 39),
  blue: init(34, 39),
  magenta: init(35, 39),
  cyan: init(36, 39),
  white: init(37, 39),
  gray: init(90, 39),
  bgBlack: init(40, 49),
  bgRed: init(41, 49),
  bgGreen: init(42, 49),
  bgYellow: init(43, 49),
  bgBlue: init(44, 49),
  bgMagenta: init(45, 49),
  bgCyan: init(46, 49),
  bgWhite: init(47, 49),
  blackBright: init(90, 39),
  redBright: init(91, 39),
  greenBright: init(92, 39),
  yellowBright: init(93, 39),
  blueBright: init(94, 39),
  magentaBright: init(95, 39),
  cyanBright: init(96, 39),
  whiteBright: init(97, 39),
  bgBlackBright: init(100, 49),
  bgRedBright: init(101, 49),
  bgGreenBright: init(102, 49),
  bgYellowBright: init(103, 49),
  bgBlueBright: init(104, 49),
  bgMagentaBright: init(105, 49),
  bgCyanBright: init(106, 49),
  bgWhiteBright: init(107, 49)
};
function createColors(useColor = isColorSupported) {
  return useColor ? colorDefs : Object.fromEntries(Object.keys(colorDefs).map((key) => [key, String]));
}
var colors = createColors();
function getColor(color, fallback = "reset") {
  return colors[color] || colors[fallback];
}
var ansiRegex = [
  String.raw`[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)`,
  String.raw`(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))`
].join("|");
function stripAnsi(text) {
  return text.replace(new RegExp(ansiRegex, "g"), "");
}
var boxStylePresets = {
  solid: {
    tl: "\u250C",
    tr: "\u2510",
    bl: "\u2514",
    br: "\u2518",
    h: "\u2500",
    v: "\u2502"
  },
  double: {
    tl: "\u2554",
    tr: "\u2557",
    bl: "\u255A",
    br: "\u255D",
    h: "\u2550",
    v: "\u2551"
  },
  doubleSingle: {
    tl: "\u2553",
    tr: "\u2556",
    bl: "\u2559",
    br: "\u255C",
    h: "\u2500",
    v: "\u2551"
  },
  doubleSingleRounded: {
    tl: "\u256D",
    tr: "\u256E",
    bl: "\u2570",
    br: "\u256F",
    h: "\u2500",
    v: "\u2551"
  },
  singleThick: {
    tl: "\u250F",
    tr: "\u2513",
    bl: "\u2517",
    br: "\u251B",
    h: "\u2501",
    v: "\u2503"
  },
  singleDouble: {
    tl: "\u2552",
    tr: "\u2555",
    bl: "\u2558",
    br: "\u255B",
    h: "\u2550",
    v: "\u2502"
  },
  singleDoubleRounded: {
    tl: "\u256D",
    tr: "\u256E",
    bl: "\u2570",
    br: "\u256F",
    h: "\u2550",
    v: "\u2502"
  },
  rounded: {
    tl: "\u256D",
    tr: "\u256E",
    bl: "\u2570",
    br: "\u256F",
    h: "\u2500",
    v: "\u2502"
  }
};
var defaultStyle = {
  borderColor: "white",
  borderStyle: "rounded",
  valign: "center",
  padding: 2,
  marginLeft: 1,
  marginTop: 1,
  marginBottom: 1
};
function box(text, _opts = {}) {
  const opts = {
    ..._opts,
    style: {
      ...defaultStyle,
      ..._opts.style
    }
  };
  const textLines = text.split("\n");
  const boxLines = [];
  const _color = getColor(opts.style.borderColor);
  const borderStyle = {
    ...typeof opts.style.borderStyle === "string" ? boxStylePresets[opts.style.borderStyle] || boxStylePresets.solid : opts.style.borderStyle
  };
  if (_color) {
    for (const key in borderStyle) {
      borderStyle[key] = _color(
        borderStyle[key]
      );
    }
  }
  const paddingOffset = opts.style.padding % 2 === 0 ? opts.style.padding : opts.style.padding + 1;
  const height = textLines.length + paddingOffset;
  const width = Math.max(
    ...textLines.map((line) => stripAnsi(line).length),
    opts.title ? stripAnsi(opts.title).length : 0
  ) + paddingOffset;
  const widthOffset = width + paddingOffset;
  const leftSpace = opts.style.marginLeft > 0 ? " ".repeat(opts.style.marginLeft) : "";
  if (opts.style.marginTop > 0) {
    boxLines.push("".repeat(opts.style.marginTop));
  }
  if (opts.title) {
    const title = _color ? _color(opts.title) : opts.title;
    const left = borderStyle.h.repeat(
      Math.floor((width - stripAnsi(opts.title).length) / 2)
    );
    const right = borderStyle.h.repeat(
      width - stripAnsi(opts.title).length - stripAnsi(left).length + paddingOffset
    );
    boxLines.push(
      `${leftSpace}${borderStyle.tl}${left}${title}${right}${borderStyle.tr}`
    );
  } else {
    boxLines.push(
      `${leftSpace}${borderStyle.tl}${borderStyle.h.repeat(widthOffset)}${borderStyle.tr}`
    );
  }
  const valignOffset = opts.style.valign === "center" ? Math.floor((height - textLines.length) / 2) : opts.style.valign === "top" ? height - textLines.length - paddingOffset : height - textLines.length;
  for (let i3 = 0; i3 < height; i3++) {
    if (i3 < valignOffset || i3 >= valignOffset + textLines.length) {
      boxLines.push(
        `${leftSpace}${borderStyle.v}${" ".repeat(widthOffset)}${borderStyle.v}`
      );
    } else {
      const line = textLines[i3 - valignOffset];
      const left = " ".repeat(paddingOffset);
      const right = " ".repeat(width - stripAnsi(line).length);
      boxLines.push(
        `${leftSpace}${borderStyle.v}${left}${line}${right}${borderStyle.v}`
      );
    }
  }
  boxLines.push(
    `${leftSpace}${borderStyle.bl}${borderStyle.h.repeat(widthOffset)}${borderStyle.br}`
  );
  if (opts.style.marginBottom > 0) {
    boxLines.push("".repeat(opts.style.marginBottom));
  }
  return boxLines.join("\n");
}

// ../../node_modules/.pnpm/consola@3.4.2/node_modules/consola/dist/index.mjs
var import_meta = {};
var r3 = /* @__PURE__ */ Object.create(null);
var i = (e3) => globalThis.process?.env || import_meta.env || globalThis.Deno?.env.toObject() || globalThis.__env__ || (e3 ? r3 : globalThis);
var o2 = new Proxy(r3, { get(e3, s2) {
  return i()[s2] ?? r3[s2];
}, has(e3, s2) {
  const E2 = i();
  return s2 in E2 || s2 in r3;
}, set(e3, s2, E2) {
  const B3 = i(true);
  return B3[s2] = E2, true;
}, deleteProperty(e3, s2) {
  if (!s2) return false;
  const E2 = i(true);
  return delete E2[s2], true;
}, ownKeys() {
  const e3 = i(true);
  return Object.keys(e3);
} });
var t = typeof process < "u" && process.env && process.env.NODE_ENV || "";
var f3 = [["APPVEYOR"], ["AWS_AMPLIFY", "AWS_APP_ID", { ci: true }], ["AZURE_PIPELINES", "SYSTEM_TEAMFOUNDATIONCOLLECTIONURI"], ["AZURE_STATIC", "INPUT_AZURE_STATIC_WEB_APPS_API_TOKEN"], ["APPCIRCLE", "AC_APPCIRCLE"], ["BAMBOO", "bamboo_planKey"], ["BITBUCKET", "BITBUCKET_COMMIT"], ["BITRISE", "BITRISE_IO"], ["BUDDY", "BUDDY_WORKSPACE_ID"], ["BUILDKITE"], ["CIRCLE", "CIRCLECI"], ["CIRRUS", "CIRRUS_CI"], ["CLOUDFLARE_PAGES", "CF_PAGES", { ci: true }], ["CODEBUILD", "CODEBUILD_BUILD_ARN"], ["CODEFRESH", "CF_BUILD_ID"], ["DRONE"], ["DRONE", "DRONE_BUILD_EVENT"], ["DSARI"], ["GITHUB_ACTIONS"], ["GITLAB", "GITLAB_CI"], ["GITLAB", "CI_MERGE_REQUEST_ID"], ["GOCD", "GO_PIPELINE_LABEL"], ["LAYERCI"], ["HUDSON", "HUDSON_URL"], ["JENKINS", "JENKINS_URL"], ["MAGNUM"], ["NETLIFY"], ["NETLIFY", "NETLIFY_LOCAL", { ci: false }], ["NEVERCODE"], ["RENDER"], ["SAIL", "SAILCI"], ["SEMAPHORE"], ["SCREWDRIVER"], ["SHIPPABLE"], ["SOLANO", "TDDIUM"], ["STRIDER"], ["TEAMCITY", "TEAMCITY_VERSION"], ["TRAVIS"], ["VERCEL", "NOW_BUILDER"], ["VERCEL", "VERCEL", { ci: false }], ["VERCEL", "VERCEL_ENV", { ci: false }], ["APPCENTER", "APPCENTER_BUILD_ID"], ["CODESANDBOX", "CODESANDBOX_SSE", { ci: false }], ["CODESANDBOX", "CODESANDBOX_HOST", { ci: false }], ["STACKBLITZ"], ["STORMKIT"], ["CLEAVR"], ["ZEABUR"], ["CODESPHERE", "CODESPHERE_APP_ID", { ci: true }], ["RAILWAY", "RAILWAY_PROJECT_ID"], ["RAILWAY", "RAILWAY_SERVICE_ID"], ["DENO-DEPLOY", "DENO_DEPLOYMENT_ID"], ["FIREBASE_APP_HOSTING", "FIREBASE_APP_HOSTING", { ci: true }]];
function b2() {
  if (globalThis.process?.env) for (const e3 of f3) {
    const s2 = e3[1] || e3[0];
    if (globalThis.process?.env[s2]) return { name: e3[0].toLowerCase(), ...e3[2] };
  }
  return globalThis.process?.env?.SHELL === "/bin/jsh" && globalThis.process?.versions?.webcontainer ? { name: "stackblitz", ci: false } : { name: "", ci: false };
}
var l2 = b2();
l2.name;
function n(e3) {
  return e3 ? e3 !== "false" : false;
}
var I3 = globalThis.process?.platform || "";
var T3 = n(o2.CI) || l2.ci !== false;
var a2 = n(globalThis.process?.stdout && globalThis.process?.stdout.isTTY);
var g3 = n(o2.DEBUG);
var R4 = t === "test" || n(o2.TEST);
n(o2.MINIMAL) || T3 || R4 || !a2;
var A4 = /^win/i.test(I3);
!n(o2.NO_COLOR) && (n(o2.FORCE_COLOR) || (a2 || A4) && o2.TERM !== "dumb" || T3);
var C2 = (globalThis.process?.versions?.node || "").replace(/^v/, "") || null;
Number(C2?.split(".")[0]) || null;
var y4 = globalThis.process || /* @__PURE__ */ Object.create(null);
var _3 = { versions: {} };
new Proxy(y4, { get(e3, s2) {
  if (s2 === "env") return o2;
  if (s2 in e3) return e3[s2];
  if (s2 in _3) return _3[s2];
} });
var c3 = globalThis.process?.release?.name === "node";
var O3 = !!globalThis.Bun || !!globalThis.process?.versions?.bun;
var D = !!globalThis.Deno;
var L4 = !!globalThis.fastly;
var S4 = !!globalThis.Netlify;
var u3 = !!globalThis.EdgeRuntime;
var N4 = globalThis.navigator?.userAgent === "Cloudflare-Workers";
var F2 = [[S4, "netlify"], [u3, "edge-light"], [N4, "workerd"], [L4, "fastly"], [D, "deno"], [O3, "bun"], [c3, "node"]];
function G4() {
  const e3 = F2.find((s2) => s2[0]);
  if (e3) return { name: e3[1] };
}
var P3 = G4();
P3?.name || "";
function ansiRegex2({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const pattern = [
    `[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?${ST})`,
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"
  ].join("|");
  return new RegExp(pattern, onlyFirst ? void 0 : "g");
}
var regex = ansiRegex2();
function stripAnsi2(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex, "");
}
function isAmbiguous(x4) {
  return x4 === 161 || x4 === 164 || x4 === 167 || x4 === 168 || x4 === 170 || x4 === 173 || x4 === 174 || x4 >= 176 && x4 <= 180 || x4 >= 182 && x4 <= 186 || x4 >= 188 && x4 <= 191 || x4 === 198 || x4 === 208 || x4 === 215 || x4 === 216 || x4 >= 222 && x4 <= 225 || x4 === 230 || x4 >= 232 && x4 <= 234 || x4 === 236 || x4 === 237 || x4 === 240 || x4 === 242 || x4 === 243 || x4 >= 247 && x4 <= 250 || x4 === 252 || x4 === 254 || x4 === 257 || x4 === 273 || x4 === 275 || x4 === 283 || x4 === 294 || x4 === 295 || x4 === 299 || x4 >= 305 && x4 <= 307 || x4 === 312 || x4 >= 319 && x4 <= 322 || x4 === 324 || x4 >= 328 && x4 <= 331 || x4 === 333 || x4 === 338 || x4 === 339 || x4 === 358 || x4 === 359 || x4 === 363 || x4 === 462 || x4 === 464 || x4 === 466 || x4 === 468 || x4 === 470 || x4 === 472 || x4 === 474 || x4 === 476 || x4 === 593 || x4 === 609 || x4 === 708 || x4 === 711 || x4 >= 713 && x4 <= 715 || x4 === 717 || x4 === 720 || x4 >= 728 && x4 <= 731 || x4 === 733 || x4 === 735 || x4 >= 768 && x4 <= 879 || x4 >= 913 && x4 <= 929 || x4 >= 931 && x4 <= 937 || x4 >= 945 && x4 <= 961 || x4 >= 963 && x4 <= 969 || x4 === 1025 || x4 >= 1040 && x4 <= 1103 || x4 === 1105 || x4 === 8208 || x4 >= 8211 && x4 <= 8214 || x4 === 8216 || x4 === 8217 || x4 === 8220 || x4 === 8221 || x4 >= 8224 && x4 <= 8226 || x4 >= 8228 && x4 <= 8231 || x4 === 8240 || x4 === 8242 || x4 === 8243 || x4 === 8245 || x4 === 8251 || x4 === 8254 || x4 === 8308 || x4 === 8319 || x4 >= 8321 && x4 <= 8324 || x4 === 8364 || x4 === 8451 || x4 === 8453 || x4 === 8457 || x4 === 8467 || x4 === 8470 || x4 === 8481 || x4 === 8482 || x4 === 8486 || x4 === 8491 || x4 === 8531 || x4 === 8532 || x4 >= 8539 && x4 <= 8542 || x4 >= 8544 && x4 <= 8555 || x4 >= 8560 && x4 <= 8569 || x4 === 8585 || x4 >= 8592 && x4 <= 8601 || x4 === 8632 || x4 === 8633 || x4 === 8658 || x4 === 8660 || x4 === 8679 || x4 === 8704 || x4 === 8706 || x4 === 8707 || x4 === 8711 || x4 === 8712 || x4 === 8715 || x4 === 8719 || x4 === 8721 || x4 === 8725 || x4 === 8730 || x4 >= 8733 && x4 <= 8736 || x4 === 8739 || x4 === 8741 || x4 >= 8743 && x4 <= 8748 || x4 === 8750 || x4 >= 8756 && x4 <= 8759 || x4 === 8764 || x4 === 8765 || x4 === 8776 || x4 === 8780 || x4 === 8786 || x4 === 8800 || x4 === 8801 || x4 >= 8804 && x4 <= 8807 || x4 === 8810 || x4 === 8811 || x4 === 8814 || x4 === 8815 || x4 === 8834 || x4 === 8835 || x4 === 8838 || x4 === 8839 || x4 === 8853 || x4 === 8857 || x4 === 8869 || x4 === 8895 || x4 === 8978 || x4 >= 9312 && x4 <= 9449 || x4 >= 9451 && x4 <= 9547 || x4 >= 9552 && x4 <= 9587 || x4 >= 9600 && x4 <= 9615 || x4 >= 9618 && x4 <= 9621 || x4 === 9632 || x4 === 9633 || x4 >= 9635 && x4 <= 9641 || x4 === 9650 || x4 === 9651 || x4 === 9654 || x4 === 9655 || x4 === 9660 || x4 === 9661 || x4 === 9664 || x4 === 9665 || x4 >= 9670 && x4 <= 9672 || x4 === 9675 || x4 >= 9678 && x4 <= 9681 || x4 >= 9698 && x4 <= 9701 || x4 === 9711 || x4 === 9733 || x4 === 9734 || x4 === 9737 || x4 === 9742 || x4 === 9743 || x4 === 9756 || x4 === 9758 || x4 === 9792 || x4 === 9794 || x4 === 9824 || x4 === 9825 || x4 >= 9827 && x4 <= 9829 || x4 >= 9831 && x4 <= 9834 || x4 === 9836 || x4 === 9837 || x4 === 9839 || x4 === 9886 || x4 === 9887 || x4 === 9919 || x4 >= 9926 && x4 <= 9933 || x4 >= 9935 && x4 <= 9939 || x4 >= 9941 && x4 <= 9953 || x4 === 9955 || x4 === 9960 || x4 === 9961 || x4 >= 9963 && x4 <= 9969 || x4 === 9972 || x4 >= 9974 && x4 <= 9977 || x4 === 9979 || x4 === 9980 || x4 === 9982 || x4 === 9983 || x4 === 10045 || x4 >= 10102 && x4 <= 10111 || x4 >= 11094 && x4 <= 11097 || x4 >= 12872 && x4 <= 12879 || x4 >= 57344 && x4 <= 63743 || x4 >= 65024 && x4 <= 65039 || x4 === 65533 || x4 >= 127232 && x4 <= 127242 || x4 >= 127248 && x4 <= 127277 || x4 >= 127280 && x4 <= 127337 || x4 >= 127344 && x4 <= 127373 || x4 === 127375 || x4 === 127376 || x4 >= 127387 && x4 <= 127404 || x4 >= 917760 && x4 <= 917999 || x4 >= 983040 && x4 <= 1048573 || x4 >= 1048576 && x4 <= 1114109;
}
function isFullWidth(x4) {
  return x4 === 12288 || x4 >= 65281 && x4 <= 65376 || x4 >= 65504 && x4 <= 65510;
}
function isWide(x4) {
  return x4 >= 4352 && x4 <= 4447 || x4 === 8986 || x4 === 8987 || x4 === 9001 || x4 === 9002 || x4 >= 9193 && x4 <= 9196 || x4 === 9200 || x4 === 9203 || x4 === 9725 || x4 === 9726 || x4 === 9748 || x4 === 9749 || x4 >= 9776 && x4 <= 9783 || x4 >= 9800 && x4 <= 9811 || x4 === 9855 || x4 >= 9866 && x4 <= 9871 || x4 === 9875 || x4 === 9889 || x4 === 9898 || x4 === 9899 || x4 === 9917 || x4 === 9918 || x4 === 9924 || x4 === 9925 || x4 === 9934 || x4 === 9940 || x4 === 9962 || x4 === 9970 || x4 === 9971 || x4 === 9973 || x4 === 9978 || x4 === 9981 || x4 === 9989 || x4 === 9994 || x4 === 9995 || x4 === 10024 || x4 === 10060 || x4 === 10062 || x4 >= 10067 && x4 <= 10069 || x4 === 10071 || x4 >= 10133 && x4 <= 10135 || x4 === 10160 || x4 === 10175 || x4 === 11035 || x4 === 11036 || x4 === 11088 || x4 === 11093 || x4 >= 11904 && x4 <= 11929 || x4 >= 11931 && x4 <= 12019 || x4 >= 12032 && x4 <= 12245 || x4 >= 12272 && x4 <= 12287 || x4 >= 12289 && x4 <= 12350 || x4 >= 12353 && x4 <= 12438 || x4 >= 12441 && x4 <= 12543 || x4 >= 12549 && x4 <= 12591 || x4 >= 12593 && x4 <= 12686 || x4 >= 12688 && x4 <= 12773 || x4 >= 12783 && x4 <= 12830 || x4 >= 12832 && x4 <= 12871 || x4 >= 12880 && x4 <= 42124 || x4 >= 42128 && x4 <= 42182 || x4 >= 43360 && x4 <= 43388 || x4 >= 44032 && x4 <= 55203 || x4 >= 63744 && x4 <= 64255 || x4 >= 65040 && x4 <= 65049 || x4 >= 65072 && x4 <= 65106 || x4 >= 65108 && x4 <= 65126 || x4 >= 65128 && x4 <= 65131 || x4 >= 94176 && x4 <= 94180 || x4 === 94192 || x4 === 94193 || x4 >= 94208 && x4 <= 100343 || x4 >= 100352 && x4 <= 101589 || x4 >= 101631 && x4 <= 101640 || x4 >= 110576 && x4 <= 110579 || x4 >= 110581 && x4 <= 110587 || x4 === 110589 || x4 === 110590 || x4 >= 110592 && x4 <= 110882 || x4 === 110898 || x4 >= 110928 && x4 <= 110930 || x4 === 110933 || x4 >= 110948 && x4 <= 110951 || x4 >= 110960 && x4 <= 111355 || x4 >= 119552 && x4 <= 119638 || x4 >= 119648 && x4 <= 119670 || x4 === 126980 || x4 === 127183 || x4 === 127374 || x4 >= 127377 && x4 <= 127386 || x4 >= 127488 && x4 <= 127490 || x4 >= 127504 && x4 <= 127547 || x4 >= 127552 && x4 <= 127560 || x4 === 127568 || x4 === 127569 || x4 >= 127584 && x4 <= 127589 || x4 >= 127744 && x4 <= 127776 || x4 >= 127789 && x4 <= 127797 || x4 >= 127799 && x4 <= 127868 || x4 >= 127870 && x4 <= 127891 || x4 >= 127904 && x4 <= 127946 || x4 >= 127951 && x4 <= 127955 || x4 >= 127968 && x4 <= 127984 || x4 === 127988 || x4 >= 127992 && x4 <= 128062 || x4 === 128064 || x4 >= 128066 && x4 <= 128252 || x4 >= 128255 && x4 <= 128317 || x4 >= 128331 && x4 <= 128334 || x4 >= 128336 && x4 <= 128359 || x4 === 128378 || x4 === 128405 || x4 === 128406 || x4 === 128420 || x4 >= 128507 && x4 <= 128591 || x4 >= 128640 && x4 <= 128709 || x4 === 128716 || x4 >= 128720 && x4 <= 128722 || x4 >= 128725 && x4 <= 128727 || x4 >= 128732 && x4 <= 128735 || x4 === 128747 || x4 === 128748 || x4 >= 128756 && x4 <= 128764 || x4 >= 128992 && x4 <= 129003 || x4 === 129008 || x4 >= 129292 && x4 <= 129338 || x4 >= 129340 && x4 <= 129349 || x4 >= 129351 && x4 <= 129535 || x4 >= 129648 && x4 <= 129660 || x4 >= 129664 && x4 <= 129673 || x4 >= 129679 && x4 <= 129734 || x4 >= 129742 && x4 <= 129756 || x4 >= 129759 && x4 <= 129769 || x4 >= 129776 && x4 <= 129784 || x4 >= 131072 && x4 <= 196605 || x4 >= 196608 && x4 <= 262141;
}
function validate(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}
var emojiRegex = () => {
  return /[#*0-9]\uFE0F?\u20E3|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26AA\u26B0\u26B1\u26BD\u26BE\u26C4\u26C8\u26CF\u26D1\u26E9\u26F0-\u26F5\u26F7\u26F8\u26FA\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2757\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B55\u3030\u303D\u3297\u3299]\uFE0F?|[\u261D\u270C\u270D](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\u270A\u270B](?:\uD83C[\uDFFB-\uDFFF])?|[\u23E9-\u23EC\u23F0\u23F3\u25FD\u2693\u26A1\u26AB\u26C5\u26CE\u26D4\u26EA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2795-\u2797\u27B0\u27BF\u2B50]|\u26D3\uFE0F?(?:\u200D\uD83D\uDCA5)?|\u26F9(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\u2764\uFE0F?(?:\u200D(?:\uD83D\uDD25|\uD83E\uDE79))?|\uD83C(?:[\uDC04\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]\uFE0F?|[\uDF85\uDFC2\uDFC7](?:\uD83C[\uDFFB-\uDFFF])?|[\uDFC4\uDFCA](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDFCB\uDFCC](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF43\uDF45-\uDF4A\uDF4C-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uDDE6\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF]|\uDDE7\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF]|\uDDE8\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF7\uDDFA-\uDDFF]|\uDDE9\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF]|\uDDEA\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA]|\uDDEB\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7]|\uDDEC\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE]|\uDDED\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA]|\uDDEE\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9]|\uDDEF\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5]|\uDDF0\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF]|\uDDF1\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE]|\uDDF2\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF]|\uDDF3\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF]|\uDDF4\uD83C\uDDF2|\uDDF5\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE]|\uDDF6\uD83C\uDDE6|\uDDF7\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC]|\uDDF8\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF]|\uDDF9\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF]|\uDDFA\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF]|\uDDFB\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA]|\uDDFC\uD83C[\uDDEB\uDDF8]|\uDDFD\uD83C\uDDF0|\uDDFE\uD83C[\uDDEA\uDDF9]|\uDDFF\uD83C[\uDDE6\uDDF2\uDDFC]|\uDF44(?:\u200D\uD83D\uDFEB)?|\uDF4B(?:\u200D\uD83D\uDFE9)?|\uDFC3(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDFF3\uFE0F?(?:\u200D(?:\u26A7\uFE0F?|\uD83C\uDF08))?|\uDFF4(?:\u200D\u2620\uFE0F?|\uDB40\uDC67\uDB40\uDC62\uDB40(?:\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDC73\uDB40\uDC63\uDB40\uDC74|\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F)?)|\uD83D(?:[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3]\uFE0F?|[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC](?:\uD83C[\uDFFB-\uDFFF])?|[\uDC6E\uDC70\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4\uDEB5](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD74\uDD90](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC25\uDC27-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE41\uDE43\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED7\uDEDC-\uDEDF\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB\uDFF0]|\uDC08(?:\u200D\u2B1B)?|\uDC15(?:\u200D\uD83E\uDDBA)?|\uDC26(?:\u200D(?:\u2B1B|\uD83D\uDD25))?|\uDC3B(?:\u200D\u2744\uFE0F?)?|\uDC41\uFE0F?(?:\u200D\uD83D\uDDE8\uFE0F?)?|\uDC68(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDC68\uDC69]\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE])))?))?|\uDC69(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?[\uDC68\uDC69]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?|\uDC69\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?))|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFE])))?))?|\uDC6F(?:\u200D[\u2640\u2642]\uFE0F?)?|\uDD75(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\uDE2E(?:\u200D\uD83D\uDCA8)?|\uDE35(?:\u200D\uD83D\uDCAB)?|\uDE36(?:\u200D\uD83C\uDF2B\uFE0F?)?|\uDE42(?:\u200D[\u2194\u2195]\uFE0F?)?|\uDEB6(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?)|\uD83E(?:[\uDD0C\uDD0F\uDD18-\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5\uDEC3-\uDEC5\uDEF0\uDEF2-\uDEF8](?:\uD83C[\uDFFB-\uDFFF])?|[\uDD26\uDD35\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD\uDDCF\uDDD4\uDDD6-\uDDDD](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDDDE\uDDDF](?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD0D\uDD0E\uDD10-\uDD17\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCC\uDDD0\uDDE0-\uDDFF\uDE70-\uDE7C\uDE80-\uDE89\uDE8F-\uDEC2\uDEC6\uDECE-\uDEDC\uDEDF-\uDEE9]|\uDD3C(?:\u200D[\u2640\u2642]\uFE0F?|\uD83C[\uDFFB-\uDFFF])?|\uDDCE(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDDD1(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1|\uDDD1\u200D\uD83E\uDDD2(?:\u200D\uD83E\uDDD2)?|\uDDD2(?:\u200D\uD83E\uDDD2)?))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF])))?))?|\uDEF1(?:\uD83C(?:\uDFFB(?:\u200D\uD83E\uDEF2\uD83C[\uDFFC-\uDFFF])?|\uDFFC(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFD-\uDFFF])?|\uDFFD(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])?|\uDFFE(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFD\uDFFF])?|\uDFFF(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFE])?))?)/g;
};
var segmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter() : { segment: (str) => str.split("") };
var defaultIgnorableCodePointRegex = new RegExp("^\\p{Default_Ignorable_Code_Point}$", "u");
function stringWidth$1(string, options = {}) {
  if (typeof string !== "string" || string.length === 0) {
    return 0;
  }
  const {
    ambiguousIsNarrow = true,
    countAnsiEscapeCodes = false
  } = options;
  if (!countAnsiEscapeCodes) {
    string = stripAnsi2(string);
  }
  if (string.length === 0) {
    return 0;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment: character } of segmenter.segment(string)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 31 || codePoint >= 127 && codePoint <= 159) {
      continue;
    }
    if (codePoint >= 8203 && codePoint <= 8207 || codePoint === 65279) {
      continue;
    }
    if (codePoint >= 768 && codePoint <= 879 || codePoint >= 6832 && codePoint <= 6911 || codePoint >= 7616 && codePoint <= 7679 || codePoint >= 8400 && codePoint <= 8447 || codePoint >= 65056 && codePoint <= 65071) {
      continue;
    }
    if (codePoint >= 55296 && codePoint <= 57343) {
      continue;
    }
    if (codePoint >= 65024 && codePoint <= 65039) {
      continue;
    }
    if (defaultIgnorableCodePointRegex.test(character)) {
      continue;
    }
    if (emojiRegex().test(character)) {
      width += 2;
      continue;
    }
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
  }
  return width;
}
function isUnicodeSupported() {
  const { env: env2 } = import_node_process4.default;
  const { TERM, TERM_PROGRAM } = env2;
  if (import_node_process4.default.platform !== "win32") {
    return TERM !== "linux";
  }
  return Boolean(env2.WT_SESSION) || Boolean(env2.TERMINUS_SUBLIME) || env2.ConEmuTask === "{cmd::Cmder}" || TERM_PROGRAM === "Terminus-Sublime" || TERM_PROGRAM === "vscode" || TERM === "xterm-256color" || TERM === "alacritty" || TERM === "rxvt-unicode" || TERM === "rxvt-unicode-256color" || env2.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var TYPE_COLOR_MAP = {
  info: "cyan",
  fail: "red",
  success: "green",
  ready: "green",
  start: "magenta"
};
var LEVEL_COLOR_MAP = {
  0: "red",
  1: "yellow"
};
var unicode = isUnicodeSupported();
var s = (c4, fallback) => unicode ? c4 : fallback;
var TYPE_ICONS = {
  error: s("\u2716", "\xD7"),
  fatal: s("\u2716", "\xD7"),
  ready: s("\u2714", "\u221A"),
  warn: s("\u26A0", "\u203C"),
  info: s("\u2139", "i"),
  success: s("\u2714", "\u221A"),
  debug: s("\u2699", "D"),
  trace: s("\u2192", "\u2192"),
  fail: s("\u2716", "\xD7"),
  start: s("\u25D0", "o"),
  log: ""
};
function stringWidth(str) {
  const hasICU = typeof Intl === "object";
  if (!hasICU || !Intl.Segmenter) {
    return stripAnsi(str).length;
  }
  return stringWidth$1(str);
}
var FancyReporter = class extends BasicReporter {
  formatStack(stack, message, opts) {
    const indent = "  ".repeat((opts?.errorLevel || 0) + 1);
    return `
${indent}` + parseStack(stack, message).map(
      (line) => "  " + line.replace(/^at +/, (m4) => colors.gray(m4)).replace(/\((.+)\)/, (_4, m4) => `(${colors.cyan(m4)})`)
    ).join(`
${indent}`);
  }
  formatType(logObj, isBadge, opts) {
    const typeColor = TYPE_COLOR_MAP[logObj.type] || LEVEL_COLOR_MAP[logObj.level] || "gray";
    if (isBadge) {
      return getBgColor(typeColor)(
        colors.black(` ${logObj.type.toUpperCase()} `)
      );
    }
    const _type = typeof TYPE_ICONS[logObj.type] === "string" ? TYPE_ICONS[logObj.type] : logObj.icon || logObj.type;
    return _type ? getColor2(typeColor)(_type) : "";
  }
  formatLogObj(logObj, opts) {
    const [message, ...additional] = this.formatArgs(logObj.args, opts).split(
      "\n"
    );
    if (logObj.type === "box") {
      return box(
        characterFormat(
          message + (additional.length > 0 ? "\n" + additional.join("\n") : "")
        ),
        {
          title: logObj.title ? characterFormat(logObj.title) : void 0,
          style: logObj.style
        }
      );
    }
    const date = this.formatDate(logObj.date, opts);
    const coloredDate = date && colors.gray(date);
    const isBadge = logObj.badge ?? logObj.level < 2;
    const type = this.formatType(logObj, isBadge, opts);
    const tag = logObj.tag ? colors.gray(logObj.tag) : "";
    let line;
    const left = this.filterAndJoin([type, characterFormat(message)]);
    const right = this.filterAndJoin(opts.columns ? [tag, coloredDate] : [tag]);
    const space = (opts.columns || 0) - stringWidth(left) - stringWidth(right) - 2;
    line = space > 0 && (opts.columns || 0) >= 80 ? left + " ".repeat(space) + right : (right ? `${colors.gray(`[${right}]`)} ` : "") + left;
    line += characterFormat(
      additional.length > 0 ? "\n" + additional.join("\n") : ""
    );
    if (logObj.type === "trace") {
      const _err = new Error("Trace: " + logObj.message);
      line += this.formatStack(_err.stack || "", _err.message);
    }
    return isBadge ? "\n" + line + "\n" : line;
  }
};
function characterFormat(str) {
  return str.replace(/`([^`]+)`/gm, (_4, m4) => colors.cyan(m4)).replace(/\s+_([^_]+)_\s+/gm, (_4, m4) => ` ${colors.underline(m4)} `);
}
function getColor2(color = "white") {
  return colors[color] || colors.white;
}
function getBgColor(color = "bgWhite") {
  return colors[`bg${color[0].toUpperCase()}${color.slice(1)}`] || colors.bgWhite;
}
function createConsola2(options = {}) {
  let level = _getDefaultLogLevel();
  if (process.env.CONSOLA_LEVEL) {
    level = Number.parseInt(process.env.CONSOLA_LEVEL) ?? level;
  }
  const consola2 = createConsola({
    level,
    defaults: { level },
    stdout: process.stdout,
    stderr: process.stderr,
    prompt: (...args) => Promise.resolve().then(() => (init_prompt(), prompt_exports)).then((m4) => m4.prompt(...args)),
    reporters: options.reporters || [
      options.fancy ?? !(T3 || R4) ? new FancyReporter() : new BasicReporter()
    ],
    ...options
  });
  return consola2;
}
function _getDefaultLogLevel() {
  if (g3) {
    return LogLevels.debug;
  }
  if (R4) {
    return LogLevels.warn;
  }
  return LogLevels.info;
}
var consola = createConsola2();

// src/commands/plugin.ts
var import_promises3 = require("node:fs/promises");
var import_node_fs2 = require("node:fs");
var import_node_path5 = require("node:path");

// src/utils/api.ts
async function readJson(res) {
  return await res.json().catch(() => ({ error: res.statusText }));
}
function apiError(res, data) {
  const msg = data.message ?? data.error ?? res.statusText;
  if (res.status === 401 || res.status === 403) {
    return new Error(`API error (${res.status}): ${msg} \u2014 check the API key is for this site, has the right permission, and belongs to an admin`);
  }
  return new Error(`API error (${res.status}): ${msg}`);
}
async function request(method, site, path, apiKey, body) {
  const res = await fetch(`${site}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    ...body !== void 0 ? { body: JSON.stringify(body) } : {}
  });
  if (method === "DELETE" && res.status === 404) return {};
  const data = await readJson(res);
  if (!res.ok) throw apiError(res, data);
  return data;
}
var apiPost = (site, path, apiKey, body) => request("POST", site, path, apiKey, body);
var apiPatch = (site, path, apiKey, body) => request("PATCH", site, path, apiKey, body);
var apiDelete = (site, path, apiKey) => request("DELETE", site, path, apiKey);
async function apiPostZip(site, path, apiKey, filename, data) {
  const form = new FormData();
  form.append("file", new Blob([data]), filename);
  const res = await fetch(`${site}${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: form
  });
  const json = await readJson(res);
  if (!res.ok) throw apiError(res, json);
  return json;
}
var LOCAL_HTTP_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]"]);
function resolveAuth(opts) {
  const site = (opts.site ?? process.env.NUXFLOW_SITE ?? "").replace(/\/$/, "");
  const apiKey = opts["api-key"] ?? opts.apiKey ?? process.env.NUXFLOW_API_KEY ?? "";
  if (!site) throw new Error("--site is required (or set NUXFLOW_SITE)");
  if (!apiKey) throw new Error('--api-key is required (or set NUXFLOW_API_KEY). Create one in Admin \u2192 Settings \u2192 API keys with the "Install and remove plugins" or "Upload and update themes" permission.');
  let parsed;
  try {
    parsed = new URL(site);
  } catch {
    throw new Error(`--site must be a valid URL: ${site}`);
  }
  if (parsed.protocol !== "https:" && !LOCAL_HTTP_HOSTS.has(parsed.hostname)) {
    throw new Error(`--site must use https:// (got ${parsed.protocol}//${parsed.hostname}) \u2014 refusing to send credentials over an insecure connection`);
  }
  return { site, apiKey };
}
var AUTH_ARGS = {
  "site": { type: "string", description: "Site URL                          (or NUXFLOW_SITE)" },
  "api-key": { type: "string", description: "API key from Settings \u2192 API keys  (or NUXFLOW_API_KEY)" }
};
function authenticateOrExit(s2, args) {
  try {
    return resolveAuth(args);
  } catch (e3) {
    s2.stop("Auth failed.");
    consola.error(e3.message);
    process.exit(1);
  }
}

// src/utils/build.ts
var import_esbuild = require("esbuild");
var import_promises = require("node:fs/promises");
var import_node_fs = require("node:fs");
var import_node_path2 = require("node:path");

// src/utils/signing.ts
function toBase64Url(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function fromBase64Url(s2) {
  const base64 = s2.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i3 = 0; i3 < binary.length; i3++) bytes[i3] = binary.charCodeAt(i3);
  return bytes.buffer;
}
function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b3) => b3.toString(16).padStart(2, "0")).join("");
}
function canonicalInput(payload) {
  const text = [
    "nuxflow-plugin-v1",
    payload.id,
    payload.version,
    payload.serverChecksum,
    payload.clientChecksum,
    payload.definitionsChecksum
  ].join("\n");
  return new TextEncoder().encode(text).buffer;
}
async function computeSha256(data) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(buffer);
}
async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const [privateKeyBuffer, publicKeyBuffer] = await Promise.all([
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    crypto.subtle.exportKey("spki", keyPair.publicKey)
  ]);
  return {
    privateKey: toBase64Url(privateKeyBuffer),
    publicKey: toBase64Url(publicKeyBuffer)
  };
}
async function signPayload(privateKeyB64Url, payload) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64Url(privateKeyB64Url),
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    canonicalInput(payload)
  );
  return toBase64Url(signature);
}

// src/utils/build.ts
async function tryBuild(entryPoint, outfile, platform2, target) {
  if (!(0, import_node_fs.existsSync)(entryPoint)) return void 0;
  await (0, import_esbuild.build)({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: platform2,
    target,
    outfile,
    // No externals — the server module must be fully self-contained.
    // The client module receives Vue via the register() argument, so it
    // never needs to import 'vue' as a bare specifier.
    minify: platform2 === "browser",
    treeShaking: true
  });
  const code = await (0, import_promises.readFile)(outfile, "utf-8");
  const [b64, checksum] = await Promise.all([
    Promise.resolve(Buffer.from(code).toString("base64")),
    computeSha256(code)
  ]);
  return { b64, checksum };
}
async function readBlockDefinitions(pluginDir) {
  const entryPoint = (0, import_node_path2.join)(pluginDir, "src/blocks.json");
  if (!(0, import_node_fs.existsSync)(entryPoint)) return void 0;
  const text = await (0, import_promises.readFile)(entryPoint, "utf-8");
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("src/blocks.json must contain a JSON array");
  } catch (err2) {
    throw new Error(`src/blocks.json is not valid JSON: ${err2 instanceof Error ? err2.message : String(err2)}`, { cause: err2 });
  }
  const [b64, checksum] = await Promise.all([
    Promise.resolve(Buffer.from(text).toString("base64")),
    computeSha256(text)
  ]);
  return { b64, checksum };
}
async function buildPlugin(pluginDir) {
  const distDir = (0, import_node_path2.join)(pluginDir, "dist");
  await (0, import_promises.mkdir)(distDir, { recursive: true });
  const [server, client, definitions] = await Promise.all([
    tryBuild(
      (0, import_node_path2.join)(pluginDir, "src/server.ts"),
      (0, import_node_path2.join)(distDir, "server.js"),
      "neutral",
      // Cloudflare Workers: no Node or browser globals assumed
      "es2022"
    ),
    tryBuild(
      (0, import_node_path2.join)(pluginDir, "src/client.ts"),
      (0, import_node_path2.join)(distDir, "client.js"),
      "browser",
      "es2020"
    ),
    readBlockDefinitions(pluginDir)
  ]);
  return {
    ...server ? { serverModule: server.b64, serverChecksum: server.checksum } : {},
    ...client ? { clientBundle: client.b64, clientChecksum: client.checksum } : {},
    ...definitions ? { blockDefinitions: definitions.b64, definitionsChecksum: definitions.checksum } : {}
  };
}

// src/utils/scaffold-plugin.ts
var import_fs_extra = __toESM(require_lib(), 1);
var import_node_path3 = require("node:path");
async function scaffoldPlugin(dir, id, name, description) {
  const files = {
    "nuxflow.plugin.json": JSON.stringify({ id, name, version: "0.1.0", description }, null, 2) + "\n",
    "src/server.ts": `// Server-side Cloudflare Worker for the "${name}" plugin.
// NuxFlow routes /_nuxflow/ext/${id}/* to this handler (prefix already stripped).
//
// Docs: https://developers.cloudflare.com/workers/runtime-apis/request/

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/hello') {
      return Response.json({ plugin: '${id}', message: 'Hello from ${name}!' })
    }

    return new Response('Not found', { status: 404 })
  },
}
`,
    "src/blocks.json": JSON.stringify([
      {
        id: `${id}/example`,
        name: "Example Block",
        description: `Starter block from the ${name} plugin.`,
        icon: "i-lucide-box",
        category: "advanced",
        thumbnailColor: "#f0fdf4",
        fields: [
          { key: "headline", label: "Headline", type: "text", placeholder: `Hello from ${name}` },
          { key: "text", label: "Body text", type: "textarea" },
          { key: "bgColor", label: "Background colour", type: "color" },
          { key: "padding", label: "Padding", type: "spacing" }
        ],
        defaultProps: {
          headline: `Hello from ${name}`,
          text: "Edit this block in the Canvas editor.",
          bgColor: "#ffffff",
          padding: { top: 48, right: 24, bottom: 48, left: 24, unit: "px" }
        }
      }
    ], null, 2) + "\n",
    "src/client.ts": `// Client-side render logic for the "${name}" plugin.
//
// This file runs INSIDE A SANDBOXED IFRAME with no access to the page it's
// embedded in \u2014 no cookies, no localStorage, no reaching outside the frame
// except via the props NuxFlow passes in. Block metadata (name, icon, fields,
// defaultProps \u2014 everything the Canvas editor's settings panel needs) lives in
// src/blocks.json instead, since the trusted app reads that directly without
// ever running this file.
//
// Rules:
//   1. Never \`import from 'vue'\` \u2014 the full Vue module is the 2nd argument.
//   2. Never \`import from '@nuxflow/*'\` \u2014 there is no shared SDK package.
//   3. All third-party deps must be bundled (esbuild does this automatically).

// The vue argument is \`import * as vue from 'vue'\` \u2014 add more entries as needed.
interface VueLike {
  defineComponent: (opts: object) => unknown
  ref: <T>(value: T) => { value: T }
  onMounted: (fn: () => void | Promise<void>) => void
  computed: <T>(fn: () => T) => { value: T }
  h: (tag: string | object, props?: Record<string, unknown> | null, children?: unknown) => unknown
}

interface Props {
  headline: string; text: string; bgColor: string
  padding: { top: number; right: number; bottom: number; left: number; unit: string }
}

// Called once per rendered block instance, inside the sandbox iframe. Return the
// Vue component for the given block id (matching an id declared in blocks.json),
// or null if this plugin doesn't know that id.
export function renderBlock(blockId: string, vue: VueLike): unknown {
  if (blockId !== '${id}/example') return null

  const { defineComponent, ref, onMounted, h } = vue

  return defineComponent({
    props: {
      headline: { type: String, default: 'Hello from ${name}' },
      text:     { type: String, default: 'Edit this block in the Canvas editor.' },
      bgColor:  { type: String, default: '#ffffff' },
      padding:  { type: Object, default: () => ({ top: 48, right: 24, bottom: 48, left: 24, unit: 'px' }) },
    },
    setup(props: Props) {
      // Example: fetch extra data from the plugin's own server route (src/server.ts).
      // Server routes are served at /_nuxflow/ext/${id}/{path} and never receive the
      // site visitor's cookies \u2014 this is a cross-origin fetch from inside the sandbox.
      const extra = ref<string | null>(null)

      onMounted(async () => {
        const res = await fetch('/_nuxflow/ext/${id}/hello').catch(() => null)
        if (res?.ok) {
          const data = await res.json() as { message?: string }
          extra.value = data.message ?? null
        }
      })

      // setup() returns a render function (Vue 3 composition API).
      return () => {
        const p = props.padding
        const pad = \`\${p.top}\${p.unit} \${p.right}\${p.unit} \${p.bottom}\${p.unit} \${p.left}\${p.unit}\`
        return h('section', {
          style: { backgroundColor: props.bgColor, padding: pad, textAlign: 'center' },
        }, [
          h('h2', { style: { fontSize: '1.875rem', fontWeight: '700', marginBottom: '12px' } }, props.headline),
          h('p',  { style: { color: '#6b7280' } }, extra.value ?? props.text),
        ])
      }
    },
  })
}
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        lib: ["ESNext", "DOM"],
        noEmit: true
      },
      include: ["src"]
    }, null, 2) + "\n",
    "package.json": JSON.stringify({
      name: id,
      version: "0.1.0",
      type: "module",
      private: true,
      scripts: {
        build: "nuxflow plugin build",
        deploy: "nuxflow plugin deploy",
        update: "nuxflow plugin update"
      }
    }, null, 2) + "\n",
    "README.md": `# ${name}

A NuxFlow dynamic plugin.

## Quick start

\`\`\`bash
# 1. Edit the plugin source
#    src/server.ts   \u2014 Cloudflare Worker (server API)
#    src/blocks.json \u2014 Block metadata (name, icon, fields, defaultProps)
#    src/client.ts   \u2014 Vue render logic (runs inside a sandboxed iframe)

# 2. Build
nuxflow plugin build

# 3. Create an API key on your site: Admin \u2192 Settings \u2192 API keys, with
#    "Install and remove plugins". Environment variables keep it out of shell history:
export NUXFLOW_SITE=https://your-site.com
export NUXFLOW_API_KEY=nf_...

# 4. Deploy (first time)
nuxflow plugin deploy

# 5. Update after changes
nuxflow plugin build && nuxflow plugin update
\`\`\`

\`--site\` and \`--api-key\` flags work too, instead of the environment variables.

## How it works

| File | Runtime | Purpose |
|---|---|---|
| \`src/server.ts\` | Cloudflare Worker | Handles \`/_nuxflow/ext/${id}/*\` requests |
| \`src/blocks.json\` | Read directly by the trusted app | Block metadata \u2014 name, icon, fields, defaultProps |
| \`src/client.ts\` | Sandboxed iframe (no cookie/session access) | Renders the actual Vue component for each block |

After \`nuxflow plugin build\`, both files are compiled to \`dist/\` and base64-encoded
into \`dist/plugin.json\`, which is what the deploy command uploads.

## Blocks registered

| ID | Description |
|---|---|
| \`${id}/example\` | Starter example \u2014 replace with your own |

Enable this plugin in the NuxFlow admin \u2192 Plugins after deploying.
`
  };
  for (const [filePath, content] of Object.entries(files)) {
    await (0, import_fs_extra.outputFile)((0, import_node_path3.join)(dir, filePath), content);
  }
}

// src/utils/manifest.ts
var import_promises2 = require("node:fs/promises");
var import_node_path4 = require("node:path");
async function readManifest(dir, filename, kind) {
  const raw = await (0, import_promises2.readFile)((0, import_node_path4.join)(dir, filename), "utf-8").catch(() => null);
  if (!raw) throw new Error(`${filename} not found \u2014 run this command from a ${kind} directory`);
  return JSON.parse(raw);
}
function orExit(promise) {
  return promise.catch((e3) => {
    consola.error(e3.message);
    process.exit(1);
  });
}

// src/commands/plugin.ts
function readManifest2(dir) {
  return readManifest(dir, "nuxflow.plugin.json", "plugin");
}
function toKebab(s2) {
  return s2.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
async function readDistJson(dir) {
  const p2 = (0, import_node_path5.join)(dir, "dist/plugin.json");
  if (!(0, import_node_fs2.existsSync)(p2)) throw new Error("dist/plugin.json not found \u2014 run `nuxflow plugin build` first");
  return JSON.parse(await (0, import_promises3.readFile)(p2, "utf-8"));
}
async function readPrivateKey(dir) {
  const p2 = (0, import_node_path5.join)(dir, ".nuxflow-private-key");
  if (!(0, import_node_fs2.existsSync)(p2)) throw new Error(".nuxflow-private-key not found \u2014 run `nuxflow plugin keygen` first");
  return (await (0, import_promises3.readFile)(p2, "utf-8")).trim();
}
async function buildSigningPayload(manifest, dist) {
  return {
    id: manifest.id,
    version: manifest.version,
    serverChecksum: dist.serverChecksum ?? "none",
    clientChecksum: dist.clientChecksum ?? "none",
    definitionsChecksum: dist.definitionsChecksum ?? "none"
  };
}
var pluginCommand = defineCommand({
  meta: { description: "Manage NuxFlow dynamic plugins" },
  subCommands: {
    // ── nuxflow plugin create ───────────────────────────────────────────────
    create: defineCommand({
      meta: { description: "Scaffold a new dynamic plugin project" },
      async run() {
        we("NuxFlow \u2014 Create Plugin");
        const rawName = await ue({ message: "Plugin name:", placeholder: "my-plugin" });
        if (!rawName || typeof rawName !== "string") {
          fe("Cancelled");
          return;
        }
        const id = toKebab(rawName);
        if (!id) {
          consola.error("Invalid plugin name");
          process.exit(1);
        }
        const rawDesc = await ue({
          message: "Short description (optional):",
          placeholder: "What does this plugin do?"
        });
        const description = typeof rawDesc === "string" ? rawDesc : "";
        const outDir = (0, import_node_path5.resolve)(process.cwd(), id);
        if ((0, import_node_fs2.existsSync)(outDir)) {
          consola.error(`Directory already exists: ${outDir}`);
          process.exit(1);
        }
        const ok = await me({ message: `Create plugin "${id}" in ./${id}/` });
        if (!ok) {
          fe("Cancelled");
          return;
        }
        const s2 = L2();
        s2.start("Generating plugin files\u2026");
        await scaffoldPlugin(outDir, id, id, description);
        s2.stop("Plugin files created.");
        fe(`
  Plugin ready at ./${id}/

  Next steps:
    cd ${id}
    nuxflow plugin keygen          # generate your publisher keypair first
    # Edit src/server.ts  (Cloudflare Worker API)
    # Edit src/client.ts  (Canvas block registration)
    nuxflow plugin build
    nuxflow plugin deploy --site https://your-site.com
        `);
      }
    }),
    // ── nuxflow plugin keygen ───────────────────────────────────────────────
    keygen: defineCommand({
      meta: { description: "Generate an Ed25519 publisher keypair for this plugin" },
      async run() {
        we("NuxFlow \u2014 Generate Publisher Keypair");
        const dir = process.cwd();
        const manifest = await orExit(readManifest2(dir));
        if (manifest.publisherPublicKey) {
          const replace = await me({
            message: "A keypair already exists for this plugin. Regenerating will invalidate all existing signatures. Continue?"
          });
          if (!replace) {
            fe("Cancelled");
            return;
          }
        }
        const s2 = L2();
        s2.start("Generating Ed25519 keypair\u2026");
        const { privateKey, publicKey } = await generateKeyPair();
        await (0, import_promises3.writeFile)((0, import_node_path5.join)(dir, ".nuxflow-private-key"), privateKey + "\n", { mode: 384 });
        const updatedManifest = { ...manifest, publisherPublicKey: publicKey };
        await (0, import_promises3.writeFile)(
          (0, import_node_path5.join)(dir, "nuxflow.plugin.json"),
          JSON.stringify(updatedManifest, null, 2) + "\n"
        );
        s2.stop("Keypair generated.");
        fe(`
  Private key \u2192 .nuxflow-private-key  (KEEP SECRET \u2014 never commit this)
  Public key  \u2192 nuxflow.plugin.json   (publisherPublicKey field)

  Add to .gitignore:
    .nuxflow-private-key

  The server will reject any plugin payload that doesn't carry a valid
  signature from this private key. Keep a secure backup of the private key
  \u2014 there is no recovery path if it is lost.
        `);
      }
    }),
    // ── nuxflow plugin build ────────────────────────────────────────────────
    build: defineCommand({
      meta: { description: "Build the plugin in the current directory" },
      async run() {
        we("NuxFlow \u2014 Build Plugin");
        const dir = process.cwd();
        const manifest = await orExit(readManifest2(dir));
        if (!manifest.publisherPublicKey) {
          consola.error("No publisher keypair found. Run `nuxflow plugin keygen` before building.");
          process.exit(1);
        }
        const s2 = L2();
        s2.start(`Building ${manifest.name} v${manifest.version}\u2026`);
        try {
          const { serverModule, serverChecksum, clientBundle, clientChecksum, blockDefinitions, definitionsChecksum } = await buildPlugin(dir);
          if (!serverModule && !clientBundle) {
            s2.stop("Nothing built \u2014 add src/server.ts and/or src/client.ts");
            process.exit(1);
          }
          const payload = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? "",
            ...serverModule ? { serverModule, serverChecksum } : {},
            ...clientBundle ? { clientBundle, clientChecksum } : {},
            ...blockDefinitions ? { blockDefinitions, definitionsChecksum } : {}
          };
          await (0, import_promises3.writeFile)((0, import_node_path5.join)(dir, "dist/plugin.json"), JSON.stringify(payload, null, 2) + "\n");
          const parts = [serverModule && "server", clientBundle && "client", blockDefinitions && "block definitions"].filter(Boolean);
          s2.stop(`Built: ${parts.join(" + ")} \u2192 dist/  (checksums included)`);
        } catch (e3) {
          s2.stop("Build failed.");
          consola.error(e3.message);
          process.exit(1);
        }
        fe("Ready to deploy \u2014 run `nuxflow plugin deploy`");
      }
    }),
    // ── nuxflow plugin deploy ───────────────────────────────────────────────
    deploy: defineCommand({
      meta: { description: "Install the plugin on a NuxFlow site (first time)" },
      args: { ...AUTH_ARGS },
      async run({ args }) {
        we("NuxFlow \u2014 Deploy Plugin");
        const dir = process.cwd();
        const [manifest, dist] = await Promise.all([
          orExit(readManifest2(dir)),
          orExit(readDistJson(dir))
        ]);
        if (!manifest.publisherPublicKey) {
          consola.error("No publisher public key in nuxflow.plugin.json \u2014 run `nuxflow plugin keygen` first.");
          process.exit(1);
        }
        const privateKey = await orExit(readPrivateKey(dir));
        const s2 = L2();
        s2.start("Signing plugin payload\u2026");
        const signingPayload = await buildSigningPayload(manifest, dist);
        const signature = await signPayload(privateKey, signingPayload);
        s2.message("Authenticating\u2026");
        const { site, apiKey } = authenticateOrExit(s2, args);
        s2.message(`Deploying ${manifest.name} v${manifest.version}\u2026`);
        try {
          await apiPost(site, "/api/v1/dynamic-plugins", apiKey, {
            ...dist,
            publisherPublicKey: manifest.publisherPublicKey,
            signature
          });
          s2.stop("Deployed!");
        } catch (e3) {
          s2.stop("Deploy failed.");
          consola.error(e3.message);
          process.exit(1);
        }
        fe(`Plugin installed. Enable it in the NuxFlow admin \u2192 Plugins.`);
      }
    }),
    // ── nuxflow plugin update ───────────────────────────────────────────────
    update: defineCommand({
      meta: { description: "Update an already-installed plugin (removes then reinstalls)" },
      args: { ...AUTH_ARGS },
      async run({ args }) {
        we("NuxFlow \u2014 Update Plugin");
        const dir = process.cwd();
        const [manifest, dist] = await Promise.all([
          orExit(readManifest2(dir)),
          orExit(readDistJson(dir))
        ]);
        if (!manifest.publisherPublicKey) {
          consola.error("No publisher public key in nuxflow.plugin.json \u2014 run `nuxflow plugin keygen` first.");
          process.exit(1);
        }
        const privateKey = await orExit(readPrivateKey(dir));
        const s2 = L2();
        s2.start("Signing plugin payload\u2026");
        const signingPayload = await buildSigningPayload(manifest, dist);
        const signature = await signPayload(privateKey, signingPayload);
        s2.message("Authenticating\u2026");
        const { site, apiKey } = authenticateOrExit(s2, args);
        s2.message("Removing old version\u2026");
        await apiDelete(site, `/api/v1/dynamic-plugins/${manifest.id}`, apiKey).catch(() => {
        });
        s2.message(`Deploying ${manifest.name} v${manifest.version}\u2026`);
        try {
          await apiPost(site, "/api/v1/dynamic-plugins", apiKey, {
            ...dist,
            publisherPublicKey: manifest.publisherPublicKey,
            signature
          });
          s2.stop("Updated!");
        } catch (e3) {
          s2.stop("Update failed.");
          consola.error(e3.message);
          process.exit(1);
        }
        fe("Plugin updated. Re-enable it in the NuxFlow admin if it was disabled.");
      }
    })
  }
});

// src/commands/theme.ts
var import_promises4 = require("node:fs/promises");
var import_node_fs3 = require("node:fs");
var import_node_path7 = require("node:path");

// ../../node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/index.mjs
var import_module = require("module");
var require2 = (0, import_module.createRequire)("/");
var _a;
var Worker;
var isMarkedAsUntransferable;
try {
  _a = require2("worker_threads"), Worker = _a.Worker, isMarkedAsUntransferable = _a.isMarkedAsUntransferable;
} catch (e3) {
}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b3 = new u16(31);
  for (var i3 = 0; i3 < 31; ++i3) {
    b3[i3] = start += 1 << eb[i3 - 1];
  }
  var r4 = new i32(b3[30]);
  for (var i3 = 1; i3 < 30; ++i3) {
    for (var j3 = b3[i3]; j3 < b3[i3 + 1]; ++j3) {
      r4[j3] = j3 - b3[i3] << 5 | i3;
    }
  }
  return { b: b3, r: r4 };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i2 = 0; i2 < 32768; ++i2) {
  x3 = (i2 & 43690) >> 1 | (i2 & 21845) << 1;
  x3 = (x3 & 52428) >> 2 | (x3 & 13107) << 2;
  x3 = (x3 & 61680) >> 4 | (x3 & 3855) << 4;
  rev[i2] = ((x3 & 65280) >> 8 | (x3 & 255) << 8) >> 1;
}
var x3;
var i2;
var hMap = (function(cd, mb, r4) {
  var s2 = cd.length;
  var i3 = 0;
  var l3 = new u16(mb);
  for (; i3 < s2; ++i3) {
    if (cd[i3])
      ++l3[cd[i3] - 1];
  }
  var le3 = new u16(mb);
  for (i3 = 1; i3 < mb; ++i3) {
    le3[i3] = le3[i3 - 1] + l3[i3 - 1] << 1;
  }
  var co;
  if (r4) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i3 = 0; i3 < s2; ++i3) {
      if (cd[i3]) {
        var sv = i3 << 4 | cd[i3];
        var r_1 = mb - cd[i3];
        var v3 = le3[cd[i3] - 1]++ << r_1;
        for (var m4 = v3 | (1 << r_1) - 1; v3 <= m4; ++v3) {
          co[rev[v3] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s2);
    for (i3 = 0; i3 < s2; ++i3) {
      if (cd[i3]) {
        co[i3] = rev[le3[cd[i3] - 1]++] >> 15 - cd[i3];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i2 = 0; i2 < 144; ++i2)
  flt[i2] = 8;
var i2;
for (i2 = 144; i2 < 256; ++i2)
  flt[i2] = 9;
var i2;
for (i2 = 256; i2 < 280; ++i2)
  flt[i2] = 7;
var i2;
for (i2 = 280; i2 < 288; ++i2)
  flt[i2] = 8;
var i2;
var fdt = new u8(32);
for (i2 = 0; i2 < 32; ++i2)
  fdt[i2] = 5;
var i2;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var shft = function(p2) {
  return (p2 + 7) / 8 | 0;
};
var slc = function(v3, s2, e3) {
  if (s2 == null || s2 < 0)
    s2 = 0;
  if (e3 == null || e3 > v3.length)
    e3 = v3.length;
  return new u8(v3.subarray(s2, e3));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e3 = new Error(msg || ec[ind]);
  e3.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e3, err);
  if (!nt)
    throw e3;
  return e3;
};
var wbits = function(d3, p2, v3) {
  v3 <<= p2 & 7;
  var o3 = p2 / 8 | 0;
  d3[o3] |= v3;
  d3[o3 + 1] |= v3 >> 8;
};
var wbits16 = function(d3, p2, v3) {
  v3 <<= p2 & 7;
  var o3 = p2 / 8 | 0;
  d3[o3] |= v3;
  d3[o3 + 1] |= v3 >> 8;
  d3[o3 + 2] |= v3 >> 16;
};
var hTree = function(d3, mb) {
  var t2 = [];
  for (var i3 = 0; i3 < d3.length; ++i3) {
    if (d3[i3])
      t2.push({ s: i3, f: d3[i3] });
  }
  var s2 = t2.length;
  var t22 = t2.slice();
  if (!s2)
    return { t: et, l: 0 };
  if (s2 == 1) {
    var v3 = new u8(t2[0].s + 1);
    v3[t2[0].s] = 1;
    return { t: v3, l: 1 };
  }
  t2.sort(function(a3, b3) {
    return a3.f - b3.f;
  });
  t2.push({ s: -1, f: 25001 });
  var l3 = t2[0], r4 = t2[1], i0 = 0, i1 = 1, i22 = 2;
  t2[0] = { s: -1, f: l3.f + r4.f, l: l3, r: r4 };
  while (i1 != s2 - 1) {
    l3 = t2[t2[i0].f < t2[i22].f ? i0++ : i22++];
    r4 = t2[i0 != i1 && t2[i0].f < t2[i22].f ? i0++ : i22++];
    t2[i1++] = { s: -1, f: l3.f + r4.f, l: l3, r: r4 };
  }
  var maxSym = t22[0].s;
  for (var i3 = 1; i3 < s2; ++i3) {
    if (t22[i3].s > maxSym)
      maxSym = t22[i3].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t2[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i3 = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t22.sort(function(a3, b3) {
      return tr[b3.s] - tr[a3.s] || a3.f - b3.f;
    });
    for (; i3 < s2; ++i3) {
      var i2_1 = t22[i3].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t22[i3].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i3;
    }
    for (; i3 >= 0 && dt; --i3) {
      var i2_3 = t22[i3].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n2, l3, d3) {
  return n2.s == -1 ? Math.max(ln(n2.l, l3, d3 + 1), ln(n2.r, l3, d3 + 1)) : l3[n2.s] = d3;
};
var lc = function(c4) {
  var s2 = c4.length;
  while (s2 && !c4[--s2])
    ;
  var cl = new u16(++s2);
  var cli = 0, cln = c4[0], cls = 1;
  var w3 = function(v3) {
    cl[cli++] = v3;
  };
  for (var i3 = 1; i3 <= s2; ++i3) {
    if (c4[i3] == cln && i3 != s2)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w3(32754);
        if (cls > 2) {
          w3(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w3(cln), --cls;
        for (; cls > 6; cls -= 6)
          w3(8304);
        if (cls > 2)
          w3(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w3(cln);
      cls = 1;
      cln = c4[i3];
    }
  }
  return { c: cl.subarray(0, cli), n: s2 };
};
var clen = function(cf, cl) {
  var l3 = 0;
  for (var i3 = 0; i3 < cl.length; ++i3)
    l3 += cf[i3] * cl[i3];
  return l3;
};
var wfblk = function(out, pos, dat) {
  var s2 = dat.length;
  var o3 = shft(pos + 2);
  out[o3] = s2 & 255;
  out[o3 + 1] = s2 >> 8;
  out[o3 + 2] = out[o3] ^ 255;
  out[o3 + 3] = out[o3 + 1] ^ 255;
  for (var i3 = 0; i3 < s2; ++i3)
    out[o3 + i3 + 4] = dat[i3];
  return (o3 + 4 + s2) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p2) {
  wbits(out, p2++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c2 = lc(dlt), lclt = _c2.c, nlc = _c2.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i3 = 0; i3 < lclt.length; ++i3)
    ++lcfreq[lclt[i3] & 31];
  for (var i3 = 0; i3 < lcdt.length; ++i3)
    ++lcfreq[lcdt[i3] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p2, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p2, 1 + (dtlen < ftlen)), p2 += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p2, nlc - 257);
    wbits(out, p2 + 5, ndc - 1);
    wbits(out, p2 + 10, nlcc - 4);
    p2 += 14;
    for (var i3 = 0; i3 < nlcc; ++i3)
      wbits(out, p2 + 3 * i3, lct[clim[i3]]);
    p2 += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i3 = 0; i3 < clct.length; ++i3) {
        var len = clct[i3] & 31;
        wbits(out, p2, llm[len]), p2 += lct[len];
        if (len > 15)
          wbits(out, p2, clct[i3] >> 5 & 127), p2 += clct[i3] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i3 = 0; i3 < li; ++i3) {
    var sym = syms[i3];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p2, lm[len + 257]), p2 += ll[len + 257];
      if (len > 7)
        wbits(out, p2, sym >> 23 & 31), p2 += fleb[len];
      var dst = sym & 31;
      wbits16(out, p2, dm[dst]), p2 += dl[dst];
      if (dst > 3)
        wbits16(out, p2, sym >> 5 & 8191), p2 += fdeb[dst];
    } else {
      wbits16(out, p2, lm[sym]), p2 += ll[sym];
    }
  }
  wbits16(out, p2, lm[256]);
  return p2 + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s2 = st.z || dat.length;
  var o3 = new u8(pre + s2 + 5 * (1 + Math.ceil(s2 / 7e3)) + post);
  var w3 = o3.subarray(pre, o3.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w3[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n2 = opt >> 13, c4 = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i4) {
      return (dat[i4] ^ dat[i4 + 1] << bs1_1 ^ dat[i4 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i3 = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i3 + 2 < s2; ++i3) {
      var hv = hsh(i3);
      var imod = i3 & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i3) {
        var rem = s2 - i3;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w3, 0, syms, lf, df, eb, li, bs, i3 - bs, pos);
          li = lc_1 = eb = 0, bs = i3;
          for (var j3 = 0; j3 < 286; ++j3)
            lf[j3] = 0;
          for (var j3 = 0; j3 < 30; ++j3)
            df[j3] = 0;
        }
        var l3 = 2, d3 = 0, ch_1 = c4, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i3 - dif)) {
          var maxn = Math.min(n2, rem) - 1;
          var maxd = Math.min(32767, i3);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i3 + l3] == dat[i3 + l3 - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i3 + nl] == dat[i3 + nl - dif]; ++nl)
                ;
              if (nl > l3) {
                l3 = nl, d3 = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j3 = 0; j3 < mmd; ++j3) {
                  var ti = i3 - dif + j3 & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d3) {
          syms[li++] = 268435456 | revfl[l3] << 18 | revfd[d3];
          var lin = revfl[l3] & 31, din = revfd[d3] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i3 + l3;
          ++lc_1;
        } else {
          syms[li++] = dat[i3];
          ++lf[dat[i3]];
        }
      }
    }
    for (i3 = Math.max(i3, wi); i3 < s2; ++i3) {
      syms[li++] = dat[i3];
      ++lf[dat[i3]];
    }
    pos = wblk(dat, w3, lst, syms, lf, df, eb, li, bs, i3 - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w3[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i3, st.w = wi;
    }
  } else {
    for (var i3 = st.w || 0; i3 < s2 + lst; i3 += 65535) {
      var e3 = i3 + 65535;
      if (e3 >= s2) {
        w3[pos / 8 | 0] = lst;
        e3 = s2;
      }
      pos = wfblk(w3, pos + 1, dat.subarray(i3, e3));
    }
    st.i = s2;
  }
  return slc(o3, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ (function() {
  var t2 = new Int32Array(256);
  for (var i3 = 0; i3 < 256; ++i3) {
    var c4 = i3, k3 = 9;
    while (--k3)
      c4 = (c4 & 1 && -306674912) ^ c4 >>> 1;
    t2[i3] = c4;
  }
  return t2;
})();
var crc = function() {
  var c4 = -1;
  return {
    p: function(d3) {
      var cr = c4;
      for (var i3 = 0; i3 < d3.length; ++i3)
        cr = crct[cr & 255 ^ d3[i3]] ^ cr >>> 8;
      c4 = cr;
    },
    d: function() {
      return ~c4;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a3, b3) {
  var o3 = {};
  for (var k3 in a3)
    o3[k3] = a3[k3];
  for (var k3 in b3)
    o3[k3] = b3[k3];
  return o3;
};
var wbytes = function(d3, b3, v3) {
  for (; v3; ++b3)
    d3[b3] = v3, v3 >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
var fltn = function(d3, p2, t2, o3) {
  for (var k3 in d3) {
    var val = d3[k3], n2 = p2 + k3, op = o3;
    if (Array.isArray(val))
      op = mrg(o3, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t2[n2] = [val, op];
    else {
      t2[n2 += "/"] = [new u8(0), op];
      fltn(val, n2, t2, o3);
    }
  }
};
var te2 = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e3) {
}
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i3 = 0; i3 < str.length; ++i3)
      ar_1[i3] = str.charCodeAt(i3);
    return ar_1;
  }
  if (te2)
    return te2.encode(str);
  var l3 = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w3 = function(v3) {
    ar[ai++] = v3;
  };
  for (var i3 = 0; i3 < l3; ++i3) {
    if (ai + 5 > ar.length) {
      var n2 = new u8(ai + 8 + (l3 - i3 << 1));
      n2.set(ar);
      ar = n2;
    }
    var c4 = str.charCodeAt(i3);
    if (c4 < 128 || latin1)
      w3(c4);
    else if (c4 < 2048)
      w3(192 | c4 >> 6), w3(128 | c4 & 63);
    else if (c4 > 55295 && c4 < 57344)
      c4 = 65536 + (c4 & 1023 << 10) | str.charCodeAt(++i3) & 1023, w3(240 | c4 >> 18), w3(128 | c4 >> 12 & 63), w3(128 | c4 >> 6 & 63), w3(128 | c4 & 63);
    else
      w3(224 | c4 >> 12), w3(128 | c4 >> 6 & 63), w3(128 | c4 & 63);
  }
  return slc(ar, 0, ai);
}
var exfl = function(ex) {
  var le3 = 0;
  if (ex) {
    for (var k3 in ex) {
      var l3 = ex[k3].length;
      if (l3 > 65535)
        err(9);
      le3 += l3 + 4;
    }
  }
  return le3;
};
var wzh = function(d3, b3, f4, fn, u4, c4, ce3, co) {
  var fl2 = fn.length, ex = f4.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d3, b3, ce3 != null ? 33639248 : 67324752), b3 += 4;
  if (ce3 != null)
    d3[b3++] = 20, d3[b3++] = f4.os;
  d3[b3] = 20, b3 += 2;
  d3[b3++] = f4.flag << 1 | (c4 < 0 && 8), d3[b3++] = u4 && 8;
  d3[b3++] = f4.compression & 255, d3[b3++] = f4.compression >> 8;
  var dt = new Date(f4.mtime == null ? Date.now() : f4.mtime), y5 = dt.getFullYear() - 1980;
  if (y5 < 0 || y5 > 119)
    err(10);
  wbytes(d3, b3, y5 << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b3 += 4;
  if (c4 != -1) {
    wbytes(d3, b3, f4.crc);
    wbytes(d3, b3 + 4, c4 < 0 ? -c4 - 2 : c4);
    wbytes(d3, b3 + 8, f4.size);
  }
  wbytes(d3, b3 + 12, fl2);
  wbytes(d3, b3 + 14, exl), b3 += 16;
  if (ce3 != null) {
    wbytes(d3, b3, col);
    wbytes(d3, b3 + 6, f4.attrs);
    wbytes(d3, b3 + 10, ce3), b3 += 14;
  }
  d3.set(fn, b3);
  b3 += fl2;
  if (exl) {
    for (var k3 in ex) {
      var exf = ex[k3], l3 = exf.length;
      wbytes(d3, b3, +k3);
      wbytes(d3, b3 + 2, l3);
      d3.set(exf, b3 + 4), b3 += 4 + l3;
    }
  }
  if (col)
    d3.set(co, b3), b3 += col;
  return b3;
};
var wzf = function(o3, b3, c4, d3, e3) {
  wbytes(o3, b3, 101010256);
  wbytes(o3, b3 + 8, c4);
  wbytes(o3, b3 + 10, c4);
  wbytes(o3, b3 + 12, d3);
  wbytes(o3, b3 + 16, e3);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r4 = {};
  var files = [];
  fltn(data, "", r4, opts);
  var o3 = 0;
  var tot = 0;
  for (var fn in r4) {
    var _a2 = r4[fn], file = _a2[0], p2 = _a2[1];
    var compression = p2.level == 0 ? 0 : 8;
    var f4 = strToU8(fn), s2 = f4.length;
    var com = p2.comment, m4 = com && strToU8(com), ms = m4 && m4.length;
    var exl = exfl(p2.extra);
    if (s2 > 65535)
      err(11);
    var d3 = compression ? deflateSync(file, p2) : file, l3 = d3.length;
    var c4 = crc();
    c4.p(file);
    files.push(mrg(p2, {
      size: file.length,
      crc: c4.d(),
      c: d3,
      f: f4,
      m: m4,
      u: s2 != fn.length || m4 && com.length != ms,
      o: o3,
      compression
    }));
    o3 += 30 + s2 + exl + l3;
    tot += 76 + 2 * (s2 + exl) + (ms || 0) + l3;
  }
  var out = new u8(tot + 22), oe2 = o3, cdl = tot - o3;
  for (var i3 = 0; i3 < files.length; ++i3) {
    var f4 = files[i3];
    wzh(out, f4.o, f4, f4.f, f4.u, f4.c.length);
    var badd = 30 + f4.f.length + exfl(f4.extra);
    out.set(f4.c, f4.o + badd);
    wzh(out, o3, f4, f4.f, f4.u, f4.c.length, f4.o, f4.m), o3 += 16 + badd + (f4.m ? f4.m.length : 0);
  }
  wzf(out, o3, files.length, cdl, oe2);
  return out;
}

// src/utils/scaffold-theme.ts
var import_fs_extra2 = __toESM(require_lib(), 1);
var import_node_path6 = require("node:path");
async function scaffoldTheme(dir, name) {
  const files = {
    "nuxflow.theme.json": JSON.stringify({ name, version: "1.0.0" }, null, 2) + "\n",
    "theme.css": `/*
 * ${name} \u2014 NuxFlow CSS Theme
 *
 * This stylesheet is injected into the <head> of every SSR page render.
 * Use the selectors and custom properties below, or write any CSS you need.
 *
 * Deploy:  nuxflow theme deploy --site https://your-site.com
 * Update:  nuxflow theme update --site https://your-site.com  (after first deploy)
 *
 * Full token/selector reference: themes/default/assets/css/theme.css in the
 * NuxFlow repo (also covers admin-dashboard chrome, which this starter omits).
 */


/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Appearance settings bridge
   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Two custom properties are injected automatically into every public page from
   Admin \u2192 Themes \u2192 Appearance \u2014 reference them so a single admin setting can
   drive your whole theme. Both ship with a safe fallback.

     --nuxflow-primary   The "Accent colour" value chosen in the picker.
     --nuxflow-font      The "Body font" value (font-family stack).

   Example: .canvas-hero a { background: var(--nuxflow-primary, #6366f1); }
   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */


/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Canvas block selectors
   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Every Canvas block renders with a semantic class on its root element. Target
   these to style pages built with the visual page builder. All blocks sit
   inside .nux-blocks. (canvas-video has no stable wrapper class yet \u2014 inspect
   the rendered HTML if you need to target it.)

     .canvas-hero          Hero / banner section
     .canvas-text          Rich text / prose block
     .canvas-image         Image block (figure inside holds the image)
     .canvas-columns       Multi-column layout block
     .canvas-container     Generic container / nesting block
     .canvas-features      Feature grid section
     .canvas-testimonial   Testimonial / quote card block
     .canvas-cta           Call-to-action banner block
     .canvas-spacer        Vertical spacer / divider block
     .canvas-gdpr          Cookie / GDPR consent banner block
     .canvas-footer        Footer block
     .canvas-button        Standalone button block
     .canvas-accordion     Accordion / FAQ block
     .canvas-pricing       Pricing table block
     .canvas-gallery       Image gallery block
     .canvas-carousel      Carousel / slider block
     .canvas-calendar      Calendar / events block

   Canvas pages render full-width with no container \u2014 add max-width constraints
   inside your own selectors for large-screen layouts.

   .nux-content wraps TipTap-rendered rich text on non-Canvas pages (blog posts,
   simple content pages).
   \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

/* Style the hero headline with gradient text: */
/* .canvas-hero h1 {
  background: linear-gradient(135deg, #fff 30%, var(--nuxflow-primary, #6366f1) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
} */

/* Body copy follows the admin-configured font automatically: */
/* body { font-family: var(--nuxflow-font, system-ui, -apple-system, sans-serif); } */

.nux-content a       { color: var(--nuxflow-primary, #6366f1); }
.nux-content blockquote { border-left-color: var(--nuxflow-primary, #6366f1); }
`,
    "README.md": `# ${name}

A NuxFlow CSS theme.

## Quick start

\`\`\`bash
# Create an API key on your site first: Admin \u2192 Settings \u2192 API keys, with
# "Upload and update themes". Then:
export NUXFLOW_SITE=https://your-site.com
export NUXFLOW_API_KEY=nf_...

# Deploy for the first time (activates automatically if no theme is active)
nuxflow theme deploy

# Update CSS after making changes
nuxflow theme update
\`\`\`

The \`deployedId\` field in \`nuxflow.theme.json\` is written automatically on first deploy
so the update command knows which theme to patch.

## How it works

The CSS in \`theme.css\` is stored in Cloudflare KV and injected into the HTML
\`<head>\` on every server-rendered page \u2014 no redeploy required.

## Bundling demo content (optional)

A theme can ship with seed content \u2014 pages, posts, menus, forms \u2014 that the
admin can one-click import after activating the theme (Admin \u2192 Themes \u2192
Import demo content). To include it:

1. Build the pages/posts/menus/forms you want to ship on a real NuxFlow site.
2. Export them: \`GET /api/v1/backup\` on that site (admin-only) downloads a zip
   containing \`backup.json\` + an \`images/\` folder.
3. Copy \`backup.json\` into this folder as \`demo.json\`, and copy the \`images/\`
   folder alongside it.
4. Run \`nuxflow theme deploy\` again \u2014 the CLI automatically zips
   \`theme.css\` + \`theme.json\` + \`demo.json\` + \`images/\` and uploads the
   bundle instead of a bare CSS payload whenever \`demo.json\` or \`images/\`
   is present.

Bundled (zip) deploys always create a new theme \u2014 the \`update\` command only
patches CSS on an existing theme, since demo content is a one-time import, not
something that's re-synced.
`
  };
  for (const [filePath, content] of Object.entries(files)) {
    await (0, import_fs_extra2.outputFile)((0, import_node_path6.join)(dir, filePath), content);
  }
}

// src/commands/theme.ts
function readManifest3(dir) {
  return readManifest(dir, "nuxflow.theme.json", "theme");
}
async function readCss(dir) {
  const p2 = (0, import_node_path7.join)(dir, "theme.css");
  if (!(0, import_node_fs3.existsSync)(p2)) throw new Error("theme.css not found \u2014 run this command from a theme directory");
  return (0, import_promises4.readFile)(p2, "utf-8");
}
async function buildBundleZip(dir, manifest, css) {
  const demoPath = (0, import_node_path7.join)(dir, "demo.json");
  const imagesDir = (0, import_node_path7.join)(dir, "images");
  const hasDemo = (0, import_node_fs3.existsSync)(demoPath);
  const hasImages = (0, import_node_fs3.existsSync)(imagesDir);
  if (!hasDemo && !hasImages) return null;
  const files = {
    "theme.css": new TextEncoder().encode(css),
    "theme.json": new TextEncoder().encode(JSON.stringify({ name: manifest.name, version: manifest.version }, null, 2))
  };
  if (hasDemo) {
    files["demo.json"] = new TextEncoder().encode(await (0, import_promises4.readFile)(demoPath, "utf-8"));
  }
  if (hasImages) {
    for (const entry of await (0, import_promises4.readdir)(imagesDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      files[`images/${entry.name}`] = await (0, import_promises4.readFile)((0, import_node_path7.join)(imagesDir, entry.name));
    }
  }
  return zipSync(files);
}
var themeCommand = defineCommand({
  meta: { description: "Manage NuxFlow CSS themes" },
  subCommands: {
    // ── nuxflow theme create ────────────────────────────────────────────────
    create: defineCommand({
      meta: { description: "Scaffold a new CSS theme project" },
      async run() {
        we("NuxFlow \u2014 Create Theme");
        const rawName = await ue({ message: "Theme name:", placeholder: "my-theme" });
        if (!rawName || typeof rawName !== "string") {
          fe("Cancelled");
          return;
        }
        const name = rawName.trim();
        const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const outDir = (0, import_node_path7.resolve)(process.cwd(), slug);
        if ((0, import_node_fs3.existsSync)(outDir)) {
          consola.error(`Directory already exists: ${outDir}`);
          process.exit(1);
        }
        const ok = await me({ message: `Create theme "${name}" in ./${slug}/` });
        if (!ok) {
          fe("Cancelled");
          return;
        }
        const s2 = L2();
        s2.start("Generating theme files\u2026");
        await scaffoldTheme(outDir, name);
        s2.stop("Theme files created.");
        fe(`
  Theme ready at ./${slug}/

  Next steps:
    cd ${slug}
    # Edit theme.css
    nuxflow theme deploy --site https://your-site.com
        `);
      }
    }),
    // ── nuxflow theme deploy ────────────────────────────────────────────────
    deploy: defineCommand({
      meta: { description: "Upload the theme to a NuxFlow site (first time)" },
      args: { ...AUTH_ARGS },
      async run({ args }) {
        we("NuxFlow \u2014 Deploy Theme");
        const dir = process.cwd();
        const manifest = await orExit(readManifest3(dir));
        const css = await orExit(readCss(dir));
        const bundleZip = await buildBundleZip(dir, manifest, css);
        const s2 = L2();
        s2.start("Authenticating\u2026");
        const { site, apiKey } = authenticateOrExit(s2, args);
        s2.message(bundleZip ? `Uploading "${manifest.name}" v${manifest.version} (with demo content)\u2026` : `Uploading "${manifest.name}" v${manifest.version}\u2026`);
        try {
          const res = bundleZip ? await apiPostZip(site, "/api/v1/themes", apiKey, `${manifest.name.toLowerCase().replace(/\s+/g, "-")}.zip`, bundleZip) : await apiPost(site, "/api/v1/themes", apiKey, {
            name: manifest.name,
            version: manifest.version,
            css
          });
          if (res.id) {
            const updated = { ...manifest, deployedId: res.id };
            await (0, import_promises4.writeFile)((0, import_node_path7.join)(dir, "nuxflow.theme.json"), JSON.stringify(updated, null, 2) + "\n");
          }
          s2.stop("Deployed!");
          if (res.hasDemoContent) consola.info("Demo content uploaded \u2014 import it from Admin \u2192 Themes after activating.");
          if (res.failedImages?.length) consola.warn(`Some demo images failed to upload: ${res.failedImages.join(", ")}`);
        } catch (e3) {
          s2.stop("Deploy failed.");
          consola.error(e3.message);
          process.exit(1);
        }
        fe("Theme uploaded. Activate it in the NuxFlow admin \u2192 Themes.");
      }
    }),
    // ── nuxflow theme update ────────────────────────────────────────────────
    update: defineCommand({
      meta: { description: "Push updated CSS to an already-deployed theme" },
      args: { ...AUTH_ARGS },
      async run({ args }) {
        we("NuxFlow \u2014 Update Theme");
        const dir = process.cwd();
        const manifest = await orExit(readManifest3(dir));
        if (!manifest.deployedId) {
          consola.error("No deployedId in nuxflow.theme.json \u2014 run `nuxflow theme deploy` first");
          process.exit(1);
        }
        const css = await orExit(readCss(dir));
        const s2 = L2();
        s2.start("Authenticating\u2026");
        const { site, apiKey } = authenticateOrExit(s2, args);
        s2.message(`Updating "${manifest.name}"\u2026`);
        try {
          await apiPatch(site, `/api/v1/themes/${manifest.deployedId}/css`, apiKey, {
            css,
            version: manifest.version
          });
          s2.stop("Updated!");
        } catch (e3) {
          s2.stop("Update failed.");
          consola.error(e3.message);
          process.exit(1);
        }
        fe("Theme CSS updated \u2014 live on the next page request, no redeploy needed.");
      }
    })
  }
});

// src/index.ts
var main = defineCommand({
  meta: {
    name: "nuxflow",
    version: true ? "1.0.0-beta.0" : "dev",
    description: "NuxFlow CLI \u2014 scaffold plugins, themes, and more"
  },
  subCommands: {
    plugin: pluginCommand,
    theme: themeCommand
  }
});
runMain(main);
