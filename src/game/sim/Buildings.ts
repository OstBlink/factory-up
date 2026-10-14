// Производственные здания: порты (входы/выход), приём предметов, цикл производства, выталкивание продукции.

import { BUFFER_MAX, BUILDINGS, DRILL_BASE_OUTPUT, DRILL_CYCLE_TIME, RECIPES, TICKS_PER_SECOND } from '../balance';
import type { Recipe } from '../balance';
import { canEnter, entryRoom, insertItem, makeItem, stepLength } from './Belts';
import { outputBonus, speedMultiplier } from './Progression';
import { DX, DY, opposite } from './types';
import type { Dir, ItemId, Machine, MachineType } from './types';
import type { World } from './World';

export function recipesFor(type: MachineType): Recipe[] {
  return RECIPES.filter((r) => r.building === type);
}

export function getRecipe(id: string | null): Recipe | null {
  if (id === null) return null;
  return RECIPES.find((r) => r.id === id) ?? null;
}

/**
 * Клетка порта на стороне side: всегда центр этой стороны здания.
 * Передняя сторона (m.dir) — выход, остальные три — входы.
 */
export function portCell(m: { x: number; y: number; size: number }, side: Dir): { x: number; y: number } {
  const half = (m.size - 1) / 2;
  switch (side) {
    case 0: return { x: m.x + half, y: m.y };
    case 1: return { x: m.x + m.size - 1, y: m.y + half };
    case 2: return { x: m.x + half, y: m.y + m.size - 1 };
    case 3: return { x: m.x, y: m.y + half };
  }
}

/** Клетка снаружи выходного порта — туда здание выталкивает продукцию. */
export function outputTarget(m: Machine): { x: number; y: number } {
  const p = portCell(m, m.dir);
  return { x: p.x + DX[m.dir], y: p.y + DY[m.dir] };
}

/** Нужен ли предмет зданию: для текущего рецепта (выбор кликом) или для любого своего рецепта (авто). */
export function needsItem(m: Machine, item: ItemId): boolean {
  const mode = BUILDINGS[m.type].recipeMode;
  if (mode === 'select') {
    const r = getRecipe(m.recipe);
    return r !== null && r.inputs.some((i) => i.item === item);
  }
  if (mode === 'auto') {
    return recipesFor(m.type).some((r) => r.inputs.some((i) => i.item === item));
  }
  return false; // бур ничего не принимает
}

/** Примет ли здание предмет, пришедший в клетку (x, y) через сторону side. */
export function machineAccepts(m: Machine, x: number, y: number, side: Dir, item: ItemId): boolean {
  if (m.type === 'drill') return false;
  if (side === m.dir) return false; // передняя сторона — это выход
  const port = portCell(m, side);
  if (port.x !== x || port.y !== y) return false; // принимаем только через центр стороны
  if (!needsItem(m, item)) return false;
  return (m.inBuf[item] ?? 0) < BUFFER_MAX;
}

export function addToInput(m: Machine, item: ItemId): void {
  m.inBuf[item] = (m.inBuf[item] ?? 0) + 1;
}

function hasInputs(m: Machine, r: Recipe): boolean {
  return r.inputs.every((i) => (m.inBuf[i.item] ?? 0) >= i.count);
}

function consumeInputs(m: Machine, r: Recipe): void {
  for (const i of r.inputs) m.inBuf[i.item] = (m.inBuf[i.item] ?? 0) - i.count;
}

/** Базовое время текущего цикла, сек. */
export function cycleTime(m: Machine): number {
  if (m.type === 'drill') return DRILL_CYCLE_TIME;
  return getRecipe(m.cycleRecipe)?.time ?? 1;
}

/** Пытается начать цикл: хватает ли ингредиентов и есть ли место в выходном буфере. */
function tryStartCycle(m: Machine): void {
  if (m.outBuf.length >= BUFFER_MAX) return;

  if (m.type === 'drill') {
    m.busy = m.ore !== null;
    return;
  }

  const mode = BUILDINGS[m.type].recipeMode;
  if (mode === 'select') {
    const r = getRecipe(m.recipe);
    if (r && hasInputs(m, r)) {
      consumeInputs(m, r);
      m.cycleRecipe = r.id;
      m.busy = true;
    }
    return;
  }

  // Авто-рецепт: перебираем рецепты по кругу, начиная со следующего после прошлого,
  // чтобы при смешанном входе ни один рецепт не простаивал.
  const list = recipesFor(m.type);
  const last = list.findIndex((r) => r.id === m.cycleRecipe);
  for (let k = 1; k <= list.length; k++) {
    const r = list[(last + k) % list.length];
    if (hasInputs(m, r)) {
      consumeInputs(m, r);
      m.cycleRecipe = r.id;
      m.busy = true;
      return;
    }
  }
}

/** Завершение цикла: продукция в выходной буфер. Выход = базовый + бонус улучшений. */
function finishCycle(world: World, m: Machine): void {
  m.busy = false;
  m.progress = 0;
  let item: ItemId | null;
  let count: number;
  if (m.type === 'drill') {
    item = m.ore;
    count = DRILL_BASE_OUTPUT;
  } else {
    const r = getRecipe(m.cycleRecipe);
    item = r ? r.output : null;
    count = r ? r.outCount : 0;
  }
  if (item === null) return;
  count += outputBonus(world, m.type);
  for (let i = 0; i < count; i++) m.outBuf.push(item);
}

/** Выталкивает один готовый предмет через выходной порт, если снаружи его примут. */
function pushOutput(world: World, m: Machine): void {
  if (m.outBuf.length === 0) return;
  const item = m.outBuf[0];
  const t = outputTarget(m);
  const side = opposite(m.dir);
  const room = entryRoom(world, t.x, t.y, side, item);
  if (!canEnter(room)) return;
  m.outBuf.shift();
  // Предмет мог выйти в любой момент тика, поэтому ставим его не дальше одного шага от края:
  // так интервал между предметами на ленте получается ровным и пропускная способность не теряется.
  insertItem(world, t.x, t.y, side, makeItem(world, item, t.x, t.y, side), Math.min(room, stepLength(world)));
}

/** Один тик здания. Длительность цикла = время рецепта / множитель скорости. */
export function updateMachine(world: World, m: Machine): void {
  if (m.busy) {
    m.progress += speedMultiplier(world, m.type) / (cycleTime(m) * TICKS_PER_SECOND);
    if (m.progress >= 1) finishCycle(world, m);
  }
  if (!m.busy) tryStartCycle(m);
  pushOutput(world, m);
}
