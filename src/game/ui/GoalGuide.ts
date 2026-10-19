// Подсказка под заданием: «Как получить» нужный предмет — все шаги от руды до готового предмета,
// с указанием здания и ингредиентов. При смене задания привлекает внимание пульсирующей рамкой.

import Phaser from 'phaser';
import { BUILDINGS, COLORS, DEPOSITS, ITEMS, MAP_H } from '../balance';
import type { Recipe } from '../balance';
import { howToMake } from '../sim/Goals';
import type { ItemId } from '../sim/types';
import type { World } from '../sim/World';
import { makeAttentionRing, makePanel, pulseRing, textStyle } from './widgets';

const MAX_WIDTH = 560;
const ROW_H = 24;
const PAD = 14;

export class GoalGuide {
  readonly container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private rows: Phaser.GameObjects.Container;
  private ring: Phaser.GameObjects.Rectangle;
  private shownItem: ItemId | null = null;
  private collapsed = false;
  private width = 300;
  private screenW = 0;

  constructor(private scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setVisible(false);
    this.bg = makePanel(scene, 300, 40, 0.95).setStrokeStyle(1, COLORS.accent);
    // Клик по подсказке сворачивает и разворачивает её.
    this.bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) return;
      this.collapsed = !this.collapsed;
      if (this.shownItem) this.rebuild(this.shownItem);
    });
    this.rows = scene.add.container(0, 0);
    this.ring = makeAttentionRing(scene, COLORS.accent);
    this.container.add([this.ring, this.bg, this.rows]);
  }

  /** Показываем после обучения; при смене задания перестраиваем и привлекаем внимание. */
  update(world: World): void {
    const visible = world.tutorial >= 3;
    this.container.setVisible(visible);
    if (!visible || world.goal.item === this.shownItem) return;
    this.collapsed = false;
    this.rebuild(world.goal.item);
    pulseRing(this.scene, this.ring, 2);
  }

  private rebuild(item: ItemId): void {
    const s = this.scene;
    this.shownItem = item;
    this.rows.removeAll(true);
    const wrap = Math.min(MAX_WIDTH, this.screenW - 24) - 2 * PAD - 26;

    const title = s.add.text(PAD, 10, `Как получить: ${ITEMS[item].name}`, textStyle(14, COLORS.accentText, true));
    const toggle = s.add.text(0, 12, this.collapsed ? 'показать ▼' : 'свернуть ▲', textStyle(12, COLORS.textDim));
    this.rows.add([title, toggle]);
    let width = title.width + toggle.width + 3 * PAD;
    let y = 36;

    if (!this.collapsed) {
      howToMake(item).forEach((step, i, all) => {
        const last = i === all.length - 1;
        const text = `${i + 1}. ${stepText(step.item, step.recipe)}`;
        const icon = s.add.image(PAD + 9, y + 9, `item_${step.item}`);
        const label = s.add.text(PAD + 24, y, text, {
          ...textStyle(13, last ? COLORS.text : COLORS.textDim, last),
          wordWrap: { width: wrap },
        });
        this.rows.add([icon, label]);
        width = Math.max(width, label.width + PAD * 2 + 26);
        y += Math.max(ROW_H, label.height + 6);
      });
    }

    this.width = Math.min(width, Math.min(MAX_WIDTH, this.screenW - 24));
    toggle.setX(this.width - PAD - toggle.width);
    const height = y + (this.collapsed ? 0 : 4);
    this.bg.setSize(this.width, height);
    this.ring.setSize(this.width, height).setPosition(this.width / 2, height / 2);
    this.layout(this.screenW);
  }

  /** Под панелью задания, по центру экрана. */
  layout(screenW: number): void {
    const widthChanged = screenW !== this.screenW;
    this.screenW = screenW;
    if (widthChanged && this.shownItem) {
      this.rebuild(this.shownItem);
      return;
    }
    this.container.setPosition(Math.round(screenW / 2 - this.width / 2), 86);
  }
}

/** Текст шага: сырьё — где добывать, остальное — в каком здании и из чего. */
function stepText(item: ItemId, recipe: Recipe | null): string {
  const name = ITEMS[item].name;
  if (!recipe) return `${name} — поставь бур на месторождение (${depositSides(item)})`;
  const from = recipe.inputs.map((i) => `${i.count} ${ITEMS[i.item].name}`).join(' + ');
  const out = recipe.outCount > 1 ? ` ×${recipe.outCount}` : '';
  return `${name}${out} — ${BUILDINGS[recipe.building].name}: ${from}`;
}

/** Где на карте месторождения этой руды: сверху, снизу, слева, справа. */
function depositSides(ore: ItemId): string {
  const sides = new Set<string>();
  for (const d of DEPOSITS) {
    if (d.ore !== ore) continue;
    if (d.y <= 2) sides.add('сверху');
    else if (d.y >= MAP_H - 4) sides.add('внизу');
    else if (d.x <= 2) sides.add('слева');
    else sides.add('справа');
  }
  const list = [...sides];
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}` : list.join('');
}
