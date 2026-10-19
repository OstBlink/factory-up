// Путь ленты при протяжке мышью: Г-образный, а если он задевает препятствие или постройку —
// второй вариант Г или обход по свободным клеткам с наименьшим числом поворотов.

import { BELT_ROUTE_TURN_COST, MAP_H, MAP_W } from '../balance';
import { DX, DY } from './types';
import type { Dir } from './types';
import type { World } from './World';

export interface PathCell {
  x: number;
  y: number;
  dir: Dir;
}

const DIRS: Dir[] = [0, 1, 2, 3];

/**
 * Г-образный путь от (sx, sy) до (ex, ey). horizontalFirst — сначала по горизонтали, потом поворот.
 * Направление каждой клетки — по ходу протяжки; угловая клетка уже смотрит во второй отрезок.
 */
export function lPath(sx: number, sy: number, ex: number, ey: number, horizontalFirst: boolean): PathCell[] {
  const dx = ex - sx;
  const dy = ey - sy;
  const hDir: Dir = dx > 0 ? 1 : 3;
  const vDir: Dir = dy > 0 ? 2 : 0;
  const cells: PathCell[] = [];

  if (horizontalFirst) {
    for (let x = sx; x !== ex; x += Math.sign(dx)) cells.push({ x, y: sy, dir: hDir });
    for (let y = sy; ; y += Math.sign(dy)) {
      cells.push({ x: ex, y, dir: dy === 0 ? hDir : vDir });
      if (y === ey) break;
    }
  } else {
    for (let y = sy; y !== ey; y += Math.sign(dy)) cells.push({ x: sx, y, dir: vDir });
    for (let x = sx; ; x += Math.sign(dx)) {
      cells.push({ x, y: ey, dir: dx === 0 ? vDir : hDir });
      if (x === ex) break;
    }
  }
  return cells;
}

/** Можно ли положить ленту в клетку: место свободно или там уже лента (у неё сменится направление). */
export function canLayBelt(world: World, x: number, y: number): boolean {
  const cell = world.cellAt(x, y);
  if (cell !== null && cell !== 'base' && cell.kind === 'belt') return true;
  return world.checkPlace('belt', x, y).ok;
}

/**
 * Путь, который игра предлагает при протяжке (его же и строит).
 * 1) Г по длинной оси; 2) другой вариант Г; 3) обход препятствий; 4) если обхода нет — Г (покажется красным).
 * Первая и последняя клетки не проверяются: игрок может тянуть ленту прямо в базу или здание.
 */
export function planBeltRoute(world: World, sx: number, sy: number, ex: number, ey: number, fallbackDir: Dir): PathCell[] {
  if (sx === ex && sy === ey) return [{ x: sx, y: sy, dir: fallbackDir }];

  const longFirst = Math.abs(ex - sx) >= Math.abs(ey - sy);
  const first = lPath(sx, sy, ex, ey, longFirst);
  if (middleIsFree(world, first)) return first;
  const second = lPath(sx, sy, ex, ey, !longFirst);
  if (middleIsFree(world, second)) return second;
  return findDetour(world, sx, sy, ex, ey) ?? first;
}

/** Все клетки пути, кроме первой и последней, можно занять лентой. */
function middleIsFree(world: World, path: PathCell[]): boolean {
  for (let i = 1; i < path.length - 1; i++) {
    if (!canLayBelt(world, path[i].x, path[i].y)) return false;
  }
  return true;
}

/**
 * Обход: поиск кратчайшего пути (алгоритм Дейкстры с «корзинами») по свободным клеткам.
 * Состояние — клетка + направление, с которым в неё пришли; шаг стоит 1, поворот — ещё BELT_ROUTE_TURN_COST,
 * поэтому путь получается с наименьшим числом изгибов, а не «лесенкой».
 * Существующие ленты по дороге не трогаем (обходим), чтобы не испортить чужую линию.
 */
function findDetour(world: World, sx: number, sy: number, ex: number, ey: number): PathCell[] | null {
  const passable = (x: number, y: number) =>
    (x === ex && y === ey) || (world.inBounds(x, y) && world.checkPlace('belt', x, y).ok);

  const states = MAP_W * MAP_H * 4;
  const dist = new Float64Array(states).fill(Infinity);
  const prev = new Int32Array(states).fill(-1);
  const buckets: number[][] = [];
  const push = (state: number, cost: number) => {
    dist[state] = cost;
    (buckets[cost] ??= []).push(state);
  };

  // Из стартовой клетки можно пойти в любую сторону без штрафа за поворот.
  const start = sy * MAP_W + sx;
  for (const d of DIRS) push(start * 4 + d, 0);

  let found = -1;
  for (let cost = 0; cost < buckets.length && found < 0; cost++) {
    const bucket = buckets[cost];
    if (!bucket) continue;
    for (const state of bucket) {
      if (dist[state] !== cost) continue; // уже нашли путь дешевле
      const cellIndex = Math.floor(state / 4);
      const d = state % 4;
      const x = cellIndex % MAP_W;
      const y = Math.floor(cellIndex / MAP_W);
      if (x === ex && y === ey) {
        found = state;
        break;
      }
      for (const nd of DIRS) {
        const nx = x + DX[nd];
        const ny = y + DY[nd];
        if (!passable(nx, ny)) continue;
        const next = (ny * MAP_W + nx) * 4 + nd;
        const nextCost = cost + 1 + (nd !== d && cellIndex !== start ? BELT_ROUTE_TURN_COST : 0);
        if (nextCost < dist[next]) {
          prev[next] = state;
          push(next, nextCost);
        }
      }
    }
  }
  if (found < 0) return null;

  // Восстанавливаем клетки от конца к началу.
  const cells: { x: number; y: number }[] = [];
  for (let s = found; s >= 0; s = prev[s]) {
    const cellIndex = Math.floor(s / 4);
    cells.push({ x: cellIndex % MAP_W, y: Math.floor(cellIndex / MAP_W) });
  }
  cells.reverse();

  // Направление клетки — в сторону следующей; последняя продолжает направление последнего шага.
  return cells.map((c, i) => {
    const a = i < cells.length - 1 ? c : cells[i - 1];
    const b = i < cells.length - 1 ? cells[i + 1] : c;
    return { x: c.x, y: c.y, dir: stepDir(b.x - a.x, b.y - a.y) };
  });
}

function stepDir(dx: number, dy: number): Dir {
  if (dx > 0) return 1;
  if (dx < 0) return 3;
  return dy > 0 ? 2 : 0;
}
