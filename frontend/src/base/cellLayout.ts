export type Point = { x: number; y: number };
export type CellId = `cell_${number}`;

export type BaseCellLayout = {
  id: CellId;
  points: [Point, Point, Point, Point];
  offsetX: number;
  offsetY: number;
};

// These dimensions define the canonical coordinate space for the base map.
// Cell points are authored in this space so placement stays consistent
// across monitors and viewport sizes.
export const BASE_MAP_WIDTH = 1920;
export const BASE_MAP_HEIGHT = 1080;

export const BASE_CELL_IDS = Array.from({ length: 16 }, (_, index) => `cell_${index + 1}` as CellId);

export const BASE_CELL_DEFAULTS: BaseCellLayout[] = [
  { id: "cell_1", points: [{ x: 658, y: 260 }, { x: 740, y: 320 }, { x: 659, y: 382 }, { x: 579, y: 319 }], offsetX: -50, offsetY: 151 },
  { id: "cell_2", points: [{ x: 866, y: 259 }, { x: 946, y: 318 }, { x: 866, y: 379 }, { x: 787, y: 319 }], offsetX: -140, offsetY: 62 },
  { id: "cell_3", points: [{ x: 1076, y: 262 }, { x: 1157, y: 319 }, { x: 1077, y: 379 }, { x: 997, y: 318 }], offsetX: -235, offsetY: -28 },
  { id: "cell_4", points: [{ x: 1289, y: 262 }, { x: 1368, y: 321 }, { x: 1288, y: 383 }, { x: 1208, y: 321 }], offsetX: -330, offsetY: -117 },
  { id: "cell_5", points: [{ x: 714, y: 364 }, { x: 794, y: 426 }, { x: 713, y: 487 }, { x: 633, y: 426 }], offsetX: 6, offsetY: 127 },
  { id: "cell_6", points: [{ x: 924, y: 367 }, { x: 1004, y: 426 }, { x: 924, y: 488 }, { x: 844, y: 427 }], offsetX: -85, offsetY: 35 },
  { id: "cell_7", points: [{ x: 1134, y: 362 }, { x: 1213, y: 422 }, { x: 1134, y: 485 }, { x: 1054, y: 424 }], offsetX: -176, offsetY: -48 },
  { id: "cell_8", points: [{ x: 1345, y: 368 }, { x: 1423, y: 429 }, { x: 1344, y: 490 }, { x: 1264, y: 428 }], offsetX: -268, offsetY: -139 },
  { id: "cell_9", points: [{ x: 770, y: 469 }, { x: 850, y: 531 }, { x: 770, y: 593 }, { x: 690, y: 531 }], offsetX: 69, offsetY: 111 },
  { id: "cell_10", points: [{ x: 980, y: 471 }, { x: 1060, y: 530 }, { x: 980, y: 592 }, { x: 898, y: 530 }], offsetX: -22, offsetY: 20 },
  { id: "cell_11", points: [{ x: 1187, y: 467 }, { x: 1266, y: 528 }, { x: 1187, y: 589 }, { x: 1106, y: 529 }], offsetX: -111, offsetY: -66 },
  { id: "cell_12", points: [{ x: 1397, y: 472 }, { x: 1475, y: 532 }, { x: 1396, y: 594 }, { x: 1315, y: 532 }], offsetX: -206, offsetY: -156 },
  { id: "cell_13", points: [{ x: 823, y: 573 }, { x: 904, y: 632 }, { x: 824, y: 695 }, { x: 743, y: 634 }], offsetX: 135, offsetY: 99 },
  { id: "cell_14", points: [{ x: 1038, y: 575 }, { x: 1118, y: 635 }, { x: 1039, y: 697 }, { x: 956, y: 636 }], offsetX: 40, offsetY: 6 },
  { id: "cell_15", points: [{ x: 1240, y: 575 }, { x: 1320, y: 635 }, { x: 1241, y: 697 }, { x: 1160, y: 635 }], offsetX: -43, offsetY: -82 },
  { id: "cell_16", points: [{ x: 1455, y: 575 }, { x: 1534, y: 635 }, { x: 1455, y: 698 }, { x: 1374, y: 635 }], offsetX: -147, offsetY: -167 }
];
