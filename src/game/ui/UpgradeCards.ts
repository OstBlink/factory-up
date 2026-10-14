// Выбор улучшения при повышении уровня: затемнение экрана и 4 карточки (клик или клавиши 1–4).

import Phaser from 'phaser';
import { BUILDINGS, COLORS } from '../balance';
import { describeUpgrade, unlockedAtLevel } from '../sim/Progression';
import type { World } from '../sim/World';
import { textStyle } from './widgets';

const CARD_W = 210;
const CARD_H = 210;
const GAP = 16;

export class UpgradeCards {
  readonly container: Phaser.GameObjects.Container;
  private dim: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private subtitle: Phaser.GameObjects.Text;
  private unlock: Phaser.GameObjects.Text;
  private cards: Phaser.GameObjects.Container[] = [];
  private choices: string[] = [];

  constructor(private scene: Phaser.Scene, private onPick: (upgradeId: string) => void) {
    this.container = scene.add.container(0, 0).setVisible(false);
    // Затемнение ловит клики, чтобы под ним ничего не строилось.
    this.dim = scene.add.rectangle(0, 0, 10, 10, 0x05070a, 0.72).setOrigin(0, 0).setInteractive();
    this.title = scene.add.text(0, 0, '', textStyle(38, COLORS.accentText, true)).setOrigin(0.5);
    this.title.setStroke('#0f1115', 6);
    this.subtitle = scene.add.text(0, 0, 'Выбери одно улучшение (клик или 1–4)', textStyle(16, COLORS.text)).setOrigin(0.5);
    this.unlock = scene.add.text(0, 0, '', textStyle(17, '#9fe0b5', true)).setOrigin(0.5);
    this.container.add([this.dim, this.title, this.subtitle, this.unlock]);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  show(world: World): void {
    if (!world.upgradeChoices) return;
    const s = this.scene;
    this.choices = world.upgradeChoices;
    const level = world.level - world.pendingLevelUps + 1;
    this.title.setText(`Уровень ${level}!`);
    // Если на этом уровне открылись здания — пишем об этом прямо в окне выбора.
    const opened = unlockedAtLevel(level).map((t) => BUILDINGS[t].name);
    this.unlock.setText(opened.length > 0 ? `Открыто: ${opened.join(', ')} — смотри меню построек (B)` : '');
    for (const c of this.cards) c.destroy();
    this.cards = this.choices.map((id, i) => this.makeCard(world, id, i));
    this.container.add(this.cards);
    this.container.setVisible(true);
    this.layout(s.scale.width, s.scale.height);

    // Анимация появления: заголовок «прыгает», карточки выезжают по очереди.
    this.title.setScale(0.4);
    s.tweens.add({ targets: this.title, scale: 1, duration: 420, ease: 'Back.easeOut' });
    this.cards.forEach((card, i) => {
      card.setAlpha(0);
      card.y += 30;
      s.tweens.add({ targets: card, alpha: 1, y: card.y - 30, delay: 120 + i * 70, duration: 260, ease: 'Cubic.easeOut' });
    });
  }

  hide(): void {
    this.container.setVisible(false);
  }

  /** Выбор с клавиатуры (1–4). */
  pick(index: number): void {
    if (!this.visible || index < 0 || index >= this.choices.length) return;
    this.onPick(this.choices[index]);
  }

  private makeCard(world: World, id: string, index: number): Phaser.GameObjects.Container {
    const s = this.scene;
    const info = describeUpgrade(world, id);
    const card = s.add.container(0, 0);
    const bg = s.add.rectangle(0, 0, CARD_W, CARD_H, COLORS.panel, 1).setOrigin(0, 0).setStrokeStyle(2, COLORS.panelBorder);
    bg.setRounded(12);
    const strip = s.add.rectangle(0, 0, CARD_W, 8, COLORS.accent).setOrigin(0, 0);
    const key = s.add.text(CARD_W - 14, 16, `${index + 1}`, textStyle(14, COLORS.textDim, true)).setOrigin(1, 0);
    const title = s.add.text(16, 22, info.title, { ...textStyle(18, COLORS.text, true), wordWrap: { width: CARD_W - 40 } });
    const effect = s.add.text(16, 84, info.effect, { ...textStyle(14, COLORS.textDim), wordWrap: { width: CARD_W - 32 } });
    const change = s.add.text(16, CARD_H - 58, info.change, { ...textStyle(14, COLORS.accentText, true), wordWrap: { width: CARD_W - 32 } });
    card.add([bg, strip, key, title, effect, change]);

    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setStrokeStyle(2, COLORS.accent).setFillStyle(0x1f2430, 1));
    bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelBorder).setFillStyle(COLORS.panel, 1));
    bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.onPick(id);
    });
    return card;
  }

  layout(screenW: number, screenH: number): void {
    this.dim.setSize(screenW, screenH);
    // На узком экране карточки встают сеткой 2×2.
    const perRow = screenW >= 4 * (CARD_W + GAP) + 40 ? 4 : 2;
    const rows = Math.ceil(this.cards.length / perRow);
    const totalW = Math.min(this.cards.length, perRow) * (CARD_W + GAP) - GAP;
    const totalH = rows * (CARD_H + GAP) - GAP;
    const top = Math.max(130, (screenH - totalH) / 2 + 40);
    this.title.setPosition(screenW / 2, top - 96);
    this.subtitle.setPosition(screenW / 2, top - 56);
    this.unlock.setPosition(screenW / 2, top - 28);
    this.cards.forEach((card, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      card.setPosition(Math.round((screenW - totalW) / 2 + col * (CARD_W + GAP)), Math.round(top + row * (CARD_H + GAP)));
    });
  }
}
