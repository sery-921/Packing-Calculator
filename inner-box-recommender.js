"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const boxes = Array.isArray(window.COMMON_INNER_BOXES) ? window.COMMON_INNER_BOXES : [];
  const DEFAULT_THICKNESS = { K6K: 3, K3K: 2, "K3KE 坑": 2, "K3KE坑": 2, K3KE: 2 };
  const DEFAULT_DEDUCTION_FACTORS = [10, 3, 2];
  const gradeRank = { A: 0, B: 1, C: 2, "需填充": 3 };
  let candidatesExpanded = false;

  const number = id => {
    const value = Number($(id)?.value);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const text = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const volume = dims => dims.reduce((a, b) => a * b, 1);

  function thicknessFor(record) {
    if (Number(record.boardThickness) > 0) return Number(record.boardThickness);
    const material = String(record.material || "").toUpperCase();
    if (material.includes("K6K")) return DEFAULT_THICKNESS.K6K;
    if (material.includes("K3KE")) return DEFAULT_THICKNESS.K3KE;
    if (material.includes("K3K")) return DEFAULT_THICKNESS.K3K;
    return 2;
  }

  function innerDimensions(record) {
    const outer = record.outer.map(Number);
    const t = thicknessFor(record);
    const factors = Array.isArray(record.deductionFactors) && record.deductionFactors.length === 3
      ? record.deductionFactors.map(Number)
      : DEFAULT_DEDUCTION_FACTORS;
    return outer.map((size, index) => Math.max(0, size - t * factors[index]));
  }

  function grade(gaps) {
    const maxGap = Math.max(...gaps);
    const heightGap = gaps[2];
    if (maxGap <= 12 && heightGap <= 8) return "A";
    if (maxGap <= 20 && heightGap <= 15) return "B";
    if (maxGap <= 35 && heightGap <= 25) return "C";
    return "需填充";
  }

  function calculate(record, productDims, buffer, rotate) {
    const inner = innerDimensions(record);
    const packed = productDims.map(size => size + buffer * 2);
    const oriented = rotate ? [packed[1], packed[0], packed[2]] : packed;
    if (oriented.some((size, index) => size > inner[index] + 1e-9)) return null;
    const gaps = inner.map((size, index) => +(size - oriented[index]).toFixed(1));
    const util = volume(packed) / volume(inner);
    return {
      record, inner, packed, oriented, gaps, rotate, util,
      grade: grade(gaps), maxGap: Math.max(...gaps)
    };
  }

  function recommend() {
    const productDims = [number("productL"), number("productW"), number("productH")];
    const buffer = number("productBuffer");
    if (productDims.some(value => value <= 0)) throw new Error("请填写产品长、宽、高（均需大于 0）。");
    const allowRotate = $("productRotate")?.checked !== false;
    const results = boxes.flatMap(record => {
      const candidates = [calculate(record, productDims, buffer, false)];
      if (allowRotate && productDims[0] !== productDims[1]) candidates.push(calculate(record, productDims, buffer, true));
      return candidates.filter(Boolean);
    });
    results.sort((a, b) => gradeRank[a.grade] - gradeRank[b.grade] || a.maxGap - b.maxGap || b.util - a.util || volume(a.inner) - volume(b.inner));
    return results;
  }

  function card(item, index) {
    const r = item.record;
    const [ol, ow, oh] = r.outer;
    const [il, iw, ih] = item.inner;
    const [gl, gw, gh] = item.gaps;
    const gradeClass = item.grade === "A" ? "grade-a" : item.grade === "B" ? "grade-b" : item.grade === "C" ? "grade-c" : "grade-fill";
    const orientation = item.rotate ? "长宽旋转 90°" : "原方向 0°";
    const logo = r.logo ? ` · ${text(r.logo)}` : "";
    return `<article class="inner-match-card ${gradeClass}">
      <div class="inner-match-top"><div><span class="match-grade">${text(item.grade)}</span><strong>${text(r.code || r.sku)}</strong></div><span class="match-rank">#${index + 1}</span></div>
      <p class="match-name">${text(r.name || "通用飞机盒")}</p>
      <div class="match-grid"><span>外尺寸<strong>${ol} × ${ow} × ${oh} mm</strong></span><span>估算内尺寸<strong>${il} × ${iw} × ${ih} mm</strong></span><span>产品包络<strong>${item.packed.join(" × ")} mm</strong></span><span>摆放方向<strong>${orientation}</strong></span></div>
      <div class="match-footer"><span>余量 L/W/H：${gl} / ${gw} / ${gh} mm · 利用率 ${(item.util * 100).toFixed(1)}%${logo}</span><button type="button" data-inner-match="${index}">使用此内盒</button></div>
      <small class="match-note">材质 ${text(r.material || "未填写")} · 单板 ${thicknessFor(r)} mm</small>
    </article>`;
  }

  function apply(item) {
    const [l, w, h] = item.record.outer;
    window.applyingCommonInnerBox = true;
    window.selectedCommonInnerBox = {
      sku: item.record.sku || "",
      code: item.record.code || "",
      name: item.record.name || "通用飞机盒",
      outer: item.record.outer.map(Number),
      material: item.record.material || "",
      logo: item.record.logo || "",
      note: item.record.note || ""
    };
    $("innerL").value = l;
    $("innerW").value = w;
    $("innerH").value = h;
    ["innerL", "innerW", "innerH"].forEach(id => $(id)?.dispatchEvent(new Event("input", { bubbles: true })));
    window.applyingCommonInnerBox = false;
    const status = $("innerMatchStatus");
    status.textContent = `${item.record.code || item.record.sku} 已带入销售内盒外尺寸：${l} × ${w} × ${h} mm；估算内尺寸 ${item.inner.join(" × ")} mm。`;
    status.className = "inner-match-status success";
    $("innerMatchResults")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("innerL")?.focus({ preventScroll: true });
  }

  function render(results, resetDisclosure = false) {
    const target = $("innerMatchResults");
    const status = $("innerMatchStatus");
    if (resetDisclosure) candidatesExpanded = false;
    if (!results.length) {
      target.innerHTML = `<div class="inner-empty"><strong>暂未匹配到可用内盒</strong><span>可减少缓冲厚度、允许长宽旋转，或补充更大的通用内盒记录。</span></div>`;
      status.textContent = "没有满足产品包络尺寸的记录。";
      status.className = "inner-match-status warning";
      return;
    }
    const visibleResults = results.slice(0, 8);
    target.innerHTML = `<div class="inner-results-summary">
      <button class="candidate-disclosure" type="button" aria-expanded="${candidatesExpanded}" aria-controls="innerMatchResultsBody">
        <strong>找到 ${results.length} 个候选</strong><span class="disclosure-label">${candidatesExpanded ? "收起" : "展开"}</span><i class="disclosure-arrow" aria-hidden="true"></i>
      </button>
      <span>A 级优先；C 级或“需填充”建议加缓冲并人工确认。</span>
    </div>
    <div id="innerMatchResultsBody" class="inner-match-results-body"${candidatesExpanded ? "" : " hidden"}>${visibleResults.map(card).join("")}</div>`;
    status.textContent = `已按贴合度排序；点击“找到 ${results.length} 个候选”可展开查看。`;
    status.className = "inner-match-status";
    target.querySelector(".candidate-disclosure")?.addEventListener("click", event => {
      candidatesExpanded = event.currentTarget.getAttribute("aria-expanded") !== "true";
      event.currentTarget.setAttribute("aria-expanded", String(candidatesExpanded));
      event.currentTarget.querySelector(".disclosure-label").textContent = candidatesExpanded ? "收起" : "展开";
      $("innerMatchResultsBody").hidden = !candidatesExpanded;
    });
    target.querySelectorAll("[data-inner-match]").forEach(button => button.addEventListener("click", () => apply(results[Number(button.dataset.innerMatch)])));
  }

  function run(resetDisclosure = false) {
    try { render(recommend(), resetDisclosure); }
    catch (error) {
      $("innerMatchResults").innerHTML = `<div class="inner-empty"><strong>输入有误</strong><span>${text(error.message)}</span></div>`;
      $("innerMatchStatus").textContent = "请检查产品尺寸与缓冲设置。";
      $("innerMatchStatus").className = "inner-match-status warning";
    }
  }

  $("recommendInnerBox")?.addEventListener("click", () => run(true));
  ["productL", "productW", "productH", "productBuffer"].forEach(id => $(id)?.addEventListener("input", () => {
    if ($("innerMatchResults")?.children.length) run(false);
  }));
  $("productRotate")?.addEventListener("change", () => {
    if ($("innerMatchResults")?.children.length) run(false);
  });
})();
