// Все данные и числа баланса игры: карта, предметы, рецепты, здания, опыт, улучшения, цвета.
// Почти любую правку правил игры можно сделать здесь, не трогая логику.

import type { BuildingType, ItemId, MachineType } from './sim/types';

// ---------------------------------------------------------------------------
// Карта и время
// ---------------------------------------------------------------------------

/** Размер карты в клетках (нечётный, чтобы база стояла ровно по центру). */
export const MAP_W = 81;
export const MAP_H = 57;
/** Размер клетки в пикселях. */
export const CELL = 32;

/** Тиков симуляции в секунду (фиксированный шаг). */
export const TICKS_PER_SECOND = 20;

/** Размер базы (квадрат) — она всегда в центре карты. */
export const BASE_SIZE = 7;
export const BASE_X = (MAP_W - BASE_SIZE) / 2;
export const BASE_Y = (MAP_H - BASE_SIZE) / 2;

// ---------------------------------------------------------------------------
// Камера
// ---------------------------------------------------------------------------

export const CAMERA_MAX_ZOOM = 2;
/** Скорость перемещения камеры с клавиатуры, пикселей экрана в секунду. */
export const CAMERA_PAN_SPEED = 900;
/** Во сколько раз меняется зум за один щелчок колеса. */
export const CAMERA_ZOOM_STEP = 1.12;
/** На сколько пикселей экрана камера может заходить за край карты (чтобы края не прятались под интерфейсом). */
export const CAMERA_EDGE_MARGIN = 160;

/** Сила размытия фона во время паузы. */
export const PAUSE_BLUR_STRENGTH = 2;

// ---------------------------------------------------------------------------
// Палитра (тёмная тема)
// ---------------------------------------------------------------------------

export const COLORS = {
  mapBg: 0x0f1115,
  /** Фон за краем карты — чуть темнее, чтобы граница карты была видна. */
  outsideBg: 0x08090c,
  grid: 0x1a1d24,
  panel: 0x171a21,
  panelBorder: 0x2a2f3a,
  text: '#e6e6e6',
  textDim: '#8b93a1',
  accent: 0xf5a623,
  accentText: '#f5a623',
  good: 0x4caf72,
  bad: 0xe05252,
  waterA: 0x123049,
  waterB: 0x16395a,
  waterEdge: 0x2b5d86,
  rockA: 0x3a3632,
  rockB: 0x4a443e,
  rockEdge: 0x6a625a,
  base: 0x1f3a2a,
  baseBorder: 0x4caf72,
  beltBase: 0x23262d,
  beltChevron: 0x4b515c,
};

/** Шрифт для всего текста игры. */
export const FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

// ---------------------------------------------------------------------------
// Предметы
// ---------------------------------------------------------------------------

export interface ItemDef {
  name: string;
  /** Короткая метка (1–3 символа) для интерфейса. */
  label: string;
  color: number;
  tier: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  // Тир 0 — сырьё
  iron_ore: { name: 'Железная руда', label: 'Fe', color: 0x9fb4cc, tier: 0 },
  copper_ore: { name: 'Медная руда', label: 'Cu', color: 0xe0793a, tier: 0 },
  tin_ore: { name: 'Оловянная руда', label: 'Sn', color: 0x9ad6c8, tier: 0 },
  coal: { name: 'Уголь', label: 'C', color: 0x7a808c, tier: 0 },
  stone: { name: 'Камень', label: 'Кам', color: 0xbfa07a, tier: 0 },
  sand: { name: 'Песок', label: 'Пес', color: 0xf2d47a, tier: 0 },
  // Тир 1
  iron_ingot: { name: 'Железный слиток', label: 'ЖС', color: 0xc9d6e4, tier: 1 },
  copper_ingot: { name: 'Медный слиток', label: 'МС', color: 0xff8c42, tier: 1 },
  tin_ingot: { name: 'Оловянный слиток', label: 'ОС', color: 0xb8f0e4, tier: 1 },
  brick: { name: 'Кирпич', label: 'Кир', color: 0xd0583f, tier: 1 },
  glass: { name: 'Стекло', label: 'Стк', color: 0x8fe3ff, tier: 1 },
  // Тир 2
  iron_plate: { name: 'Железная пластина', label: 'Пл', color: 0xe3ebf5, tier: 2 },
  copper_wire: { name: 'Медный провод', label: 'Пр', color: 0xffb35c, tier: 2 },
  gear: { name: 'Шестерня', label: 'Шс', color: 0xa9bdd4, tier: 2 },
  steel: { name: 'Сталь', label: 'Ст', color: 0x7f9fd0, tier: 2 },
  bronze: { name: 'Бронза', label: 'Бр', color: 0xd9a03a, tier: 2 },
  // Тир 3
  circuit: { name: 'Схема', label: 'Сх', color: 0x5ee07a, tier: 3 },
  mechanism: { name: 'Механизм', label: 'Мх', color: 0xc6d2de, tier: 3 },
  lens: { name: 'Линза', label: 'Лз', color: 0x6fd0ff, tier: 3 },
  armor: { name: 'Армоблок', label: 'Арм', color: 0x9a86f0, tier: 3 },
  // Тир 4
  motor: { name: 'Мотор', label: 'Мот', color: 0xff6b6b, tier: 4 },
  processor: { name: 'Процессор', label: 'Прц', color: 0x4ade80, tier: 4 },
  frame: { name: 'Каркас', label: 'Крк', color: 0xc084fc, tier: 4 },
  // Тир 5
  robot: { name: 'Робот', label: 'Роб', color: 0xffd23f, tier: 5 },
};

