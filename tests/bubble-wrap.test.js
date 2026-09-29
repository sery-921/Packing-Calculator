"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "bubble-wrap.js"), "utf8");
const context = {
  window: {},
  document: { readyState: "loading", addEventListener() {} }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "bubble-wrap.js" });

const { compute } = context.window.BubbleWrap;

function inc(dims, axis, turns, folds) {
  return [...compute(dims, axis, turns, folds, 2, 375).increments];
}

// 绕长向裹：端部 U 形翻边计入裹向，按 5mm 档严格向上进位
assert.deepStrictEqual(inc([180, 120, 60], 0, 1, 1), [10, 4, 8], "n=1,k=1 理论8按10计");
assert.deepStrictEqual(inc([180, 120, 60], 0, 1, 2), [20, 4, 12], "n=1,k=2 理论16按20计");
assert.deepStrictEqual(inc([180, 120, 60], 0, 2, 1), [15, 8, 16], "n=2,k=1 理论12按15计");
assert.deepStrictEqual(inc([180, 120, 60], 0, 3, 1), [20, 12, 24], "n=3,k=1 理论16按20计");
assert.deepStrictEqual(inc([180, 120, 60], 0, 4, 1), [25, 16, 32], "n=4,k=1 理论20严格进到25");
assert.deepStrictEqual(inc([180, 120, 60], 0, 1, 3), [35, 4, 16], "n=1,k=3 理论32按35计");

// 不对折：裹向端面敞开，翻边增量为 0
assert.deepStrictEqual(inc([180, 120, 60], 0, 2, 0), [0, 8, 8], "k=0 裹向不加");

// 绕宽向裹：翻边增量换到宽方向
assert.deepStrictEqual(inc([180, 120, 60], 1, 1, 1), [4, 10, 8], "裹宽向翻边加宽");

// 裹后尺寸、用量与对折可行性
const r = compute([180, 120, 60], 0, 1, 1, 2, 375);
assert.strictEqual(r.foldLipTheory, 8, "翻边理论下限");
assert.strictEqual(r.foldLipInc, 10, "翻边工程值");
assert.deepStrictEqual([...r.wrapped], [190, 124, 68], "裹后尺寸");
assert.strictEqual(r.usage_mm, 360, "用量 = (W+H)×2×圈数");
assert.strictEqual(r.foldFeasible, true, "375 >= 2×180");

console.log("bubble-wrap.test.js passed");
