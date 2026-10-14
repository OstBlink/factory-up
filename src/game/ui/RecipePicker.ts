// Окно выбора рецепта для литейной, сборщика и конструктора.

import Phaser from 'phaser';
import { BUILDINGS, COLORS, ITEMS } from '../balance';
import { recipesFor } from '../sim/Buildings';
import type { Machine } from '../sim/types';
import { makeButton, makePanel, textStyle } from './widgets';

const WIDTH = 460;
const ROW_H = 58;

export class RecipePicker {
  readonly container: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.Container;
  private height = 0;

  constructor(private scene: Phaser.Scene, private onPick: (machineId: number, recipeId: string) => void) {
    this.container = scene.add.container(0, 0).setVisible(false);
    this.content = scene.add.container(0, 0);
    this.container.add(this.content);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  show(m: Machine): void {
    const s = this.scene;
    this.content.removeAll(true);
    const recipes = recipesFor(m.type);
    this.height = 64 + recipes.length * ROW_H + 12;

    const bg = makePanel(s, WIDTH, this.height, 0.98).setStrokeStyle(2, COLORS.accent);
    const title = s.add.text(18, 16, `${BUILDINGS[m.type].name}: выбери рецепт`, textStyle(17, COLORS.accentText, true));
    const close = makeButton(s, '✕', 28, 26, () => this.hide(), 14);
    close.container.setPosition(WIDTH - 42, 14);
    this.content.add([bg, title, close.container]);

    recipes.forEach((r, i) => {
      const y = 56 + i * ROW_H;
      const row = s.add.container(0, y);
      const chosen = m.recipe === r.id;
      const rowBg = s.add.rectangle(12, 0, WIDTH - 24, ROW_H - 6, chosen ? 0x3a2c12 : 0x1d212a, 1).setOrigin(0, 0)
        .setStrokeStyle(1, chosen ? COLORS.accent : COLORS.panelBorder);
      rowBg.setRounded(8);
      const icon = s.add.image(38, (ROW_H - 6) / 2, `item_${r.output}`).setScale(1.6);
      const name = s.add.text(62, 8, `${ITEMS[r.output].name} ×${r.outCount}`, textStyle(15, COLORS.text, true));
      const from = r.inputs.map((inp) => `${inp.count} ${ITEMS[inp.item].name}`).join(' + ');
      const info = s.add.text(62, 30, `из: ${from} · ${r.time} с`, textStyle(12, COLORS.textDim));
      row.add([rowBg, icon, name, info]);

      rowBg.setInteractive({ useHandCursor: true });
      rowBg.on('pointerover', () => rowBg.setFillStyle(chosen ? 0x4a3816 : 0x2a303c, 1));
      rowBg.on('pointerout', () => rowBg.setFillStyle(chosen ? 0x3a2c12 : 0x1d212a, 1));
      rowBg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (!p.leftButtonDown()) return;
        this.onPick(m.id, r.id);
        this.hide();
      });
      this.content.add(row);
    });

    this.container.setVisible(true);
    this.layout(s.scale.width, s.scale.height);
  }

  hide(): void {
    this.container.setVisible(false);
  }

  layout(screenW: number, screenH: number): void {
    this.container.setPosition(Math.round((screenW - WIDTH) / 2), Math.round((screenH - this.height) / 2));
  }
}
