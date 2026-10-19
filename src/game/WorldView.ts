// Отрисовка мира: рельеф, база с табличкой задания, здания, ленты, предметы и эффекты.
// Только читает состояние World. Статичное рисуется один раз, здания — при изменении мира,
// предметы на лентах берутся из пула спрайтов и плавно интерполируются между тиками.

import Phaser from 'phaser';
import {
  BASE_SIZE, BASE_X, BASE_Y, BUILDINGS, CELL, COLORS, DEPOSITS, DEPOSIT_SIZE, ITEMS, MAP_H, OBSTACLES, TUTORIAL_DEPOSIT,
} from './balance';
import { BELT_FRAMES, cellHash, mixColor } from './BootScene';
import { beltShape } from './sim/Belts';
import { getRecipe, portCell } from './sim/Buildings';
import { DX, DY, opposite } from './sim/types';
import type { Dir, Entity, Machine } from './sim/types';
import { forEachMovingItem } from './sim/World';
import type { World } from './sim/World';
import { textStyle } from './ui/widgets';

/** Слои отрисовки (depth). */
export const DEPTH = {
  terrain: 0,
  water: 1,
  base: 2,
  belts: 3,
  logistics: 4,
  items: 5,
  machines: 6,
  machineUi: 7,
  hint: 8,
  ghost: 9,
  hover: 10,
  effects: 11,
  sign: 12,
};

/** Префикс текстуры ленты по её форме (кадры анимации: belt0..7, beltL0..7, beltR0..7). */
export const BELT_TEXTURE = { straight: 'belt', left: 'beltL', right: 'beltR' } as const;

/** Картинки одной постройки на карте. */
interface EntityView {
  objects: Phaser.GameObjects.GameObject[];
  /** Основное изображение (корпус здания или клетка ленты). */
  body: Phaser.GameObjects.Image;
  dir: Dir;
  // Только у производственных зданий:
  bar?: Phaser.GameObjects.Rectangle;
  barWidth?: number;
  icon?: Phaser.GameObjects.Image;
  question?: Phaser.GameObjects.Text;
  shownIcon?: string;
}

/** Центр клетки или прямоугольника клеток в пикселях. */
function centerPx(x: number, y: number, size: number): { x: number; y: number } {
  return { x: (x + size / 2) * CELL, y: (y + size / 2) * CELL };
}

export class WorldView {
  private views = new Map<number, EntityView>();
  /** Картинки лент и префикс их текстуры (прямая или уголок) — для анимации шевронов. */
  private beltImages: { img: Phaser.GameObjects.Image; prefix: string }[] = [];
  private beltFrame = -1;
  private itemPool: Phaser.GameObjects.Image[] = [];
  private itemKeys: string[] = [];
  private seenVersion = -1;

  private signBg!: Phaser.GameObjects.Rectangle;
  private signIcon!: Phaser.GameObjects.Image;
  private signName!: Phaser.GameObjects.Text;
  private signCount!: Phaser.GameObjects.Text;
  private signKey = '';
  private baseImage!: Phaser.GameObjects.Image;