/** Опыт за 1 доставленный предмет по тиру (индекс — тир). */
export const TIER_XP = [1, 3, 8, 20, 50, 120];

// ---------------------------------------------------------------------------
// Здания
// ---------------------------------------------------------------------------

/**
 * Как здание выбирает рецепт:
 * drill — добывает руду месторождения; auto — по входящему предмету;
 * select — игрок выбирает кликом; none — логистика без рецептов.
 */
export type RecipeMode = 'drill' | 'auto' | 'select' | 'none';

export interface BuildingDef {
  name: string;
  /** Сторона квадрата в клетках (1, 3 или 5). */
  size: number;
  color: number;
  border: number;
  unlockLevel: number;
  recipeMode: RecipeMode;
  /** Короткое описание для меню построек. */
  hint: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  drill: { name: 'Бур', size: 3, color: 0x4a3a2a, border: 0xa7834f, unlockLevel: 1, recipeMode: 'drill', hint: 'Ставится на месторождение' },
  smelter: { name: 'Плавильня', size: 3, color: 0x5a3028, border: 0xc0664c, unlockLevel: 1, recipeMode: 'auto', hint: 'Руда → слиток, камень → кирпич, песок → стекло' },
  press: { name: 'Пресс', size: 3, color: 0x2c3f52, border: 0x5f8db8, unlockLevel: 3, recipeMode: 'auto', hint: 'Слиток → пластина / провод, пластины → шестерня' },
  foundry: { name: 'Литейная', size: 5, color: 0x4d3350, border: 0xa06ca6, unlockLevel: 5, recipeMode: 'select', hint: 'Сталь, бронза (2 ингредиента)' },
  assembler: { name: 'Сборщик', size: 5, color: 0x264a3c, border: 0x4fa07e, unlockLevel: 8, recipeMode: 'select', hint: 'Схема, механизм, линза, армоблок' },
  fabricator: { name: 'Конструктор', size: 5, color: 0x48441f, border: 0xb0a64a, unlockLevel: 12, recipeMode: 'select', hint: 'Мотор, процессор, каркас, робот' },
  belt: { name: 'Конвейер', size: 1, color: COLORS.beltBase, border: 0x4b515c, unlockLevel: 1, recipeMode: 'none', hint: 'Везёт предметы (Q)' },
  merger: { name: 'Объединитель', size: 1, color: 0x24456b, border: 0x5b9be0, unlockLevel: 2, recipeMode: 'none', hint: '3 входа → 1 выход, по очереди' },
  splitter: { name: 'Сплиттер', size: 1, color: 0x6b5424, border: 0xe0b04f, unlockLevel: 3, recipeMode: 'none', hint: '1 вход → налево, вперёд, направо' },
  bridge: { name: 'Мост', size: 1, color: 0x3a3a4c, border: 0x9a9ac4, unlockLevel: 4, recipeMode: 'none', hint: 'Две ленты пересекаются' },
};

/** Порядок пунктов в меню построек. */
export const BUILD_MENU_ORDER: BuildingType[] = [
  'drill', 'belt', 'smelter', 'merger', 'press', 'splitter', 'bridge', 'foundry', 'assembler', 'fabricator',
];

/** Время одного цикла бура, сек (1 руда в секунду). */
export const DRILL_CYCLE_TIME = 1.0;
/** Сколько руды бур даёт за цикл без улучшений. */
export const DRILL_BASE_OUTPUT = 1;
/** Вместимость входного буфера (на каждый ингредиент) и выходного буфера. */
export const BUFFER_MAX = 10;

// ---------------------------------------------------------------------------
// Рецепты
// ---------------------------------------------------------------------------

