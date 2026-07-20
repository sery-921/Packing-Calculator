"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "mixed-packing.js"), "utf8");
const context = { globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "mixed-packing.js" });

const { packMixedFlat, boxesDoNotOverlap } = context.PackingMixed;

function pack(cartonInner, boxDims, options = {}) {
  return packMixedFlat({
    cartonInner,
    boxDims,
    clearance: 0,
    allowFullFit: true,
    ...options
  });
}

function assertInBounds(plan, cartonInner) {
  for (const box of plan.boxes) {
    assert(box.x >= 0, `box ${box.index} x underflow`);
    assert(box.y >= 0, `box ${box.index} y underflow`);
    assert(box.z >= 0, `box ${box.index} z underflow`);
    assert(box.x + box.length <= cartonInner[0] + 1e-9, `box ${box.index} length overflow`);
    assert(box.y + box.width <= cartonInner[1] + 1e-9, `box ${box.index} width overflow`);
    assert(box.z + box.height <= cartonInner[2] + 1e-9, `box ${box.index} height overflow`);
  }
}

function uniformCount(cartonInner, boxDims) {
  const [L, W, H] = cartonInner;
  const [l, w, h] = boxDims;
  return Math.max(
    Math.floor(L / l) * Math.floor(W / w),
    Math.floor(L / w) * Math.floor(W / l)
  ) * Math.floor(H / h);
}

const heightOverflow = pack([120, 100, 30], [60, 40, 40]);
assert.strictEqual(heightOverflow.feasible, false, "height overflow must be infeasible");

const square = pack([100, 100, 20], [50, 50, 20]);
assert.strictEqual(square.feasible, true, "square boxes should fit");
assert.strictEqual(square.count, 4, "exact 2x2 square packing");
assert.strictEqual(square.orientationDistribution.rotation90, 0, "square rotation should not be double-counted");

const exact = pack([100, 80, 20], [50, 40, 20]);
assert.strictEqual(exact.count, 4, "exact boundary fit should be allowed");
assertInBounds(exact, [100, 80, 20]);
assert(boxesDoNotOverlap(exact.boxes), "exact fit boxes must not overlap");

const mixedImproves = pack([100, 100, 20], [60, 40, 20]);
assert(mixedImproves.count > uniformCount([100, 100, 20], [60, 40, 20]), "mixed layout should beat uniform orientation");
assert(mixedImproves.orientationDistribution.rotation0 > 0, "mixed plan should include 0 degree boxes");
assert(mixedImproves.orientationDistribution.rotation90 > 0, "mixed plan should include 90 degree boxes");
assertInBounds(mixedImproves, [100, 100, 20]);
assert(boxesDoNotOverlap(mixedImproves.boxes), "mixed boxes must not overlap");

const noWorse = pack([300, 200, 20], [100, 100, 20]);
assert.strictEqual(noWorse.count, uniformCount([300, 200, 20], [100, 100, 20]), "mixed mode should keep uniform optimum for square-ish grids");

const candidates = [
  pack([100, 100, 20], [60, 40, 20]),
  pack([120, 100, 20], [60, 40, 20])
];
assert(candidates.every(plan => plan.feasible), "multiple candidate cartons should evaluate independently");
assert(candidates[1].count >= candidates[0].count, "larger candidate should not rank below by capacity in this case");

const strictClearance = pack([100, 80, 21], [50, 40, 20], { clearance: 1, allowFullFit: false });
assert.strictEqual(strictClearance.count, 2, "strict clearance should reduce exact full-fit capacity");

console.log("mixed-packing tests passed");
