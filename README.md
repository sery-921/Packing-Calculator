# 📦 Packing Calculator

> 装箱排箱计算器 — 从外箱 / 内箱 / 销售盒尺寸出发，自动给出多方案装箱排布、成本对比、EPE 珍珠棉匹配与包装图纸、BOM清单输出。

[🌐 在线访问 / Live Demo](https://sery-921.github.io/Packing-Calculator/) ·
[📘 使用说明 / Docs](#-使用说明) ·
[📷 截图 / Screenshots](#-截图) ·
[🧰 技术栈 / Tech Stack](#-技术栈)

![Platform](https://img.shields.io/badge/platform-GitHub%20Pages-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active-success)
![Made with](https://img.shields.io/badge/made%20with-HTML%20%7C%20JS%20%7C%20Python-orange)

---

## ✨ 功能特性

- **多方案对比**：一次计算输出多个可行装箱方案，按空间利用率、装箱数、成本排序，不再只看单一结果。
- **成本排名**：填入纸箱单价后，自动按"单内箱包装成本"排序，辅助选型决策。
- **物流纸箱库**：内置常见通用物流纸箱尺寸、材质、编码与已有珍珠棉备注，直接选型无需翻表。
- **EPE 珍珠棉匹配**：内置珍珠棉 SKU 尺寸库与最终面位匹配表，自动给出每面珍珠棉编码、数量与方向校验。
- **方向与间隙控制**：支持保持直立 / 允许翻转，支持满填充优先与严格间隙两种模式。
- **人体工学提醒**：当外箱尺寸或重量超出搬运建议时给出警告，而非直接过滤。
- **图纸输出**：
  - `DXF` 工程图 — ZWCAD / CAD 可直接打开，可编辑的源文件
  - `PDF` 部门对接文档 — 含俯视图、侧视图、装箱数、内箱数、珍珠棉分配与编码等
- **BOM输出**：
  - `Excel` BOM清单 — 可直接复制粘贴或者直接使用的BOM清单
- **离线可用**：纯前端静态应用，无需 API Key，手机 / 平板 / 桌面均可使用。

---

## 📷 截图

> 截图待补充。可参考[在线版本](https://sery-921.github.io/Packing-Calculator/)实际效果。

---

## 🚀 快速开始

### 在线使用（推荐）

直接打开 [https://sery-921.github.io/Packing-Calculator/](https://sery-921.github.io/Packing-Calculator/) 即可使用，无需安装。

### 本地运行

```bash
git clone https://github.com/sery-921/Packing-Calculator.git
cd Packing-Calculator
# 直接用浏览器打开 index.html，或启动本地服务器
python -m http.server 8000
# 浏览器访问 http://localhost:8000
```

---

## 📘 使用说明

1. **填写尺寸**：输入外箱内尺寸（或外径 + 纸板厚度）、销售盒尺寸、间隙要求。
2. **选择纸箱**：从内置物流纸箱库选择，或手动填入自定义纸箱尺寸。
3. **查看方案**：计算结果会列出多个可行方案，包含每箱装箱数、利用率、所需纸箱数与成本。
4. **珍珠棉匹配**：自动给出各面珍珠棉编码、数量与方向，供SOP作业等参考。
5. **导出图纸**：按需导出 DXF 图纸、 PDF 文档、 Excel 清单等。

### 输入约定速查

| 参数 | 含义 | 示例 |
|---|---|---|
| `outer_dim` | 外箱外径 (L×W×H) | `430×260×260` |
| `wall_thickness_mm` | 纸板厚度 | `6` (K=K / BC) |
| `box_dim` | 销售盒尺寸 | `100×60×40` |
| `clearance_mm` | 单方向总间隙 | `3` |
| `keep_upright` | 是否保持直立 | `true` |
| `allow_full_fit` | 满填充优先 | `true` |

### 纸板厚度换算规则

| 材质 | 板厚 | 外径内径扣减 (L/W/H) |
|---|---|---|
| K=K / BC 双瓦楞 | 6 mm | 12 / 12 / 24 |
| BE 双瓦楞 | 5 mm | 10 / 10 / 20 |
| K6K | 3 mm | 6 / 6 / 12 |
| K3K / K3KE | 2 mm | 4 / 4 / 8 |

---

## 🧰 技术栈

| 层 | 技术 |
|---|---|
| 前端 | HTML5 · CSS3 · 原生 JavaScript |
| 计算引擎 | Python 3 (`packaging_optimizer.py`) |
| 数据格式 | JSON · DXF · SVG · STL |
| 部署 | GitHub Pages（静态托管） |
| 图纸 | ZWCAD 兼容 DXF · reportlab PDF |

---

## 📁 项目结构

```text
Packing-Calculator/
├── index.html              # 移动端 Web 应用入口
├── assets/
│   └── mobile-app/         # 离线静态应用（与在线版同步）
│       ├── common-cartons.js    # Seeed 物流纸箱库
│       ├── epe-foam-skus.js     # 珍珠棉 SKU 尺寸
│       └── epe-foam-face-maps.js # 珍珠棉面位匹配
├── references/
│   ├── common-cartons.json
│   ├── epe-foam-skus.json
│   ├── epe-foam-face-maps.json
│   ├── input-schema.md
│   ├── input-schema.json
│   └── portable-prompt.md
└── scripts/
    ├── packaging_optimizer.py
    ├── import_common_cartons.py
    ├── import_epe_foam_skus.py
    └── import_epe_face_maps.py
```

---

## 🔧 数据更新

当 Seeed 物流纸箱或珍珠棉工作簿更新后，重新导入数据：

```powershell
python scripts/import_common_cartons.py "物流纸箱汇总.xlsx" --json references/common-cartons.json --js assets/mobile-app/common-cartons.js
python scripts/import_epe_foam_skus.py "珍珠棉尺寸汇总.xlsx" --json references/epe-foam-skus.json --js assets/mobile-app/epe-foam-skus.js
python scripts/import_epe_face_maps.py "珍珠棉尺寸最终匹配检查.xlsx" --json references/epe-foam-face-maps.json --js assets/mobile-app/epe-foam-face-maps.js
```

---

## ⚠️ 说明与限制

- 优化范围覆盖**统一朝向的直线网格排布**，不保证混合朝向 / 异形件的装箱最优。
- 纸板厚度换算为经验估算值，优先以供应商实测内径或实际壁厚为准。
- 人体工学提醒为参考建议，最终搬运可行性请结合实际工况判断。
- 裸产品+刀卡模式由于目前暂时不常用，对应的内置数据库有限。且产品要考虑倾斜角度及单格防止个数，所以工程预览处暂时未采用和销售内盒模式一致的3d预览，后续可能考虑优化。

---

## 📄 许可证

本项目采用 [MIT License](LICENSE)。

## 🙏 致谢

- 实习公司：物流纸箱与珍珠棉数据来源
- 所有参与测试与反馈的用户

---

<p align="center">
  Made with care for packaging engineers.
</p>