export interface Recipe {
  id: string;
  building: MachineType;
  inputs: { item: ItemId; count: number }[];
  output: ItemId;
  outCount: number;
  /** Базовое время цикла, сек. */
  time: number;
}

export const RECIPES: Recipe[] = [
  // Плавильня — рецепт определяется входящим предметом
  { id: 'iron_ingot', building: 'smelter', inputs: [{ item: 'iron_ore', count: 1 }], output: 'iron_ingot', outCount: 1, time: 1.0 },
  { id: 'copper_ingot', building: 'smelter', inputs: [{ item: 'copper_ore', count: 1 }], output: 'copper_ingot', outCount: 1, time: 1.0 },
  { id: 'tin_ingot', building: 'smelter', inputs: [{ item: 'tin_ore', count: 1 }], output: 'tin_ingot', outCount: 1, time: 1.0 },
  { id: 'brick', building: 'smelter', inputs: [{ item: 'stone', count: 1 }], output: 'brick', outCount: 1, time: 1.0 },
  { id: 'glass', building: 'smelter', inputs: [{ item: 'sand', count: 2 }], output: 'glass', outCount: 1, time: 1.0 },
  // Пресс — рецепт определяется входящим предметом
  { id: 'iron_plate', building: 'press', inputs: [{ item: 'iron_ingot', count: 1 }], output: 'iron_plate', outCount: 1, time: 1.0 },
  { id: 'copper_wire', building: 'press', inputs: [{ item: 'copper_ingot', count: 1 }], output: 'copper_wire', outCount: 2, time: 1.0 },
  { id: 'gear', building: 'press', inputs: [{ item: 'iron_plate', count: 2 }], output: 'gear', outCount: 1, time: 1.0 },
  // Литейная — рецепт выбирается кликом
  { id: 'steel', building: 'foundry', inputs: [{ item: 'iron_ingot', count: 1 }, { item: 'coal', count: 1 }], output: 'steel', outCount: 1, time: 2.0 },
  { id: 'bronze', building: 'foundry', inputs: [{ item: 'copper_ingot', count: 3 }, { item: 'tin_ingot', count: 1 }], output: 'bronze', outCount: 2, time: 2.0 },
  // Сборщик
  { id: 'circuit', building: 'assembler', inputs: [{ item: 'iron_plate', count: 1 }, { item: 'copper_wire', count: 3 }], output: 'circuit', outCount: 1, time: 3.0 },
  { id: 'mechanism', building: 'assembler', inputs: [{ item: 'steel', count: 1 }, { item: 'gear', count: 2 }], output: 'mechanism', outCount: 1, time: 3.0 },
  { id: 'lens', building: 'assembler', inputs: [{ item: 'glass', count: 2 }, { item: 'bronze', count: 1 }], output: 'lens', outCount: 1, time: 3.0 },
  { id: 'armor', building: 'assembler', inputs: [{ item: 'brick', count: 4 }, { item: 'steel', count: 1 }], output: 'armor', outCount: 1, time: 3.0 },
  // Конструктор
  { id: 'motor', building: 'fabricator', inputs: [{ item: 'mechanism', count: 2 }, { item: 'bronze', count: 2 }], output: 'motor', outCount: 1, time: 5.0 },
  { id: 'processor', building: 'fabricator', inputs: [{ item: 'circuit', count: 2 }, { item: 'lens', count: 1 }], output: 'processor', outCount: 1, time: 5.0 },
  { id: 'frame', building: 'fabricator', inputs: [{ item: 'armor', count: 2 }, { item: 'mechanism', count: 1 }], output: 'frame', outCount: 1, time: 5.0 },
  { id: 'robot', building: 'fabricator', inputs: [{ item: 'motor', count: 1 }, { item: 'processor', count: 1 }], output: 'robot', outCount: 1, time: 5.0 },
];

// ---------------------------------------------------------------------------
// Конвейеры
// ---------------------------------------------------------------------------

/** Скорость ленты, клеток в секунду. */
export const BELT_SPEED = 3;
/** Сколько предметов помещается на одной клетке ленты. */
export const BELT_CAPACITY = 2;
/**
 * Обход препятствий при протяжке ленты: «цена» поворота в клетках пути.
 * Чем больше, тем прямее (но длиннее) получается обход.
 */
export const BELT_ROUTE_TURN_COST = 1;

// ---------------------------------------------------------------------------
// Месторождения и препятствия
// ---------------------------------------------------------------------------

