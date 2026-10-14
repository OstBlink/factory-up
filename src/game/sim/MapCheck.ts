// Проверка карты (запускается в dev-режиме): препятствия не перекрывают базу и месторождения,
// и от каждого месторождения можно дотянуть ленту до базы (поиск в ширину по свободным клеткам).

import { BASE_SIZE, BASE_X, BASE_Y, DEPOSITS, DEPOSIT_SIZE, OBSTACLES, TUTORIAL_DEPOSIT } from '../balance';
import { portCell } from './Buildings';
import { DX, DY } from './types';
import type { Dir } from './types';
import { TERRAIN_FREE, World } from './World';

const SIDES: Dir[] = [0, 1, 2, 3];

/** Клетки снаружи выходного порта бура на месторождении — для всех 4 поворотов. */
function drillOutputCells(d: { x: number; y: number }): { x: number; y: number }[] {
  return SIDES.map((side) => {
    const p = portCell({ x: d.x, y: d.y, size: DEPOSIT_SIZE }, side);
    return { x: p.x + DX[side], y: p.y + DY[side] };
  });
}

function isFree(world: World, x: number, y: number): boolean {
  return world.inBounds(x, y) && world.terrainAt(x, y) === TERRAIN_FREE
    && world.cellAt(x, y) === null && world.depositAt(x, y) < 0;
}

function touchesBase(world: World, x: number, y: number): boolean {
  return SIDES.some((d) => world.cellAt(x + DX[d], y + DY[d]) === 'base');
}

/** Поиск в ширину: есть ли путь по свободным клеткам от start до клетки рядом с базой. */
function canReachBase(world: World, start: { x: number; y: number }): boolean {
  if (!isFree(world, start.x, start.y)) return false;
  const seen = new Set<number>([start.y * 1000 + start.x]);
  const queue = [start];
  while (queue.length > 0) {
    const c = queue.shift()!;
    if (touchesBase(world, c.x, c.y)) return true;
    for (const d of SIDES) {
      const nx = c.x + DX[d];
      const ny = c.y + DY[d];
      const key = ny * 1000 + nx;
      if (seen.has(key) || !isFree(world, nx, ny)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

export function checkMap(world: World): string[] {
  const warnings: string[] = [];

  // 1. Препятствия не пересекаются с базой, месторождениями и клетками перед выходами буров.
  const reserved = new Set<number>();
  for (const d of DEPOSITS) for (const c of drillOutputCells(d)) reserved.add(c.y * 1000 + c.x);
  OBSTACLES.forEach((o, i) => {
    for (let y = o.y; y < o.y + o.h; y++) {
      for (let x = o.x; x < o.x + o.w; x++) {
        const inBase = x >= BASE_X && x < BASE_X + BASE_SIZE && y >= BASE_Y && y < BASE_Y + BASE_SIZE;
        if (inBase) warnings.push(`Препятствие #${i} перекрывает базу (${x}, ${y})`);
        if (world.depositAt(x, y) >= 0) warnings.push(`Препятствие #${i} перекрывает месторождение (${x}, ${y})`);
        if (reserved.has(y * 1000 + x)) warnings.push(`Препятствие #${i} закрывает выход бура (${x}, ${y})`);
      }
    }
  });

  // 2. От каждого месторождения есть путь до базы хотя бы из одного выхода бура.
  DEPOSITS.forEach((d, i) => {
    if (!drillOutputCells(d).some((c) => canReachBase(world, c))) {
      warnings.push(`Месторождение #${i} (${d.ore}, ${d.x}, ${d.y}): нет пути до базы`);
    }
  });

  // 3. Прямой путь от месторождения обучения (верхнее железо) вниз до базы свободен.
  const t = DEPOSITS[TUTORIAL_DEPOSIT];
  const column = t.x + 1;
  for (let y = t.y + DEPOSIT_SIZE; y < BASE_Y; y++) {
    if (!isFree(world, column, y)) {
      warnings.push(`Прямой путь обучения перекрыт в клетке (${column}, ${y})`);
      break;
    }
  }
  return warnings;
}
