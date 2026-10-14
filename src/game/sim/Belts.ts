// Движение предметов по лентам: сколько места у приёмника, передача предмета в соседнюю клетку,
// сдвиг очереди предметов внутри клетки и расчёт координат предметов для отрисовки.

import { TICKS_PER_SECOND } from '../balance';
import { machineAccepts, addToInput } from './Buildings';
import { mergerRoom } from './Logistics';
import { DX, DY, opposite } from './types';
import type { Belt, Dir, ItemId, MovingItem, Transport } from './types';
import type { World } from './World';

/** Минимальное расстояние между предметами в долях клетки (= 1 / вместимость). */
export function itemSpacing(world: World): number {
  return 1 / world.beltCapacity();
}

/** На сколько сдвигается предмет за один тик (в долях клетки). */
export function stepLength(world: World): number {
  return world.beltSpeed() / TICKS_PER_SECOND;
}

/** Сколько места в очереди: позиция, дальше которой новый предмет встать не может. */
export function laneRoom(world: World, items: MovingItem[]): number {
  if (items.length === 0) return 1;
  return items[items.length - 1].pos - itemSpacing(world);
}

/** Запас на погрешность дробных позиций. */
const ROOM_EPS = 1e-6;

/** Можно ли войти при таком запасе места (см. entryRoom). */
export function canEnter(room: number | null): room is number {
  return room !== null && room > ROOM_EPS;
}

/**
 * Сколько места для предмета, входящего в клетку (x, y) через её сторону side.
 *  null   — приёмника нет или он сейчас не берёт предмет (предмет ждёт у края);
 *  > 0    — можно войти, предмет встанет не дальше этой позиции;
 *  <= 0   — пока нельзя: предмет держится на расстоянии -room от края (очередь на стыке лент).
 * Здания, база и объединитель возвращают 1: у них нет очереди, только «да» или «нет».
 */
export function entryRoom(world: World, x: number, y: number, side: Dir, item: ItemId): number | null {
  const cell = world.cellAt(x, y);
  if (cell === null) return null;
  if (cell === 'base') return 1; // база принимает всё и никогда не блокируется
  switch (cell.kind) {
    case 'belt':
      // Лента принимает сзади и с боков, но не спереди.
      if (side === cell.dir) return null;
      return laneRoom(world, cell.items);
    case 'splitter':
      if (side !== opposite(cell.dir)) return null; // только сзади
      return laneRoom(world, cell.items);
    case 'bridge':
      return laneRoom(world, side === 1 || side === 3 ? cell.h : cell.v);
    case 'merger':
      return mergerRoom(cell, side);
    case 'machine':
      return machineAccepts(cell, x, y, side, item) ? 1 : null;
  }
}

/** Кладёт предмет в клетку (x, y). Вызывать только если canEnter(entryRoom(...)). */
export function insertItem(world: World, x: number, y: number, side: Dir, mi: MovingItem, pos: number): void {
  const cell = world.cellAt(x, y);
  if (cell === null) return;
  if (cell === 'base') {
    world.deliver(mi.item);
    return;
  }
  mi.from = side;
  mi.pos = pos;
  switch (cell.kind) {
    case 'belt':
    case 'splitter':
      cell.items.push(mi);
      break;
    case 'bridge':
      // Предмет проходит мост насквозь: выходит с противоположной стороны.
      mi.out = opposite(side);
      if (side === 1 || side === 3) cell.h.push(mi);
      else cell.v.push(mi);
      break;
    case 'merger':
      mi.pos = 0;
      cell.slots[side] = mi;
      break;
    case 'machine':
      addToInput(cell, mi.item);
      break;
  }
}

/**
 * Сдвигает очередь предметов одной клетки на один тик.
 * exitDir(mi) — куда выходит передний предмет (null — выхода пока нет, ждать у края).
 * Передний предмет переходит в соседнюю клетку, когда доезжает до края и там есть место;
 * остальные едут за ним, не подъезжая ближе минимального интервала.
 * Возвращает направление, куда ушёл предмет (или null), — нужно сплиттеру.
 */
