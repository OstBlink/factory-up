// Сохранение и загрузка: состояние мира целиком сериализуется в JSON и хранится в localStorage.
// Любая ошибка (нет доступа, битые данные, другая версия) — просто новая игра, без падения.

import { SAVE_KEY, SAVE_VERSION } from '../balance';
import { rollUpgradeChoices } from './Progression';
import { World } from './World';
import type { Entity, Goal } from './types';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface SaveData {
  version: number;
  level: number;
  xp: number;
  upgrades: Record<string, number>;
  pendingLevelUps: number;
  upgradeChoices: string[] | null;
  goal: Goal;
  tutorial: number;
  nextId: number;
  nextItemId: number;
  entities: Entity[];
  camera: CameraState | null;
}

export function saveGame(world: World, camera: CameraState | null): void {
  const data: SaveData = {
    version: SAVE_VERSION,
    level: world.level,
    xp: world.xp,
    upgrades: world.upgrades,
    pendingLevelUps: world.pendingLevelUps,
    upgradeChoices: world.upgradeChoices,
    goal: world.goal,
    tutorial: world.tutorial,
    nextId: world.nextId,
    nextItemId: world.nextItemId,
    entities: [...world.entities.values()],
    camera,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Не удалось сохранить игру', err);
  }
}

export function loadGame(): { world: World; camera: CameraState | null } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION || !Array.isArray(data.entities) || !data.goal) return null;

    const world = new World();
    world.level = data.level;
    world.xp = data.xp;
    world.upgrades = data.upgrades ?? {};
    world.pendingLevelUps = data.pendingLevelUps ?? 0;
    world.upgradeChoices = data.upgradeChoices ?? null;
    world.goal = data.goal;
    world.tutorial = data.tutorial ?? 0;
    world.nextId = data.nextId;
    world.nextItemId = data.nextItemId;
    for (const e of data.entities) world.addEntity(e);
    if (world.pendingLevelUps > 0 && !world.upgradeChoices) world.upgradeChoices = rollUpgradeChoices(world);
    return { world, camera: data.camera ?? null };
  } catch (err) {
    console.warn('Сохранение повреждено, начинаем новую игру', err);
    return null;
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // нет доступа к хранилищу — нечего удалять
  }
}
