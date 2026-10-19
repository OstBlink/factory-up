// Состояние мира и команды игрока: карта, здания, ленты, опыт, задание.
// update() — один тик симуляции с фиксированным шагом (TICKS_PER_SECOND раз в секунду).

import {
  BASE_SIZE, BASE_X, BASE_Y, BUILDINGS, DEPOSITS, DEPOSIT_SIZE, MAP_H, MAP_W, OBSTACLES, TICKS_PER_SECOND,
} from '../balance';
import { advanceLane, forEachItemIn, placeItems } from './Belts';
import { getRecipe, outputTarget, updateMachine } from './Buildings';
import { countDelivery, firstGoal } from './Goals';
import { updateBridge, updateMerger, updateSplitter } from './Logistics';
import {
  applyUpgrade, beltCapacity, beltSpeed, checkPhase, isUnlocked, rollUpgradeChoices,
} from './Progression';
import { DX, DY, isMachineType, opposite, turnLeft, turnRight } from './types';
import type {
  Belt, BuildingType, Cell, Dir, Entity, GameEvent, Goal, ItemId, MovingItem, PlaceCheck,
} from './types';

/** Тип клетки рельефа. */
export const TERRAIN_FREE = 0;
export const TERRAIN_ROCK = 1;
export const TERRAIN_WATER = 2;

export class World {
  // --- прогресс игрока ---
  level = 1;
  xp = 0;
  /** Сколько раз взято каждое улучшение. */
  upgrades: Record<string, number> = {};
  /** Сколько выборов улучшений ещё не сделано (пока > 0, симуляция на паузе). */
  pendingLevelUps = 0;
  upgradeChoices: string[] | null = null;
  goal: Goal = firstGoal();
  /** Шаг обучения: 0 — поставь бур, 1 — протяни ленту, 2 — финальная подсказка, 3 — пройдено. */
  tutorial = 0;
  /** Игровое время в секундах: растёт только во время тиков, поэтому пауза его не двигает. */
  playTime = 0;
  /** Текущая фаза игры (1, затем 2 — см. checkPhase). */
  phase = 1;

  // --- карта ---
  readonly terrain = new Uint8Array(MAP_W * MAP_H);
  /** Индекс месторождения в клетке или -1. */
  readonly deposit = new Int8Array(MAP_W * MAP_H).fill(-1);
  readonly cells: Cell[] = new Array<Cell>(MAP_W * MAP_H).fill(null);
  readonly entities = new Map<number, Entity>();

  /** События для сцен (сцена забирает и очищает). */
  events: GameEvent[] = [];
  /** Растёт при любой постройке/удалении — так сцена узнаёт, что пора обновить картинку. */
  version = 0;

  nextId = 1;
  nextItemId = 1;
  /** Порядок обновления: сначала то, что ниже по течению, чтобы освободившееся место сразу занималось. */
  private order: Entity[] = [];
  private orderDirty = true;

  constructor() {
    for (const o of OBSTACLES) {
      const value = o.type === 'rock' ? TERRAIN_ROCK : TERRAIN_WATER;
      for (let y = o.y; y < o.y + o.h; y++) {
        for (let x = o.x; x < o.x + o.w; x++) {
          if (this.inBounds(x, y)) this.terrain[y * MAP_W + x] = value;
        }
      }
    }
    DEPOSITS.forEach((d, index) => {
      for (let y = d.y; y < d.y + DEPOSIT_SIZE; y++) {
        for (let x = d.x; x < d.x + DEPOSIT_SIZE; x++) this.deposit[y * MAP_W + x] = index;
      }
    });
    for (let y = BASE_Y; y < BASE_Y + BASE_SIZE; y++) {
      for (let x = BASE_X; x < BASE_X + BASE_SIZE; x++) this.cells[y * MAP_W + x] = 'base';
    }
  }