export function advanceLane(
  world: World,
  x: number,
  y: number,
  items: MovingItem[],
  exitDir: (mi: MovingItem) => Dir | null,
): Dir | null {
  const step = stepLength(world);
  const gap = itemSpacing(world);
  let movedTo: Dir | null = null;

  for (let i = 0; i < items.length; i++) {
    const mi = items[i];
    const target = mi.pos + step;

    if (i > 0) {
      // Догоняем предыдущий предмет, но не ближе интервала.
      mi.pos = Math.max(mi.pos, Math.min(target, items[i - 1].pos - gap));
      continue;
    }

    // Передний предмет: смотрим, есть ли место у соседа.
    const d = exitDir(mi);
    if (d === null) {
      mi.pos = Math.min(target, 1);
      continue;
    }
    const nx = x + DX[d];
    const ny = y + DY[d];
    const side = opposite(d);
    const room = entryRoom(world, nx, ny, side, mi.item);

    if (canEnter(room) && target >= 1) {
      // Переход в соседнюю клетку с сохранением «перелёта» через край.
      items.shift();
      insertItem(world, nx, ny, side, mi, Math.min(target - 1, room));
      movedTo = d;
      i = -1; // следующий предмет стал передним — обработать его заново
      continue;
    }

    // Ждём у края. Если впереди на соседней ленте очередь — держим интервал и через стык.
    const limit = room !== null && room < 0 ? 1 + room : 1;
    mi.pos = Math.max(mi.pos, Math.min(target, limit));
  }
  return movedTo;
}

/** Создаёт новый предмет у края клетки (x, y) со стороны side (для выхода зданий). */
export function makeItem(world: World, item: ItemId, x: number, y: number, side: Dir): MovingItem {
  const ex = x + 0.5 + DX[side] * 0.5;
  const ey = y + 0.5 + DY[side] * 0.5;
  return { id: world.newItemId(), item, pos: 0, from: side, out: opposite(side), px: ex, py: ey, rx: ex, ry: ey };
}

// ---------------------------------------------------------------------------
// Координаты предметов для отрисовки (в клетках, центр клетки = x + 0.5)
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ставит rx/ry: точка на отрезке от края стороны a (t=0) до края стороны b (t=1) или центра (b = null). */
function placeBetween(mi: MovingItem, x: number, y: number, a: Dir, b: Dir | null, t: number): void {
  const ax = x + 0.5 + DX[a] * 0.5;
  const ay = y + 0.5 + DY[a] * 0.5;
  const bx = b === null ? x + 0.5 : x + 0.5 + DX[b] * 0.5;
  const by = b === null ? y + 0.5 : y + 0.5 + DY[b] * 0.5;
  mi.rx = lerp(ax, bx, t);
  mi.ry = lerp(ay, by, t);
}

/** Лента: от входной стороны к центру, затем к выходу (на поворотах получается «уголок»). */
function placeOnBelt(b: Belt, mi: MovingItem): void {
  if (mi.pos < 0.5) {
    placeBetween(mi, b.x, b.y, mi.from, null, mi.pos * 2);
  } else {
    const cx = b.x + 0.5;
    const cy = b.y + 0.5;
    const t = (mi.pos - 0.5) * 2;
    mi.rx = lerp(cx, cx + DX[b.dir] * 0.5, t);
    mi.ry = lerp(cy, cy + DY[b.dir] * 0.5, t);
  }
}

/** Пересчитывает координаты всех предметов клетки после тика. */
export function placeItems(t: Transport): void {
  switch (t.kind) {
    case 'belt':
      for (const mi of t.items) placeOnBelt(t, mi);
      break;
    case 'splitter':
      // В сплиттере предмет едет к центру, а там выбирает выход.
      for (const mi of t.items) placeBetween(mi, t.x, t.y, mi.from, null, mi.pos);
      break;
    case 'bridge':
      for (const mi of t.h) placeBetween(mi, t.x, t.y, mi.from, mi.out, mi.pos);
      for (const mi of t.v) placeBetween(mi, t.x, t.y, mi.from, mi.out, mi.pos);
      break;
    case 'merger':
      for (let side = 0; side < 4; side++) {
        const mi = t.slots[side];
        if (mi) placeBetween(mi, t.x, t.y, side as Dir, null, 0.45);
      }
      for (const mi of t.items) {
        const cx = t.x + 0.5;
        const cy = t.y + 0.5;
        mi.rx = lerp(cx, cx + DX[t.dir] * 0.5, mi.pos);
        mi.ry = lerp(cy, cy + DY[t.dir] * 0.5, mi.pos);
      }
      break;
  }
}

/** Вызывает fn для каждого предмета в клетке. */
export function forEachItemIn(t: Transport, fn: (mi: MovingItem) => void): void {
  switch (t.kind) {
    case 'belt':
    case 'splitter':
      t.items.forEach(fn);
      break;
    case 'bridge':
      t.h.forEach(fn);
      t.v.forEach(fn);
      break;
    case 'merger':
      for (const mi of t.slots) if (mi) fn(mi);
      t.items.forEach(fn);
      break;
  }
}
