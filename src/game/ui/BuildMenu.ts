// Выезжающее слева меню построек: цветной квадрат, название, размер, что делает.
// Закрытые пункты затемнены и подписаны «откроется на уровне N».

import Phaser from 'phaser';
import { BUILDINGS, BUILD_MENU_ORDER, COLORS } from '../balance';
import { isUnlocked } from '../sim/Progression';
import type { BuildingType } from '../sim/types';
import type { World } from '../sim/World';
import { makePanel, textStyle } from './widgets';

const WIDTH = 340;
const ROW_H = 50;
const TOP = 46;

export class BuildMenu {
  readonly container: Phaser.GameObjects.Container;
  isOpen = false;
  private panel: Phaser.GameObjects.Rectangle;
  private rows: Phaser.GameObjects.Container;
  private shownLevel = -1;
  private x = 12;

  constructor(private scene: Phaser.Scene, private onPick: (type: BuildingType) => void) {
    this.container = scene.add.container(-WIDTH - 20, 0).setVisible(false);
    this.panel = makePanel(scene, WIDTH, TOP + BUILD_MENU_ORDER.length * ROW_H + 10);
    const title = scene.add.text(16, 14, 'Постройки', textStyle(16, COLORS.accentText, true));
    const hint = scene.add.text(WIDTH - 16, 16, 'B / Tab', textStyle(12, COLORS.textDim)).setOrigin(1, 0);
    this.rows = scene.add.container(0, 0);
    this.container.add([this.panel, title, hint, this.rows]);
  }

  /** Пересобирает строки, когда меняется уровень (что-то могло открыться). */
  update(world: World): void {
    if (world.level === this.shownLevel) return;
    this.shownLevel = world.level;
    this.rows.removeAll(true);
    BUILD_MENU_ORDER.forEach((type, i) => this.rows.add(this.makeRow(world, type, TOP + i * ROW_H)));
  }

  private makeRow(world: World, type: BuildingType, y: number): Phaser.GameObjects.Container {
    const s = this.scene;
    const def = BUILDINGS[type];
    const unlocked = isUnlocked(world, type);
    const row = s.add.container(0, y);

    const bg = s.add.rectangle(8, 0, WIDTH - 16, ROW_H - 4, 0x1d212a, 1).setOrigin(0, 0);
    bg.setRounded(8);
    const swatch = s.add.rectangle(16, 8, 30, 30, def.color).setOrigin(0, 0).setStrokeStyle(2, def.border);
    swatch.setRounded(6);
    const name = s.add.text(56, 6, `${def.name}  `, textStyle(14, COLORS.text, true));
    const size = s.add.text(56 + name.width, 8, `${def.size}×${def.size}`, textStyle(12, COLORS.textDim));
    const info = s.add.text(56, 25, unlocked ? def.hint : `откроется на уровне ${def.unlockLevel}`,
      textStyle(11, unlocked ? COLORS.textDim : COLORS.accentText));
    row.add([bg, swatch, name, size, info]);

    if (!unlocked) {
      row.setAlpha(0.45);
      return row;
    }
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x2a303c, 1));
    bg.on('pointerout', () => bg.setFillStyle(0x1d212a, 1));
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.onPick(type);
    });
    return row;
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  setOpen(open: boolean): void {
    if (open === this.isOpen) return;
    this.isOpen = open;
    this.scene.tweens.killTweensOf(this.container);
    if (open) this.container.setVisible(true);
    this.scene.tweens.add({
      targets: this.container,
      x: open ? this.x : -WIDTH - 20,
      duration: 180,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        if (!this.isOpen) this.container.setVisible(false);
      },
    });
  }

  layout(x: number, y: number): void {
    this.x = x;
    this.container.y = y;
    if (this.isOpen) this.container.x = x;
  }
}
