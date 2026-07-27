"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "packing-evaluator.js"), "utf8");
const context = { globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "packing-evaluator.js" });

const { evaluateLayout } = context.PackingEvaluator;

function layout({ cartonInner, boxDims, boxes, improvement = 0, foam = false, foamTotal = 0, hasExistingFoam = true }) {
  const carton = { inner: cartonInner, has_existing_foam: hasExistingFoam };
  const box = { dims: boxDims };
  const usedLength = Math.max(...boxes.map(item => item.x + item.length));
  const usedWidth = Math.max(...boxes.map(item => item.y + item.width));
  const usedHeight = Math.max(...boxes.map(item => item.z + item.height));
  const item = {
    mode: "mixedOrientationFlat",
    boxes,
    counts: [boxes.length, 1, 1],
    orientation: boxDims,
    quantity: boxes.length,
    residual: [
      cartonInner[0] - usedLength,
      cartonInner[1] - usedWidth,
      cartonInner[2] - usedHeight
    ],
    areaUtilization: boxes.reduce((sum,entry) => sum + entry.length * entry.width, 0) / (cartonInner[0] * cartonInner[1]),
    utilization: boxes.length * boxDims[0] * boxDims[1] * boxDims[2] / (cartonInner[0] * cartonInner[1] * cartonInner[2]),
    foamTotal,
    improvement
  };
  return evaluateLayout(item, carton, box, { foam });
}

const good = layout({
  cartonInner: [104, 104, 24],
  boxDims: [50, 50, 20],
  boxes: [
    { x: 0, y: 0, z: 0, length: 50, width: 50, height: 20 },
    { x: 50, y: 0, z: 0, length: 50, width: 50, height: 20 },
    { x: 0, y: 50, z: 0, length: 50, width: 50, height: 20 },
    { x: 50, y: 50, z: 0, length: 50, width: 50, height: 20 }
  ],
  improvement: 2
});
assert.strictEqual(good.recommendationTier, 0, "4mm minimum clearance with no internal gap should be recommended");
assert.strictEqual(good.gap.level, "good", "tight grid should not be treated as a gap");
assert.strictEqual(good.tags.length, 0, "positive labels should not be rendered as tags");

const noFoamNeeded = layout({
  cartonInner: [105.5, 105.5, 25.5],
  boxDims: [50, 50, 20],
  boxes: [
    { x: 0, y: 0, z: 0, length: 50, width: 50, height: 20 },
    { x: 50, y: 0, z: 0, length: 50, width: 50, height: 20 },
    { x: 0, y: 50, z: 0, length: 50, width: 50, height: 20 },
    { x: 50, y: 50, z: 0, length: 50, width: 50, height: 20 }
  ],
  foam: true,
  improvement: 2
});
assert.strictEqual(noFoamNeeded.clearanceStatus.level, "good", "5.5mm clearance should be reasonable when it simply does not add foam");
assert.strictEqual(noFoamNeeded.tags.length, 0, "5.5mm clearance should not show a foam-space warning tag");

const tight = layout({
  cartonInner: [102, 102, 22],
  boxDims: [50, 50, 20],
  boxes: good.footprint ? [
    { x: 0, y: 0, z: 0, length: 50, width: 50, height: 20 },
    { x: 50, y: 0, z: 0, length: 50, width: 50, height: 20 },
    { x: 0, y: 50, z: 0, length: 50, width: 50, height: 20 },
    { x: 50, y: 50, z: 0, length: 50, width: 50, height: 20 }
  ] : [],
  improvement: 2
});
assert(tight.recommendationTier >= 2, "2mm minimum clearance should be downgraded as assembly risk");
assert.strictEqual(tight.clearanceStatus.level, "tight", "2mm clearance should be marked tight");
assert.strictEqual(tight.tags.length, 1, "tight clearance should produce only one risk tag");
assert.strictEqual(tight.tags[0], "装配偏紧", "tight clearance should produce the assembly-risk tag");

const gapped = layout({
  cartonInner: [120, 100, 24],
  boxDims: [50, 40, 20],
  boxes: [
    { x: 0, y: 0, z: 0, length: 50, width: 40, height: 20 },
    { x: 50, y: 0, z: 0, length: 50, width: 40, height: 20 },
    { x: 0, y: 40, z: 0, length: 50, width: 40, height: 20 }
  ],
  improvement: 1
});
assert.strictEqual(gapped.gap.level, "poor", "large empty area inside the layer bounds should be marked as a clear gap");
assert.strictEqual(gapped.recommendationTier, 3, "clear gap should be pushed to the last recommendation group");
assert(gapped.tags.includes("有明显缺口"), "clear gap should produce a visible risk tag");

const visibleGap = layout({
  cartonInner: [106, 106, 25],
  boxDims: [58, 100, 20],
  boxes: [
    { x: 0, y: 0, z: 0, length: 58, width: 100, height: 20 },
    { x: 58, y: 0, z: 0, length: 42, width: 90, height: 20 }
  ],
  improvement: 1
});
assert(visibleGap.footprint.internalGapRatio >= 0.03, "fixture should represent a visible mixed-layout gap");
assert.strictEqual(visibleGap.gap.level, "poor", "3%+ internal gap should be treated as a visible gap");
assert(visibleGap.tags.includes("有明显缺口"), "3%+ internal gap should show a visible-gap tag");

const missingOriginalFoam = layout({
  cartonInner: [120, 120, 40],
  boxDims: [50, 50, 20],
  boxes: [
    { x: 0, y: 0, z: 0, length: 50, width: 50, height: 20 },
    { x: 50, y: 0, z: 0, length: 50, width: 50, height: 20 },
    { x: 0, y: 50, z: 0, length: 50, width: 50, height: 20 },
    { x: 50, y: 50, z: 0, length: 50, width: 50, height: 20 }
  ],
  foam: true,
  foamTotal: 4,
  hasExistingFoam: false,
  improvement: 2
});
assert.strictEqual(missingOriginalFoam.tags.length, 1, "foam-filled plans without original paired foam should produce one tag");
assert.strictEqual(missingOriginalFoam.tags[0], "无原装配套泡棉", "foam-filled plans without original paired foam should be called out");

console.log("packing-evaluator tests passed");
