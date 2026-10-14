// Задания базы: первое задание, генерация следующих из доступных предметов и учёт доставок.

import {
  DEPOSITS, FIRST_GOAL, GOAL_AMOUNT_GROWTH, GOAL_BASE_AMOUNT, GOAL_BONUS_MULT, GOAL_TIER_PREV_CHANCE,
  GOAL_TIER_TOP_CHANCE, ITEMS, RECIPES,
} from '../balance';
import { addXp, isUnlocked, itemXp, xpMultiplier } from './Progression';
import type { Goal, ItemId } from './types';
import type { World } from './World';

export function firstGoal(): Goal {
  return { item: FIRST_GOAL.item, amount: FIRST_GOAL.amount, delivered: 0 };
}

/**
 * Предметы, которые можно произвести открытыми зданиями:
 * руда с месторождений (если открыт бур) плюс всё, что получается рецептами из уже доступного.
 */
export function producibleItems(world: World): ItemId[] {
  const can = new Set<ItemId>();
  if (isUnlocked(world, 'drill')) for (const d of DEPOSITS) can.add(d.ore);

  let changed = true;
  while (changed) {
    changed = false;
    for (const r of RECIPES) {
      if (can.has(r.output) || !isUnlocked(world, r.building)) continue;
      if (r.inputs.every((i) => can.has(i.item))) {
        can.add(r.output);
        changed = true;
      }
    }
  }
  return [...can];
}

/** Выбор тира: 50% — максимальный доступный, 30% — на один ниже, 20% — любой ниже. */
function rollTier(maxTier: number): number {
  const r = Math.random();
  if (maxTier === 0 || r < GOAL_TIER_TOP_CHANCE) return maxTier;
  if (r < GOAL_TIER_TOP_CHANCE + GOAL_TIER_PREV_CHANCE) return maxTier - 1;
  return Math.floor(Math.random() * maxTier);
}

/** Количество: round(baseAmount[тир] × (1 + рост × (уровень − 1))). */
export function goalAmount(tier: number, level: number): number {
  return Math.max(1, Math.round(GOAL_BASE_AMOUNT[tier] * (1 + GOAL_AMOUNT_GROWTH * (level - 1))));
}

export function nextGoal(world: World): Goal {
  const items = producibleItems(world);
  const maxTier = Math.max(...items.map((i) => ITEMS[i].tier));
  const tier = rollTier(maxTier);

  // Один и тот же предмет не выпадает два раза подряд.
  let candidates = items.filter((i) => ITEMS[i].tier === tier && i !== world.goal.item);
  if (candidates.length === 0) candidates = items.filter((i) => i !== world.goal.item);
  if (candidates.length === 0) candidates = items;

  const item = candidates[Math.floor(Math.random() * candidates.length)];
  const t = ITEMS[item].tier;
  return { item, amount: goalAmount(t, world.level), delivered: 0 };
}

/** Учёт доставки предмета на базу: опыт за предмет и прогресс задания. */
export function countDelivery(world: World, item: ItemId): void {
  addXp(world, itemXp(item));

  const goal = world.goal;
  if (item !== goal.item) return;
  goal.delivered += 1;
  if (goal.delivered < goal.amount) return;

  // Задание выполнено: бонус опыта и сразу новое задание.
  const bonus = GOAL_BONUS_MULT * goal.amount * itemXp(item);
  world.events.push({ type: 'goalDone', item, bonus: bonus * xpMultiplier(world) });
  addXp(world, bonus);
  world.goal = nextGoal(world);
}
