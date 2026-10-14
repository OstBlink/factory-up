// Логистические блоки 1×1: объединитель, сплиттер и мост (перекрёсток).

import { advanceLane, canEnter, entryRoom, laneRoom, stepLength } from './Belts';
import { DX, DY, opposite, turnLeft, turnRight } from './types';
import type { Bridge, Dir, Merger, Splitter } from './types';
import type { World } from './World';

// ---------------------------------------------------------------------------
// Объединитель: входы сзади, слева и справа, выход вперёд.
// У каждого входа свой слот на 1 предмет; блок забирает из слотов по кругу,
// поэтому ни одна входящая лента не «голодает».
// ---------------------------------------------------------------------------

/** Входные стороны объединителя по порядку обслуживания: сзади, слева, справа. */
function mergerInputs(m: Merger): Dir[] {
  return [opposite(m.dir), turnLeft(m.dir), turnRight(m.dir)];
}

/** Место для предмета, входящего в объединитель со стороны side. */
export function mergerRoom(m: Merger, side: Dir): number | null {
  if (side === m.dir) return null; // спереди не принимает
  return m.slots[side] === null ? 1 : null;
}

export function updateMerger(world: World, m: Merger): void {
  advanceLane(world, m.x, m.y, m.items, () => m.dir);

  // Если на выходной дорожке есть место — забираем предмет из следующего по кругу слота.
  const room = laneRoom(world, m.items);
  if (!canEnter(room)) return;
  const inputs = mergerInputs(m);
  for (let k = 0; k < inputs.length; k++) {
    const index = (m.next + k) % inputs.length;
    const side = inputs[index];
    const mi = m.slots[side];
    if (!mi) continue;
    m.slots[side] = null;
    mi.pos = Math.min(room, stepLength(world));
    m.items.push(mi);
    m.next = (index + 1) % inputs.length;
    break;
  }
}

// ---------------------------------------------------------------------------
// Сплиттер: вход сзади, выдаёт по кругу налево, вперёд и направо,
// пропуская выходы, где нет приёмника или нет места.
// ---------------------------------------------------------------------------

export function updateSplitter(world: World, s: Splitter): void {
  const outs: Dir[] = [turnLeft(s.dir), s.dir, turnRight(s.dir)];

  const moved = advanceLane(world, s.x, s.y, s.items, (mi) => {
    // Перебираем выходы начиная со следующего по кругу; берём первый, где есть место.
    for (let k = 0; k < outs.length; k++) {
      const d = outs[(s.next + k) % outs.length];
      const room = entryRoom(world, s.x + DX[d], s.y + DY[d], opposite(d), mi.item);
      if (canEnter(room)) return d;
    }
    return null;
  });

  if (moved !== null) {
    s.next = (outs.indexOf(moved) + 1) % outs.length;
  }
}

// ---------------------------------------------------------------------------
// Мост: предмет выходит с противоположной стороны. Горизонтальный и вертикальный
// потоки независимы (разные очереди), поэтому две ленты могут пересечься.
// ---------------------------------------------------------------------------

export function updateBridge(world: World, b: Bridge): void {
  advanceLane(world, b.x, b.y, b.h, (mi) => mi.out);
  advanceLane(world, b.x, b.y, b.v, (mi) => mi.out);
}
