// Прогрессия: опыт за предметы, кривая уровней, открытие зданий по уровню и карточки улучшений.

import {
  BELT_CAPACITY, BELT_SPEED, BUILDINGS, BUILD_MENU_ORDER, ITEMS, TIER_XP, UPGRADE_BELT_CAPACITY_STEP,
  UPGRADE_BELT_SPEED_STEP, UPGRADE_CHOICES, UPGRADE_OUTPUT_STEP, UPGRADE_SPEED_STEP, UPGRADE_WEIGHTS,
  PHASE2_LEVEL, PHASE2_SPEED_MULT, UPGRADE_XP_STEP, XP_BASE, XP_GROWTH,
} from '../balance';
import { MACHINE_TYPES } from './types';
import type { BuildingType, ItemId, MachineType } from './types';
import type { World } from './World';

// ---------------------------------------------------------------------------
// Опыт и уровни
// ---------------------------------------------------------------------------

/** Опыт, нужный для перехода с уровня level на следующий. */
export function xpToNext(level: number): number {
  return Math.round(XP_BASE * Math.pow(XP_GROWTH, level - 1));
}

/** Опыт за один предмет (зависит только от тира). */
export function itemXp(item: ItemId): number {
  return TIER_XP[ITEMS[item].tier];
}

/** Множитель всего опыта: 1 + бонус из улучшений. */
export function xpMultiplier(world: World): number {
  return 1 + UPGRADE_XP_STEP * stacks(world, 'xp');
}

/** Начисляет опыт (с учётом множителя) и повышает уровень, если опыта хватает. */
export function addXp(world: World, baseAmount: number): void {
  const amount = baseAmount * xpMultiplier(world);
  world.xp += amount;
  world.events.push({ type: 'xp', amount });

  // За одно начисление можно получить несколько уровней — карточки покажутся по очереди.
  while (world.xp >= xpToNext(world.level)) {
    world.xp -= xpToNext(world.level);
    world.level += 1;
    world.pendingLevelUps += 1;
    world.events.push({ type: 'levelUp', level: world.level });
    const opened = unlockedAtLevel(world.level);
    if (opened.length > 0) world.events.push({ type: 'unlock', types: opened });
  }
  if (world.pendingLevelUps > 0 && world.upgradeChoices === null) {
    world.upgradeChoices = rollUpgradeChoices(world);
  }
}

// ---------------------------------------------------------------------------
// Фазы игры: фаза 2 начинается, когда игрок достигает уровня PHASE2_LEVEL
// ---------------------------------------------------------------------------

/** Ускорение от фазы: в фазе 2 всё работает в PHASE2_SPEED_MULT раз быстрее. */
export function phaseSpeedMultiplier(world: World): number {
  return world.phase >= 2 ? PHASE2_SPEED_MULT : 1;
}

/**
 * Переход в фазу 2 при достижении уровня PHASE2_LEVEL. Сообщает сценам событием 'phase'.
 * Вызывается из тика мира, поэтому срабатывает сразу после выбора карточки улучшения
 * (пока карточки на экране, мир на паузе) — надпись не накладывается на карточки.
 */
export function checkPhase(world: World): void {
  if (world.phase === 1 && world.level >= PHASE2_LEVEL) {
    world.phase = 2;
    world.events.push({ type: 'phase', phase: 2 });
  }
}

// ---------------------------------------------------------------------------
// Открытия по уровню (уровни открытия лежат в BUILDINGS[...].unlockLevel)
// ---------------------------------------------------------------------------

export function isUnlocked(world: World, type: BuildingType): boolean {
  return world.level >= BUILDINGS[type].unlockLevel;
}

/** Здания, которые открываются ровно на этом уровне. */
export function unlockedAtLevel(level: number): BuildingType[] {
  return BUILD_MENU_ORDER.filter((t) => BUILDINGS[t].unlockLevel === level);
}

// ---------------------------------------------------------------------------
// Улучшения. Идентификаторы: 'speed:<здание>', 'output:<здание>', 'beltSpeed', 'beltCapacity', 'xp'.
// world.upgrades хранит, сколько раз взято каждое улучшение (стаки).
// ---------------------------------------------------------------------------

function stacks(world: World, id: string): number {
  return world.upgrades[id] ?? 0;
}

/** Скорость здания от улучшений: две карточки по +15% дают ×1.30. */
function upgradeSpeed(world: World, type: MachineType): number {
  return 1 + UPGRADE_SPEED_STEP * stacks(world, `speed:${type}`);
}

/** Итоговый множитель скорости здания: улучшения × ускорение фазы. */
export function speedMultiplier(world: World, type: MachineType): number {
  return upgradeSpeed(world, type) * phaseSpeedMultiplier(world);
}