  private tutorialMarks: (Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = [];
  private tutorialShown = -1;

  constructor(private scene: Phaser.Scene, private world: World) {
    this.createStatic();
    this.createBaseSign();
  }

  // ---------------------------------------------------------------------------
  // Статичная часть: рельеф, блики на воде, база
  // ---------------------------------------------------------------------------

  private createStatic(): void {
    const s = this.scene;
    s.add.image(0, 0, 'terrain').setOrigin(0, 0).setDepth(DEPTH.terrain);

    // Медленно «плывущие» светлые блики на воде.
    OBSTACLES.forEach((o, i) => {
      if (o.type !== 'water') return;
      const count = Math.max(2, Math.round((o.w * o.h) / 14));
      for (let k = 0; k < count; k++) {
        const x = (o.x + 1 + cellHash(i, k, 1) * (o.w - 2)) * CELL;
        const y = (o.y + 1 + cellHash(k, i, 2) * (o.h - 2)) * CELL;
        const glow = s.add.image(x, y, 'glow').setDepth(DEPTH.water).setAlpha(0.18).setScale(0.7, 0.35);
        glow.setTint(0x9fd4ff);
        s.tweens.add({
          targets: glow,
          x: x + CELL * (0.6 + cellHash(k, i, 3)),
          alpha: 0.05,
          duration: 2600 + cellHash(i, k, 4) * 2400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    });

    const c = centerPx(BASE_X, BASE_Y, BASE_SIZE);
    this.baseImage = s.add.image(c.x, c.y, 'base').setDepth(DEPTH.base);
    s.add.text(c.x, c.y + 64, 'БАЗА', textStyle(18, '#9fe0b5', true)).setOrigin(0.5).setDepth(DEPTH.base);

    this.createDepositLabels();
  }

  /** Подписи месторождений: название руды под ним (у нижнего края карты — над ним). */
  private createDepositLabels(): void {
    for (const d of DEPOSITS) {
      const item = ITEMS[d.ore];
      const c = centerPx(d.x, d.y, DEPOSIT_SIZE);
      const below = d.y + DEPOSIT_SIZE < MAP_H - 2;
      const y = below ? (d.y + DEPOSIT_SIZE) * CELL + 14 : d.y * CELL - 14;
      const color = `#${mixColor(item.color, 0xffffff, 0.35).toString(16).padStart(6, '0')}`;
      // Под лентами: проложенная рядом лента не будет перекрыта подписью.
      const label = this.scene.add.text(c.x, y, item.name, textStyle(16, color, true))
        .setOrigin(0.5).setDepth(DEPTH.water);
      label.setStroke('#0f1115', 5);
    }
  }

  /** Табличка текущего задания над базой. */
  private createBaseSign(): void {
    const s = this.scene;
    const c = centerPx(BASE_X, BASE_Y, BASE_SIZE);
    const y = BASE_Y * CELL - 34;
    this.signBg = s.add.rectangle(c.x, y, 230, 44, COLORS.panel, 0.95)
      .setStrokeStyle(2, COLORS.accent).setDepth(DEPTH.sign);
    this.signBg.setRounded(10);
    this.signIcon = s.add.image(c.x - 92, y, 'item_iron_ore').setScale(1.4).setDepth(DEPTH.sign);
    this.signName = s.add.text(c.x - 76, y - 11, '', textStyle(13)).setOrigin(0, 0.5).setDepth(DEPTH.sign);
    this.signCount = s.add.text(c.x - 76, y + 9, '', textStyle(13, COLORS.accentText, true)).setOrigin(0, 0.5).setDepth(DEPTH.sign);
  }

  private updateBaseSign(): void {
    const g = this.world.goal;
    const key = `${g.item}:${g.delivered}:${g.amount}`;
    if (key === this.signKey) return;
    this.signKey = key;
    this.signIcon.setTexture(`item_${g.item}`);
    this.signName.setText(`Доставь: ${ITEMS[g.item].name}`);
    this.signCount.setText(`${g.delivered} / ${g.amount}`);
    const width = Math.max(200, this.signName.width + 110);
    this.signBg.setSize(width, 44);
    const c = centerPx(BASE_X, BASE_Y, BASE_SIZE);
    this.signBg.setPosition(c.x, BASE_Y * CELL - 34);
    this.signIcon.setX(c.x - width / 2 + 22);
    this.signName.setX(c.x - width / 2 + 40);
    this.signCount.setX(c.x - width / 2 + 40);
  }

  // ---------------------------------------------------------------------------
  // Постройки: создаются и удаляются, когда мир меняется (world.version)
  // ---------------------------------------------------------------------------

  private syncEntities(): void {
    if (this.seenVersion === this.world.version) return;
    this.seenVersion = this.world.version;

    for (const [id, view] of this.views) {
      if (!this.world.entities.has(id)) {
        for (const o of view.objects) o.destroy();
        this.views.delete(id);
      }
    }
    for (const e of this.world.entities.values()) {
      const view = this.views.get(e.id);
      if (!view) {
        this.views.set(e.id, this.createView(e));
      } else if (view.dir !== e.dir && e.kind === 'belt') {
        view.dir = e.dir;
        view.body.setAngle(e.dir * 90);
      }
    }
    // Форма ленты зависит от соседей, поэтому пересчитываем её у всех лент после любого изменения.
    this.beltImages = [];
    const frame = Math.max(0, this.beltFrame);
    for (const [id, view] of this.views) {
      const e = this.world.entities.get(id);
      if (e?.kind !== 'belt') continue;
      const prefix = BELT_TEXTURE[beltShape(this.world, e)];
      view.body.setTexture(`${prefix}${frame}`);
      this.beltImages.push({ img: view.body, prefix });
    }
  }

  private createView(e: Entity): EntityView {
    const s = this.scene;
    if (e.kind !== 'machine') {
      const c = centerPx(e.x, e.y, 1);
      const key = e.kind === 'belt' ? 'belt0' : e.kind;
      const img = s.add.image(c.x, c.y, key).setDepth(e.kind === 'belt' ? DEPTH.belts : DEPTH.logistics);
      if (e.kind !== 'bridge') img.setAngle(e.dir * 90);
      return { objects: [img], body: img, dir: e.dir };
    }
    return this.createMachineView(e);
  }

  private createMachineView(m: Machine): EntityView {
    const s = this.scene;
    const size = m.size * CELL;
    const c = centerPx(m.x, m.y, m.size);
    const objects: Phaser.GameObjects.GameObject[] = [];

    const body = s.add.image(c.x, c.y, `bld_${m.type}`).setDepth(DEPTH.machines);
    objects.push(body);
    objects.push(...createPortArrows(s, m.x, m.y, m.size, m.dir, m.type !== 'drill', DEPTH.machineUi));

    const label = s.add.text(c.x, m.y * CELL + 15, BUILDINGS[m.type].name, textStyle(m.size > 3 ? 13 : 11, COLORS.text, true))
      .setOrigin(0.5, 0.5).setDepth(DEPTH.machineUi);
    objects.push(label);

    const icon = s.add.image(c.x, c.y + 2, 'item_iron_ore').setScale(m.size > 3 ? 2.2 : 1.6).setDepth(DEPTH.machineUi).setVisible(false);
    objects.push(icon);

    const question = s.add.text(c.x, c.y + 2, '?', textStyle(m.size > 3 ? 40 : 30, COLORS.accentText, true))
      .setOrigin(0.5).setDepth(DEPTH.machineUi).setVisible(false);
    objects.push(question);

    const barWidth = size - 34;
    const barY = m.y * CELL + size - 17;
    const barBg = s.add.rectangle(c.x, barY, barWidth, 6, 0x000000, 0.55).setDepth(DEPTH.machineUi);
    const bar = s.add.rectangle(c.x - barWidth / 2, barY, barWidth, 6, COLORS.accent).setOrigin(0, 0.5).setDepth(DEPTH.machineUi);
    bar.scaleX = 0;
    objects.push(barBg, bar);

    return { objects, body, dir: m.dir, bar, barWidth, icon, question, shownIcon: '' };
  }

  // ---------------------------------------------------------------------------
  // Покадровое обновление
  // ---------------------------------------------------------------------------

  /** alpha — доля пути между прошлым и текущим тиком (0..1) для плавного движения. */
  update(time: number, alpha: number): void {
    this.syncEntities();
    this.updateBaseSign();
    this.updateBelts(time);
    this.updateMachines(time);
    this.updateItems(alpha);
    this.updateTutorialMarks(time);
  }

  /** Анимация шевронов: кадр зависит от времени и скорости лент. */
  private updateBelts(time: number): void {
    if (this.world.isPaused()) return;
    const pxPerFrame = CELL / 2 / BELT_FRAMES;
    const frame = Math.floor(((time / 1000) * this.world.beltSpeed() * CELL) / pxPerFrame) % BELT_FRAMES;
    if (frame === this.beltFrame) return;
    this.beltFrame = frame;
    for (const b of this.beltImages) b.img.setTexture(`${b.prefix}${frame}`);
  }

  private updateMachines(time: number): void {
    for (const [id, view] of this.views) {
      const e = this.world.entities.get(id);
      if (!e || e.kind !== 'machine' || !view.bar || !view.icon || !view.question) continue;

      // Полоска прогресса и лёгкая пульсация работающего здания.
      view.bar.scaleX = e.busy ? Math.min(1, e.progress) : 0;
      const pulse = e.busy ? 1 + 0.018 * Math.sin(time / 110 + id) : 1;
      view.body.setScale(pulse);

      // Иконка: что здание делает сейчас (руда бура, выбранный или последний рецепт).
      let iconKey = '';
      if (e.type === 'drill') iconKey = e.ore ? `item_${e.ore}` : '';
      else {
        const r = getRecipe(e.recipe ?? e.cycleRecipe);
        iconKey = r ? `item_${r.output}` : '';
      }
      if (iconKey !== view.shownIcon) {
        view.shownIcon = iconKey;
        view.icon.setVisible(iconKey !== '');
        if (iconKey) view.icon.setTexture(iconKey);
      }
      view.question.setVisible(BUILDINGS[e.type].recipeMode === 'select' && e.recipe === null);
    }
  }

  /** Предметы на лентах: пул спрайтов, позиция плавно идёт от прошлого тика к текущему. */
  private updateItems(alpha: number): void {
    let n = 0;
    forEachMovingItem(this.world, (mi) => {
      if (n >= this.itemPool.length) {
        this.itemPool.push(this.scene.add.image(0, 0, `item_${mi.item}`).setDepth(DEPTH.items));
        this.itemKeys.push(mi.item);
      }
      const img = this.itemPool[n];
      if (this.itemKeys[n] !== mi.item) {
        this.itemKeys[n] = mi.item;
        img.setTexture(`item_${mi.item}`);
      }
      img.setPosition((mi.px + (mi.rx - mi.px) * alpha) * CELL, (mi.py + (mi.ry - mi.py) * alpha) * CELL);
      img.setVisible(true);
      n++;
    });
    for (let i = n; i < this.itemPool.length; i++) {
      if (!this.itemPool[i].visible) break; // дальше все и так скрыты
      this.itemPool[i].setVisible(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Обучение: подсветка верхнего железа и подсказка пути ленты
  // ---------------------------------------------------------------------------

  private updateTutorialMarks(time: number): void {
    const step = this.world.tutorial;
    if (step !== this.tutorialShown) {
      this.tutorialShown = step;
      for (const o of this.tutorialMarks) o.destroy();
      this.tutorialMarks = [];
      const d = DEPOSITS[TUTORIAL_DEPOSIT];
      if (step === 0) {
        const c = centerPx(d.x, d.y, DEPOSIT_SIZE);
        const ring = this.scene.add.rectangle(c.x, c.y, DEPOSIT_SIZE * CELL + 10, DEPOSIT_SIZE * CELL + 10)
          .setStrokeStyle(3, COLORS.accent).setDepth(DEPTH.hint);
        ring.setRounded(14);
        const label = this.scene.add.text(c.x, (d.y + DEPOSIT_SIZE) * CELL + 44, 'Поставь сюда бур', textStyle(20, COLORS.accentText, true))
          .setOrigin(0.5).setDepth(DEPTH.hint);
        this.tutorialMarks.push(ring, label);
      } else if (step === 1 && this.hasTutorialDrill()) {
        // Пунктир от выхода бура вниз до базы.
        const x = d.x + 1;
        for (let y = d.y + DEPOSIT_SIZE; y < BASE_Y; y++) {
          // Под лентами: когда игрок проложит ленту по подсказке, точки скроются под ней.
          const dot = this.scene.add.image((x + 0.5) * CELL, (y + 0.5) * CELL, 'port_in')
            .setAngle(180).setAlpha(0.5).setDepth(DEPTH.water);
          this.tutorialMarks.push(dot);
        }
      }
    }
    // Мягкая пульсация подсказок.
    const a = 0.45 + 0.35 * Math.sin(time / 260);
    for (const o of this.tutorialMarks) o.setAlpha(a);
  }

  private hasTutorialDrill(): boolean {
    const d = DEPOSITS[TUTORIAL_DEPOSIT];
    const cell = this.world.cellAt(d.x, d.y);
    return cell !== null && cell !== 'base' && cell.kind === 'machine' && cell.dir === 2;
  }

  // ---------------------------------------------------------------------------
  // Эффекты
  // ---------------------------------------------------------------------------

  /** Всплывающее «+N» над базой. */
  popText(text: string, color: string = COLORS.accentText, size = 18): void {
    const c = centerPx(BASE_X, BASE_Y, BASE_SIZE);
    const t = this.scene.add.text(c.x + Phaser.Math.Between(-40, 40), c.y - 20, text, textStyle(size, color, true))
      .setOrigin(0.5).setDepth(DEPTH.effects);
    t.setStroke('#0f1115', 4);
    this.scene.tweens.add({
      targets: t,
      y: t.y - 70,
      alpha: 0,
      duration: 1100,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  /** Задание выполнено: вспышка и звёздочки от базы. */
  goalBurst(): void {
    const s = this.scene;
    const c = centerPx(BASE_X, BASE_Y, BASE_SIZE);
    const flash = s.add.image(c.x, c.y, 'glow').setDepth(DEPTH.effects).setScale(2).setAlpha(0.9).setTint(0xfff1c4);
    s.tweens.add({ targets: flash, scale: 6, alpha: 0, duration: 700, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
    s.tweens.add({ targets: this.baseImage, scale: 1.06, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const star = s.add.image(c.x, c.y, 'star').setDepth(DEPTH.effects).setTint(i % 2 ? COLORS.accent : 0xffffff);
      const dist = 120 + Math.random() * 80;
      s.tweens.add({
        targets: star,
        x: c.x + Math.cos(a) * dist,
        y: c.y + Math.sin(a) * dist,
        angle: 360,
        alpha: 0,
        scale: 0.4,
        duration: 900 + Math.random() * 300,
        ease: 'Cubic.easeOut',
        onComplete: () => star.destroy(),
      });
    }
    s.tweens.add({ targets: this.signBg, scaleX: 1.12, scaleY: 1.12, duration: 140, yoyo: true });
  }
}

/**
 * Стрелки портов вокруг здания: на выходе — наружу (оранжевая), на входах — внутрь (зелёная).
 * Используется и для настоящих зданий, и для «призрака» при постройке.
 */
export function createPortArrows(
  scene: Phaser.Scene, x: number, y: number, size: number, dir: Dir, withInputs: boolean, depth: number,
): Phaser.GameObjects.Image[] {
  const arrows: Phaser.GameObjects.Image[] = [];
  for (const side of [0, 1, 2, 3] as Dir[]) {
    const isOut = side === dir;
    if (!isOut && !withInputs) continue;
    const p = portCell({ x, y, size }, side);
    // Стрелка стоит на краю здания посередине стороны.
    const ax = (p.x + 0.5 + DX[side] * 0.5) * CELL - DX[side] * 6;
    const ay = (p.y + 0.5 + DY[side] * 0.5) * CELL - DY[side] * 6;
    const img = scene.add.image(ax, ay, isOut ? 'port_out' : 'port_in')
      .setAngle((isOut ? side : opposite(side)) * 90)
      .setDepth(depth);
    arrows.push(img);
  }
  return arrows;
}