/** Месторождения 3×3, координаты — левый верхний угол. Бесконечные. */
export const DEPOSITS: { x: number; y: number; ore: ItemId }[] = [
  // Верх
  { x: 10, y: 1, ore: 'copper_ore' },
  { x: 25, y: 1, ore: 'coal' },
  { x: 39, y: 1, ore: 'iron_ore' },
  { x: 53, y: 1, ore: 'coal' },
  { x: 68, y: 1, ore: 'copper_ore' },
  // Низ
  { x: 10, y: 53, ore: 'tin_ore' },
  { x: 25, y: 53, ore: 'stone' },
  { x: 39, y: 53, ore: 'iron_ore' },
  { x: 53, y: 53, ore: 'stone' },
  { x: 68, y: 53, ore: 'tin_ore' },
  // Лево
  { x: 1, y: 15, ore: 'sand' },
  { x: 1, y: 27, ore: 'iron_ore' },
  { x: 1, y: 39, ore: 'copper_ore' },
  // Право
  { x: 77, y: 15, ore: 'coal' },
  { x: 77, y: 27, ore: 'iron_ore' },
  { x: 77, y: 39, ore: 'sand' },
];
export const DEPOSIT_SIZE = 3;

/** Индекс месторождения для обучения («поставь бур на железо»). */
export const TUTORIAL_DEPOSIT = 2;

/** Препятствия: на них нельзя строить. Расставлены симметрично относительно центра. */
export const OBSTACLES: { type: 'water' | 'rock'; x: number; y: number; w: number; h: number }[] = [
  { type: 'water', x: 14, y: 18, w: 8, h: 6 },
  { type: 'water', x: 59, y: 33, w: 8, h: 6 },
  { type: 'water', x: 26, y: 36, w: 6, h: 5 },
  { type: 'water', x: 49, y: 16, w: 6, h: 5 },
  { type: 'rock', x: 20, y: 8, w: 12, h: 2 },
  { type: 'rock', x: 49, y: 47, w: 12, h: 2 },
  { type: 'rock', x: 50, y: 6, w: 2, h: 8 },
  { type: 'rock', x: 29, y: 43, w: 2, h: 8 },
  { type: 'rock', x: 8, y: 30, w: 2, h: 10 },
  { type: 'rock', x: 71, y: 17, w: 2, h: 10 },
];

// ---------------------------------------------------------------------------
// Опыт и уровни
// ---------------------------------------------------------------------------

/** Опыт до следующего уровня: round(XP_BASE × XP_GROWTH^(L−1)). */
export const XP_BASE = 50;
export const XP_GROWTH = 1.3;

/** Бонус за выполненное задание = GOAL_BONUS_MULT × количество × опыт предмета. */
export const GOAL_BONUS_MULT = 2;

// ---------------------------------------------------------------------------
// Задания
// ---------------------------------------------------------------------------

export const FIRST_GOAL: { item: ItemId; amount: number } = { item: 'iron_ore', amount: 5 };
/** Базовое количество предметов в задании по тиру (индекс — тир). */
export const GOAL_BASE_AMOUNT = [10, 10, 8, 5, 3, 1];
/** Рост количества с уровнем: × (1 + GOAL_AMOUNT_GROWTH × (уровень − 1)). */
export const GOAL_AMOUNT_GROWTH = 0.12;
/** Вероятности выбора тира: максимальный доступный, на один ниже, остальное — любой ниже. */
export const GOAL_TIER_TOP_CHANCE = 0.5;
export const GOAL_TIER_PREV_CHANCE = 0.3;

// ---------------------------------------------------------------------------
// Улучшения
// ---------------------------------------------------------------------------

/** Сколько карточек показывается при повышении уровня. */
export const UPGRADE_CHOICES = 4;
/** Эффект одного стака. */
export const UPGRADE_SPEED_STEP = 0.15; // +15% к скорости здания
export const UPGRADE_OUTPUT_STEP = 1; // +1 предмет за цикл
export const UPGRADE_BELT_SPEED_STEP = 0.15; // +15% к скорости лент
export const UPGRADE_BELT_CAPACITY_STEP = 1; // +1 предмет на клетку ленты
export const UPGRADE_XP_STEP = 0.1; // +10% ко всему опыту
/** Веса выпадения карточек. */
export const UPGRADE_WEIGHTS = {
  speed: 3,
  beltSpeed: 3,
  output: 1,
  drillOutput: 1,
  beltCapacity: 2,
  xp: 2,
};

// ---------------------------------------------------------------------------
// Сохранения и обучение
// ---------------------------------------------------------------------------

export const SAVE_KEY = 'factory-game-save';
export const SAVE_VERSION = 1;
/** Автосохранение, сек. */
export const AUTOSAVE_INTERVAL = 10;
/** Сколько секунд висит финальная подсказка обучения. */
export const TUTORIAL_LAST_HINT_TIME = 7;
