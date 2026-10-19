// Базовые типы симуляции: направления, предметы, сущности мира (здания, ленты, логистика).
// Чистый TypeScript без Phaser.

/** Направление: 0 — вверх, 1 — вправо, 2 — вниз, 3 — влево. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}
/** Поворот по часовой стрелке (направо). */
export function turnRight(d: Dir): Dir {
  return ((d + 1) % 4) as Dir;
}
/** Поворот против часовой стрелки (налево). */
export function turnLeft(d: Dir): Dir {
  return ((d + 3) % 4) as Dir;
}

export type ItemId =
  | 'iron_ore' | 'copper_ore' | 'tin_ore' | 'coal' | 'stone' | 'sand'
  | 'iron_ingot' | 'copper_ingot' | 'tin_ingot' | 'brick' | 'glass'
  | 'iron_plate' | 'copper_wire' | 'gear' | 'steel' | 'bronze'
  | 'circuit' | 'mechanism' | 'lens' | 'armor'
  | 'motor' | 'processor' | 'frame'
  | 'robot';

/** Производственные здания. */
export type MachineType = 'drill' | 'smelter' | 'press' | 'foundry' | 'assembler' | 'fabricator';
/** Логистика 1×1. */
export type LogisticType = 'belt' | 'merger' | 'splitter' | 'bridge';
export type BuildingType = MachineType | LogisticType;

export const MACHINE_TYPES: MachineType[] = ['drill', 'smelter', 'press', 'foundry', 'assembler', 'fabricator'];

export function isMachineType(t: BuildingType): t is MachineType {
  return (MACHINE_TYPES as BuildingType[]).includes(t);
}

/**
 * Предмет, который едет по ленте или логистическому блоку.
 * pos — положение внутри клетки: 0 — у входа, 1 — у выхода.
 * px/py — положение на прошлом тике, rx/ry — на текущем (в клетках), для плавной отрисовки.
 */
export interface MovingItem {
  id: number;
  item: ItemId;
  pos: number;
  /** Сторона клетки, через которую предмет вошёл. */
  from: Dir;
  /** Куда предмет выйдет (нужно мосту). */
  out: Dir;
  px: number;
  py: number;
  rx: number;
  ry: number;
}

/** Производственное здание (бур, плавильня, ...). x, y — левый верхний угол. */
export interface Machine {
  kind: 'machine';
  id: number;
  type: MachineType;
  x: number;
  y: number;
  size: number;
  /** Направление выхода (передняя сторона). */
  dir: Dir;
  /** Выбранный игроком рецепт (только для зданий с выбором рецепта). */
  recipe: string | null;
  /** Рецепт текущего или последнего цикла. */
  cycleRecipe: string | null;
  /** Что добывает бур (руда месторождения). */
  ore: ItemId | null;
  inBuf: Partial<Record<ItemId, number>>;
  outBuf: ItemId[];
  busy: boolean;
  /** Прогресс цикла 0..1. */
  progress: number;
}

export interface Belt {
  kind: 'belt';
  id: number;
  x: number;
  y: number;
  dir: Dir;
  /** Предметы по порядку: первый — ближе всех к выходу. */
  items: MovingItem[];
}

export interface Merger {
  kind: 'merger';
  id: number;
  x: number;
  y: number;
  dir: Dir;
  /** По одному слоту на каждую входную сторону (индекс — сторона). */
  slots: (MovingItem | null)[];
  /** Предметы на пути от центра к выходу. */
  items: MovingItem[];
  /** Какой вход обслуживать следующим (0 — сзади, 1 — слева, 2 — справа). */
  next: number;
}

export interface Splitter {
  kind: 'splitter';
  id: number;
  x: number;
  y: number;
  dir: Dir;
  items: MovingItem[];
  /** Какой выход пробовать следующим (0 — налево, 1 — вперёд, 2 — направо). */
  next: number;
}

export interface Bridge {
  kind: 'bridge';
  id: number;
  x: number;
  y: number;
  dir: Dir;
  /** Горизонтальный поток (вход слева или справа). */
  h: MovingItem[];
  /** Вертикальный поток (вход сверху или снизу). */
  v: MovingItem[];
}

export type Transport = Belt | Merger | Splitter | Bridge;
export type Entity = Machine | Transport;

/** Что лежит в клетке карты. */
export type Cell = Entity | 'base' | null;

export interface Goal {
  item: ItemId;
  amount: number;
  delivered: number;
}

/** События мира для сцен: всплывающие числа, эффекты, уведомления. */
export type GameEvent =
  | { type: 'xp'; amount: number }
  | { type: 'goalDone'; item: ItemId; bonus: number }
  | { type: 'levelUp'; level: number }
  | { type: 'unlock'; types: BuildingType[] }
  | { type: 'tutorial'; step: number }
  | { type: 'phase'; phase: number };

/** Результат проверки места для постройки. */
export interface PlaceCheck {
  ok: boolean;
  reason: string;
}
