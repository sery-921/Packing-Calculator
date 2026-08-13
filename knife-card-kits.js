"use strict";

window.KNIFE_CARD_KITS = [
  {
    id: "C09-01",
    cartonCode: "C09",
    label: "C09 刀卡 01",
    enabled: true,
    cells: [10, 1],
    layers: 3,
    cell: [35, 170, 82],
    residualText: "1 x ? x 0",
    notes: ["清单注明 C09 刀卡两端不算格位，仅作为缓冲间隙", "清单备注：3 层暂不计平卡高度"],
    cards: [
      { role: "B", sku: "327121987", name: "C09 纸箱通用刀卡-B", size: [201, 82, 3], material: "K6K" },
      { role: "A", sku: "327121988", name: "C09 纸箱通用刀卡-A", size: [417, 82, 3], material: "K6K" }
    ],
    flatCard: { sku: "327121989", name: "C09 纸箱通用平卡", size: [415, 195, 3], material: "K6K", countMode: "ignored-for-c09-preview" }
  },
  {
    id: "C10-01",
    cartonCode: "C10",
    label: "C10 刀卡 01",
    enabled: true,
    cells: [14, 3],
    layers: 4,
    cell: [25, 92, 59.5],
    residualText: "3 x 3 x 2",
    cards: [
      { role: "A", sku: "327000414", name: "C10 通用刀卡A", size: [485, 59.5, 6], material: "K=K" },
      { role: "B", sku: "327000415", name: "C10 通用刀卡B", size: [355, 59.5, 6], material: "K=K" }
    ],
    flatCard: { sku: "327121808", name: "Piper 配件盒运输包装平卡", size: [485, 355, 2], material: "K3K" }
  },
  {
    id: "C10-02",
    cartonCode: "C10",
    label: "C10 刀卡 02",
    enabled: true,
    cells: [7, 3],
    layers: 4,
    cell: [60, 100, 59.5],
    cellPacking: {
      units: 3,
      direction: "width",
      arrangement: [1, 3, 1],
      note: "清单备注：一格里放 3 个产品，所以底数 252；实际刀卡格数为 84"
    },
    residualText: "3 x 3 x 2",
    cards: [
      { role: "A", sku: "327000385", name: "C10 通用刀卡A", size: [485, 59.5, 3], material: "K6K" },
      { role: "B", sku: "327000386", name: "C10 通用刀卡B", size: [355, 59.5, 3], material: "K6K" }
    ],
    flatCard: { sku: "327121808", name: "Piper 配件盒运输包装平卡", size: [485, 355, 2], material: "K3K" }
  },
  {
    id: "C10-03",
    cartonCode: "C10",
    label: "C10 刀卡 03",
    enabled: true,
    cells: [31, 3],
    layers: 3,
    cell: [12, 110, 80],
    residualText: "? x ? x 0",
    cards: [
      { role: "长", sku: "327000046", name: "C10 通用刀卡长", size: [491, 80, 3], material: "K6K" },
      { role: "短", sku: "327000047", name: "C10 通用刀卡短", size: [362, 80, 3], material: "K6K" }
    ],
    flatCard: { sku: "327122699", name: "刀卡底 C10 通用平卡", size: [494, 364, 3], material: "K6K" },
    notes: ["平卡/刀卡外形尺寸略大于当前 C10 内尺寸换算值，预览以清单高度余量为准"]
  },
  {
    id: "C10-04",
    cartonCode: "C10",
    label: "C10 刀卡 04",
    enabled: false,
    cells: [13, 3],
    layers: 2,
    cell: [30, 102, 120],
    residualText: "3 x 3 x 4",
    cards: [
      { role: "A", sku: "327122082", name: "C10 纸箱通用刀卡A", size: [485, 120, 3], material: "K6K" },
      { role: "B", sku: "327122083", name: "C10 纸箱通用刀卡B", size: [355, 120, 3], material: "K6K" }
    ],
    flatCard: { sku: "327121808", name: "Piper 配件盒运输包装平卡", size: [485, 355, 2], material: "K3K" },
    notes: ["A 卡 PDF 文件名标注“图纸有问题”，自动推荐暂不启用"]
  },
  {
    id: "C10-05",
    cartonCode: "C10",
    label: "C10 刀卡 05",
    enabled: true,
    cells: [31, 3],
    layers: 2,
    cell: [12, 110, 85],
    residualText: "? x ? x 73",
    cards: [
      { role: "短", sku: "327122697", name: "Carzyradio 刀卡短", size: [362, 85, 3], material: "K6K" },
      { role: "长", sku: "327122698", name: "Carzyradio 刀卡长", size: [491, 85, 3], material: "K6K" }
    ],
    flatCard: { sku: "327122699", name: "刀卡底 C10 通用平卡", size: [494, 364, 3], material: "K6K" },
    notes: ["平卡/刀卡外形尺寸略大于当前 C10 内尺寸换算值，预览以清单高度余量为准"]
  },
  {
    id: "C10-06",
    cartonCode: "C10",
    label: "C10 刀卡 06",
    enabled: true,
    cells: [31, 5],
    layers: 3,
    cell: [12, 60, 62],
    residualText: "? x ? x 54",
    cards: [
      { role: "短", sku: "327122700", name: "Flow-deck 刀卡短", size: [362, 62, 3], material: "K6K" },
      { role: "长", sku: "327122701", name: "Flow-deck 刀卡长", size: [491, 62, 3], material: "K6K" }
    ],
    flatCard: { sku: "327122699", name: "刀卡底 C10 通用平卡", size: [494, 364, 3], material: "K6K" },
    notes: ["清单备注：4 层加平卡为 257 mm > C10 内高 246 mm，预览保守选 3 层"]
  }
];
