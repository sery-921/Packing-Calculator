"use strict";
// 气泡片裹包计算模块（确定性公式）
(() => {
  const LAYER_MM = 2;
  const FACES_PER_TURN = 2;
  const PER_TURN = LAYER_MM * FACES_PER_TURN; // 4mm/圈/面方向
  const SPECS = {
    375: { sku: "403120021", label: "气泡袋原料 375×100000mm" },
    750: { sku: "403120000", label: "气泡袋原料 750×150000mm" }
  };
const AXES = ["length", "width", "height"];
const LABEL = ["长", "宽", "高"];
let confirmed = false;  // 是否已确认用裹后尺寸参与推荐
let foldsTouched = false;  // 用户是否手动改过对折次数
let setting = false;  // 程序写入输入框时的防循环标志
let rawDims = null;  // 确认时的裸品尺寸快照
const FIELD_IDS = ["productL", "productW", "productH"];
// 裹前裸品尺寸：确认时用快照，避免读回填的裹后尺寸导致重复累加
function rawProductDims() {
  if (rawDims) return rawDims;
  return [num("productL"), num("productW"), num("productH")];
}
// 把裹后尺寸写进产品长宽高框（只读），让用户看见推荐所用的尺寸
function syncProductFields() {
  const r = describe();
  if (!r) return;
  setting = true;
  FIELD_IDS.forEach((id, i) => { $(id).value = r.wrapped[i]; $(id).readOnly = true; });
  setting = false;
}
// 取消确认/收起：恢复裸品尺寸，字段可编辑
function restoreProductFields() {
  if (!rawDims) return;
  setting = true;
  FIELD_IDS.forEach((id, i) => { $(id).value = rawDims[i]; $(id).readOnly = false; });
  setting = false;
  rawDims = null;
}
// 最大可对折次数 = floor(料宽 / 裹向尺寸) - 1，下限 0
function maxFolds() {
  const [L, W, H] = rawProductDims();
  if (L <= 0 || W <= 0 || H <= 0) return 0;
  const axis = AXES.indexOf(document.querySelector('input[name="bwAxis"]:checked')?.value || "length");
  const sheetWidth = Number($("bwSheetWidth")?.value) || 375;
  const dims = [L, W, H];
  const m = Math.floor(sheetWidth / dims[axis]) - 1;
  return m > 0 ? m : 0;
}
 // 把对折次数默认顶到最大可对折值
 function applyDefaultFolds() {
   const k = maxFolds();
   setting = true;
   $("bwFolds").value = k;
   setting = false;
 }

 const $ = id => document.getElementById(id);
  const num = id => {
    const v = Number($(id)?.value);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const round = (v, d = 1) => {
    const f = Math.pow(10, d);
    return Math.round(v * f) / f;
  };

  // 纯函数：计算裹后尺寸与用量
  function compute(dims, axis, turns, folds, foldDir, sheetWidth) {
    const inc = [0, 0, 0];
    const perp = [0, 1, 2].filter(i => i !== axis);
    perp.forEach(i => { inc[i] = PER_TURN * turns; });
    // 对折翻边：余料从裹向端部折回，U 形翻边层数 (n+1)×2^k，按 5mm 档严格向上进位
    const foldLipTheory = folds > 0 ? LAYER_MM * (turns + 1) * Math.pow(2, folds) : 0;
    const foldLipInc = folds > 0 ? Math.floor(foldLipTheory / 5) * 5 + 5 : 0;
    inc[axis] += foldLipInc;
    // 折回料叠到顶面：高方向平铺叠层；裹高向时与翻边同向，仍叠加到高
    const foldAxis = 2;
    inc[foldAxis] += PER_TURN * turns * folds;
    const wrapped = dims.map((d, i) => round(d + inc[i], 2));
    const usage = (dims[perp[0]] + dims[perp[1]]) * 2 * turns;
    const foldFeasible = sheetWidth >= (folds + 1) * dims[axis];
    return {
      dims, axis, turns, folds, foldAxis, sheetWidth,
      foldLipTheory: round(foldLipTheory, 1),
      foldLipInc: round(foldLipInc, 1),
      increments: inc.map(v => round(v, 2)),
      wrapped,
      usage_mm: round(usage, 1),
      usage_m: round(usage / 1000, 2),
      foldFeasible,
      perp,
      sku: SPECS[sheetWidth] ? SPECS[sheetWidth].sku : ""
    };
  }

function describe() {
  const [L, W, H] = rawProductDims();
  if (L <= 0 || W <= 0 || H <= 0) return null;
    const axisStr = document.querySelector('input[name="bwAxis"]:checked')?.value || "length";
    const axis = AXES.indexOf(axisStr);
    const sheetWidth = Number($("bwSheetWidth")?.value) || 375;
    const turns = num("bwTurns");
    const folds = num("bwFolds") || 0;
    const dims = [L, W, H];
    // 折回料叠到顶面（高）；端部翻边增量在 compute 内计入裹向
    const foldDir = 2;
    if (turns <= 0) return null;
    return compute(dims, axis, turns, folds, foldDir, sheetWidth);
  }

 const basisText = () => confirmed && describe() ? `推荐基准：裹后尺寸 ${describe().wrapped.join(" × ")} mm（已确认）` : "推荐基准：裸品尺寸（未确认裹后尺寸）";
 function render() {
   const box = $("bubbleWrapResult");
   if (!box) return;
   // 只读显示裹前尺寸（取自下方产品长宽高）
  const [rawL, rawW, rawH] = rawProductDims();
  const raw = $("bwRawDims");
  if (raw) raw.textContent = `裹前尺寸 ${rawL} × ${rawW} × ${rawH} mm（取自下方，如需更改请在下方产品长 L、宽 W、高 H 处执行修改）`;
   const r = describe();
   const foldsInput = $("bwFolds");
   const foldsWarn = $("bwFoldsWarn");
   if (!r) {
     box.hidden = true;
     foldsInput?.classList.remove("bw-input-warn");
     if (foldsWarn) foldsWarn.hidden = true;
     return;
   }
    box.hidden = false;
    const incText = r.increments.map((v, i) => `${LABEL[i]} +${v}mm`).join(" · ");
    // 对折上限固定提示：文案只随料宽/裹向尺寸变化，不随当前 k 变化，避免误导
    const maxK = Math.max(0, Math.floor(r.sheetWidth / r.dims[r.axis]) - 1);
    const foldWarnText = `对折不可行：料宽 ${r.sheetWidth}mm，裹向尺寸 ${r.dims[r.axis]}mm，最多可对折 ${maxK} 次`;
    const foldWarn = !r.foldFeasible
      ? `<span class="bw-warn">${foldWarnText}</span>`
      : "";
    foldsInput?.classList.toggle("bw-input-warn", !r.foldFeasible);
    if (foldsWarn) {
      foldsWarn.hidden = r.foldFeasible;
      foldsWarn.textContent = foldWarnText;
    }
    const foldInfo = r.folds > 0
      ? `<span class="bw-fold">对折 ${r.folds} 次 → ${LABEL[r.axis]} 端部翻边 +${r.foldLipInc}mm（理论 ≥${r.foldLipTheory}mm，按5mm档进位）· ${LABEL[r.foldAxis]} 额外 +${(PER_TURN * r.turns * r.folds).toFixed(1)}mm</span>`
      : "";
    box.innerHTML = `
      <div class="bw-row"><span>裹后尺寸</span><strong>${r.wrapped.join(" × ")} mm</strong></div>
      <div class="bw-row"><span>各方向增量</span><em>${incText}</em></div>
      <div class="bw-row"><span>裹向 / 对折料</span><em>${LABEL[r.axis]} 端部翻边增厚 · 折回料叠到顶面（高）</em></div>
      ${foldInfo ? `<div class="bw-row">${foldInfo}</div>` : ""}
      ${foldWarn ? `<div class="bw-row">${foldWarn}</div>` : ""}
      <div class="bw-row bw-usage"><span>气泡片用量</span><strong>${r.usage_mm} mm (${r.usage_m} m)</strong></div>
     <div class="bw-row"><span>料卷规格 / SKU</span><em>${SPECS[r.sheetWidth]?.label || ""} · ${r.sku}</em></div>
     <button type="button" id="bwConfirm" class="bw-confirm${confirmed ? " active" : ""}">${confirmed ? "已确认用裹后尺寸推荐（点此取消）" : "确认用裹后尺寸推荐"}</button>
     <div class="bw-basis">${basisText()}</div>
   `;
   $("bwConfirm")?.addEventListener("click", toggleConfirm);
 }

 // 暴露裹后尺寸（已确认时供推荐器使用）
 function wrappedDims() {
   const r = describe();
   return r ? r.wrapped.slice() : null;
 }
 function isConfirmed() { return confirmed; }
// 确认/取消：切换"用裹后尺寸推荐"的生效状态
function toggleConfirm() {
  confirmed = !confirmed;
  if (confirmed) {
    // 快照裸品尺寸，把裹后尺寸写进产品长宽高框（只读）
    rawDims = [num("productL"), num("productW"), num("productH")];
    syncProductFields();
  } else {
    restoreProductFields();
  }
  render();
  window.dispatchEvent(new Event(confirmed ? "bubble-wrap-confirmed" : "bubble-wrap-revert"));
}

function init() {
 document.querySelectorAll(".bw-step-btn").forEach(btn => btn.addEventListener("click", () => {
   const input = document.getElementById(btn.dataset.target);
   if (!input) return;
   const step = Number(btn.dataset.step) || 0;
   const min = input.min ? Number(input.min) : 0;
   const current = Number(input.value) || 0;
   const next = Math.max(min, current + step);
   input.value = String(next);
   input.dispatchEvent(new Event("input", { bubbles: true }));
 }));
 const toggle = $("bubbleWrapToggle");
 const body = $("bubbleWrapBody");
 toggle?.addEventListener("change", () => {
   if (body) body.hidden = !toggle.checked;
  // 收起模块即取消确认，退回裸品尺寸推荐
  if (!toggle.checked && confirmed) {
   confirmed = false;
   restoreProductFields();
   window.dispatchEvent(new Event("bubble-wrap-revert"));
  }
   // 展开时默认把对折次数顶到最大可对折值
   if (toggle.checked) { foldsTouched = false; applyDefaultFolds(); }
   render();
 });
document.querySelectorAll('input[name="bwAxis"]').forEach(el => el.addEventListener("change", () => { foldsTouched = false; applyDefaultFolds(); render(); if (confirmed) window.dispatchEvent(new Event("bubble-wrap-confirmed")); }));
document.querySelectorAll('input[name="bwAxis"]').forEach(el => el.addEventListener("change", () => { foldsTouched = false; applyDefaultFolds(); render(); if (confirmed) { syncProductFields(); window.dispatchEvent(new Event("bubble-wrap-confirmed")); } }));
["bwTurns", "bwSheetWidth"].forEach(id => $(id)?.addEventListener("input", () => { render(); if (confirmed) { syncProductFields(); window.dispatchEvent(new Event("bubble-wrap-confirmed")); } }));
$("bwSheetWidth")?.addEventListener("input", () => { foldsTouched = false; applyDefaultFolds(); });
$("bwFolds")?.addEventListener("input", () => { if (setting) return; foldsTouched = true; render(); if (confirmed) { syncProductFields(); window.dispatchEvent(new Event("bubble-wrap-confirmed")); } });
["productL", "productW", "productH"].forEach(id => $(id)?.addEventListener("input", () => { if (setting) return; if (!foldsTouched) applyDefaultFolds(); render(); if (confirmed) { syncProductFields(); window.dispatchEvent(new Event("bubble-wrap-confirmed")); } }));
 render();
}

 window.BubbleWrap = { compute, describe, render, wrappedDims, isConfirmed, toggleConfirm, init, PER_TURN };
 if (document.readyState !== "loading") init();
 else document.addEventListener("DOMContentLoaded", init);
})();