  // ---------------------------------------------------------------------------
  // Чтение состояния
  // ---------------------------------------------------------------------------

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  }

  cellAt(x: number, y: number): Cell {
    if (!this.inBounds(x, y)) return null;
    return this.cells[y * MAP_W + x];
  }

  terrainAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.terrain[y * MAP_W + x] : TERRAIN_ROCK;
  }

  depositAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.deposit[y * MAP_W + x] : -1;
  }

  beltSpeed(): number {
    return beltSpeed(this);
  }

  beltCapacity(): number {
    return beltCapacity(this);
  }

  newItemId(): number {
    return this.nextItemId++;
  }

  isPaused(): boolean {
    return this.pendingLevelUps > 0;
  }

  // ---------------------------------------------------------------------------
  // Тик симуляции
  // ---------------------------------------------------------------------------

  update(): void {
    if (this.isPaused()) return;
    this.playTime += 1 / TICKS_PER_SECOND;
    checkPhase(this);
    if (this.orderDirty) this.rebuildOrder();

    // Запоминаем, где предметы были до тика, — рендер плавно ведёт их к новым позициям.
    for (const e of this.order) {
      if (e.kind === 'machine') continue;
      forEachItemIn(e, (mi) => {
        mi.px = mi.rx;
        mi.py = mi.ry;
      });
    }

    for (const e of this.order) {
      switch (e.kind) {
        case 'machine':
          updateMachine(this, e);
          break;
        case 'belt':
          updateBelt(this, e);
          break;
        case 'merger':
          updateMerger(this, e);
          break;
        case 'splitter':
          updateSplitter(this, e);
          break;
        case 'bridge':
          updateBridge(this, e);
          break;
      }
    }

    for (const e of this.order) {
      if (e.kind !== 'machine') placeItems(e);
    }
  }

  /** Предмет пришёл на базу. */
  deliver(item: ItemId): void {
    countDelivery(this, item);
    if (this.tutorial === 1) this.setTutorial(2);
  }

  setTutorial(step: number): void {
    if (step <= this.tutorial) return;
    this.tutorial = step;
    this.events.push({ type: 'tutorial', step });
  }

  // ---------------------------------------------------------------------------
  // Команды игрока
  // ---------------------------------------------------------------------------

  /** Можно ли поставить здание type с левым верхним углом (x, y). */
  checkPlace(type: BuildingType, x: number, y: number): PlaceCheck {
    const def = BUILDINGS[type];
    if (!isUnlocked(this, type)) return { ok: false, reason: `Откроется на уровне ${def.unlockLevel}` };

    for (let cy = y; cy < y + def.size; cy++) {
      for (let cx = x; cx < x + def.size; cx++) {
        if (!this.inBounds(cx, cy)) return { ok: false, reason: 'За краем карты' };
        const terrain = this.terrainAt(cx, cy);
        if (terrain === TERRAIN_ROCK) return { ok: false, reason: 'Здесь скалы' };
        if (terrain === TERRAIN_WATER) return { ok: false, reason: 'Здесь вода' };
        const cell = this.cellAt(cx, cy);
        if (cell === 'base') return { ok: false, reason: 'Здесь база' };
        if (cell !== null) return { ok: false, reason: 'Место занято' };
        if (type !== 'drill' && def.size > 1 && this.depositAt(cx, cy) >= 0) {
          return { ok: false, reason: 'Здесь месторождение — только для бура' };
        }
      }
    }

    if (type === 'drill') {
      // Бур ставится ровно на месторождение 3×3.
      const index = this.depositAt(x, y);
      const d = index >= 0 ? DEPOSITS[index] : null;
      if (!d || d.x !== x || d.y !== y) return { ok: false, reason: 'Бур ставится на месторождение' };
    }
    return { ok: true, reason: '' };
  }

  /** Ставит здание или логистический блок. Возвращает результат проверки места. */
  placeBuilding(type: BuildingType, x: number, y: number, dir: Dir): PlaceCheck {
    if (type === 'belt') return this.placeBelt(x, y, dir);
    const check = this.checkPlace(type, x, y);
    if (!check.ok) return check;

    const id = this.nextId++;
    let e: Entity;
    if (isMachineType(type)) {
      const index = this.depositAt(x, y);
      e = {
        kind: 'machine', id, type, x, y, size: BUILDINGS[type].size, dir,
        recipe: null, cycleRecipe: null,
        ore: type === 'drill' && index >= 0 ? DEPOSITS[index].ore : null,
        inBuf: {}, outBuf: [], busy: false, progress: 0,
      };
      if (type === 'drill' && e.ore === 'iron_ore' && this.tutorial === 0) this.setTutorial(1);
    } else if (type === 'merger') {
      e = { kind: 'merger', id, x, y, dir, slots: [null, null, null, null], items: [], next: 0 };
    } else if (type === 'splitter') {
      e = { kind: 'splitter', id, x, y, dir, items: [], next: 0 };
    } else {
      e = { kind: 'bridge', id, x, y, dir, h: [], v: [] };
    }
    this.addEntity(e);
    return check;
  }

  /** Ставит ленту. Если лента уже есть — меняет её направление (предметы остаются). */
  placeBelt(x: number, y: number, dir: Dir): PlaceCheck {
    const cell = this.cellAt(x, y);
    if (cell !== null && cell !== 'base' && cell.kind === 'belt') {
      if (cell.dir !== dir) {
        cell.dir = dir;
        for (const mi of cell.items) if (mi.from === dir) mi.from = opposite(dir);
        this.changed();
      }
      return { ok: true, reason: '' };
    }
    const check = this.checkPlace('belt', x, y);
    if (!check.ok) return check;
    this.addEntity({ kind: 'belt', id: this.nextId++, x, y, dir, items: [] });
    return check;
  }

  /** Удаляет объект в клетке. Базу, скалы и воду удалить нельзя. Предметы внутри исчезают. */
  remove(x: number, y: number): boolean {
    const cell = this.cellAt(x, y);
    if (cell === null || cell === 'base') return false;
    this.entities.delete(cell.id);
    forEachCell(cell, (cx, cy) => {
      this.cells[cy * MAP_W + cx] = null;
    });
    this.changed();
    return true;
  }

  /** Выбор рецепта для здания с выбором рецепта. Входной буфер очищается, текущий цикл сбрасывается. */
  setRecipe(machineId: number, recipeId: string): void {
    const m = this.entities.get(machineId);
    if (!m || m.kind !== 'machine') return;
    const r = getRecipe(recipeId);
    if (!r || r.building !== m.type || m.recipe === recipeId) return;
    m.recipe = recipeId;
    m.cycleRecipe = null;
    m.inBuf = {};
    m.busy = false;
    m.progress = 0;
    this.changed();
  }

  /** Игрок выбрал карточку улучшения. */
  chooseUpgrade(upgradeId: string): void {
    if (!this.upgradeChoices || !this.upgradeChoices.includes(upgradeId)) return;
    applyUpgrade(this, upgradeId);
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    this.upgradeChoices = this.pendingLevelUps > 0 ? rollUpgradeChoices(this) : null;
  }

  // ---------------------------------------------------------------------------
  // Служебное
  // ---------------------------------------------------------------------------

  /** Регистрирует сущность и занимает её клетки (используется и при загрузке сохранения). */
  addEntity(e: Entity): void {
    this.entities.set(e.id, e);
    forEachCell(e, (cx, cy) => {
      this.cells[cy * MAP_W + cx] = e;
    });
    this.changed();
  }

  private changed(): void {
    this.version++;
    this.orderDirty = true;
  }

  /** Обход в глубину по направлению потока: в списке сначала идут объекты ниже по течению. */
  private rebuildOrder(): void {
    const visited = new Set<number>();
    const order: Entity[] = [];
    const visit = (e: Entity): void => {
      if (visited.has(e.id)) return;
      visited.add(e.id);
      for (const t of downstreamCells(e)) {
        const next = this.cellAt(t.x, t.y);
        if (next !== null && next !== 'base') visit(next);
      }
      order.push(e);
    };
    for (const e of this.entities.values()) visit(e);
    this.order = order;
    this.orderDirty = false;
  }
}

