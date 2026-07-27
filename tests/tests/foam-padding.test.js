"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const foamConst = source.match(/const FOAM_MIN_COMPRESSED_MM=7;/)?.[0];
const padFunction = source.match(/function pad\(margin,t,enabled\)\{[\s\S]*?\n\}/)?.[0];

assert(foamConst, "FOAM_MIN_COMPRESSED_MM constant should be present");
assert(padFunction, "pad function should be present");

const context = {};
vm.createContext(context);
vm.runInContext(`${foamConst}\n${padFunction}\nthis.pad=pad;`, context, { filename: "app.js:pad" });

const pad = context.pad;

assert.deepStrictEqual(
  pick(pad(6, 10, true)),
  { sheets: 0, low: 0, high: 0, unfilled: 6, compression: 0 },
  "less than 7mm should not receive foam"
);

assert.deepStrictEqual(
  pick(pad(9, 10, true)),
  { sheets: 1, low: 0, high: 1, unfilled: 0, compression: 1 },
  "7-9mm should accept one compressed 10mm sheet"
);

assert.deepStrictEqual(
  pick(pad(16, 10, true)),
  { sheets: 2, low: 1, high: 1, unfilled: 0, compression: 4 },
  "16mm should split into one compressed sheet on each side"
);

assert.deepStrictEqual(
  pick(pad(22, 10, true)),
  { sheets: 2, low: 1, high: 1, unfilled: 2, compression: 0 },
  "22mm should fit one 10mm sheet on each side with 2mm unfilled"
);

assert.deepStrictEqual(
  pick(pad(89, 10, true)),
  { sheets: 9, low: 4, high: 5, unfilled: 0, compression: 1 },
  "89mm should fill the final 9mm remainder with one more sheet"
);

assert.deepStrictEqual(
  pick(pad(31, 10, true)),
  { sheets: 3, low: 1, high: 2, unfilled: 1, compression: 0 },
  "sub-7mm nominal remainder should remain unfilled"
);

assert.deepStrictEqual(
  pick(pad(89, 10, false)),
  { sheets: 0, low: 0, high: 0, unfilled: 89, compression: 0 },
  "disabled foam should leave the full margin unfilled"
);

function pick(result) {
  return {
    sheets: result.sheets,
    low: result.low,
    high: result.high,
    unfilled: round(result.unfilled),
    compression: round(result.compression)
  };
}

function round(value) {
  return Math.round(value * 1e9) / 1e9;
}

console.log("foam padding tests passed");