/** Сколько предметов добавляется к выходу здания за цикл. */
export function outputBonus(world: World, type: MachineType): number {
  return UPGRADE_OUTPUT_STEP * stacks(world, `output:${type}`);
}

export function beltSpeed(world: World): number {
  return BELT_SPEED * (1 + UPGRADE_BELT_SPEED_STEP * stacks(world, 'beltSpeed')) * phaseSpeedMultiplier(world);
}

export function beltCapacity(world: World): number {
  return BELT_CAPACITY + UPGRADE_BELT_CAPACITY_STEP * stacks(world, 'beltCapacity');
}

/** Все улучшения, применимые сейчас (только для открытых зданий), с весами выпадения. */
function availableUpgrades(world: World): { id: string; weight: number }[] {
  const list: { id: string; weight: number }[] = [];
  for (const t of MACHINE_TYPES) {
    if (!isUnlocked(world, t)) continue;
    list.push({ id: `speed:${t}`, weight: UPGRADE_WEIGHTS.speed });
    list.push({ id: `output:${t}`, weight: t === 'drill' ? UPGRADE_WEIGHTS.drillOutput : UPGRADE_WEIGHTS.output });
  }
  list.push({ id: 'beltSpeed', weight: UPGRADE_WEIGHTS.beltSpeed });
  list.push({ id: 'beltCapacity', weight: UPGRADE_WEIGHTS.beltCapacity });
  list.push({ id: 'xp', weight: UPGRADE_WEIGHTS.xp });
  return list;
}

/** Случайные уникальные карточки с учётом весов. */
export function rollUpgradeChoices(world: World): string[] {
  const pool = availableUpgrades(world);
  const result: string[] = [];
  while (result.length < UPGRADE_CHOICES && pool.length > 0) {
    const total = pool.reduce((sum, u) => sum + u.weight, 0);
    let r = Math.random() * total;
    let index = 0;
    while (index < pool.length - 1 && r >= pool[index].weight) {
      r -= pool[index].weight;
      index++;
    }
    result.push(pool[index].id);
    pool.splice(index, 1);
  }
  return result;
}

export function applyUpgrade(world: World, id: string): void {
  world.upgrades[id] = stacks(world, id) + 1;
}

/** Текст карточки: название, эффект и «текущее → новое». */
export function describeUpgrade(world: World, id: string): { title: string; effect: string; change: string } {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const [kind, target] = id.split(':');
  const type = target as MachineType;

  if (kind === 'speed') {
    const now = upgradeSpeed(world, type); // на карточке — только вклад улучшений, без фазы
    const name = BUILDINGS[type].name;
    return {
      title: `Скорость: ${name}`,
      effect: `+${pct(UPGRADE_SPEED_STEP)} к скорости работы`,
      change: `${name}: ${pct(now)} → ${pct(now + UPGRADE_SPEED_STEP)}`,
    };
  }
  if (kind === 'output' && type === 'drill') {
    const now = 1 + outputBonus(world, 'drill');
    return {
      title: 'Добыча бура',
      effect: `+${UPGRADE_OUTPUT_STEP} руда за цикл`,
      change: `Руды за цикл: ${now} → ${now + UPGRADE_OUTPUT_STEP}`,
    };
  }
  if (kind === 'output') {
    const now = outputBonus(world, type);
    return {
      title: `Выход: ${BUILDINGS[type].name}`,
      effect: `+${UPGRADE_OUTPUT_STEP} предмет за цикл`,
      change: `Бонус к выходу: +${now} → +${now + UPGRADE_OUTPUT_STEP}`,
    };
  }
  if (kind === 'beltSpeed') {
    const now = 1 + UPGRADE_BELT_SPEED_STEP * stacks(world, 'beltSpeed');
    return {
      title: 'Скорость конвейеров',
      effect: `+${pct(UPGRADE_BELT_SPEED_STEP)} к скорости лент`,
      change: `Конвейеры: ${pct(now)} → ${pct(now + UPGRADE_BELT_SPEED_STEP)}`,
    };
  }
  if (kind === 'beltCapacity') {
    const now = beltCapacity(world);
    return {
      title: 'Вместимость конвейеров',
      effect: `+${UPGRADE_BELT_CAPACITY_STEP} предмет на клетку`,
      change: `Предметов на клетке: ${now} → ${now + UPGRADE_BELT_CAPACITY_STEP}`,
    };
  }
  const now = xpMultiplier(world);
  return {
    title: 'Опыт',
    effect: `+${pct(UPGRADE_XP_STEP)} ко всему опыту`,
    change: `Опыт: ${pct(now)} → ${pct(now + UPGRADE_XP_STEP)}`,
  };
}