/** Лента: один тик движения предметов к выходу. */
function updateBelt(world: World, b: Belt): void {
  advanceLane(world, b.x, b.y, b.items, () => b.dir);
}

/** Вызывает fn для каждой клетки, которую занимает сущность. */
export function forEachCell(e: Entity, fn: (x: number, y: number) => void): void {
  const size = e.kind === 'machine' ? e.size : 1;
  for (let y = e.y; y < e.y + size; y++) {
    for (let x = e.x; x < e.x + size; x++) fn(x, y);
  }
}

/** Клетки, куда сущность может отдавать предметы. */
function downstreamCells(e: Entity): { x: number; y: number }[] {
  const at = (d: Dir) => ({ x: e.x + DX[d], y: e.y + DY[d] });
  switch (e.kind) {
    case 'machine':
      return [outputTarget(e)];
    case 'belt':
    case 'merger':
      return [at(e.dir)];
    case 'splitter':
      return [at(turnLeft(e.dir)), at(e.dir), at(turnRight(e.dir))];
    case 'bridge':
      return [at(0), at(1), at(2), at(3)];
  }
}

/** Все предметы на лентах и в логистике (для отрисовки). */
export function forEachMovingItem(world: World, fn: (mi: MovingItem) => void): void {
  for (const e of world.entities.values()) {
    if (e.kind !== 'machine') forEachItemIn(e, fn);
  }
}
