// Стартовый экран: название, «Продолжить» (если есть сохранение), «Новая игра» с подтверждением,
// строка управления. На фоне едут предметы по лентам.

import Phaser from 'phaser';
import { CELL, COLORS, ITEMS } from './balance';
import { clearSave, hasSave } from './sim/Save';
import type { ItemId } from './sim/types';
import { Sound } from './Sound';
import { makeButton, makePanel, textStyle } from './ui/widgets';

export const GAME_TITLE = 'Factory UP!';

/** Ряд фоновой ленты с бегущими предметами. */
interface BgRow {
  y: number;
  speed: number;
  items: Phaser.GameObjects.Image[];
}

export class MenuScene extends Phaser.Scene {
  private bg: Phaser.GameObjects.GameObject[] = [];
  private rows: BgRow[] = [];
  private ui: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('MenuScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.mapBg);
    this.build();
    this.scale.on('resize', this.build, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.build, this));
  }

  /** Строит экран заново (и при изменении размера окна). */
  private build(): void {
    for (const o of [...this.bg, ...this.ui]) o.destroy();
    this.bg = [];
    this.ui = [];
    this.rows = [];
    const w = this.scale.width;
    const h = this.scale.height;
    this.cameras.main.setSize(w, h);
    this.buildBackground(w, h);
    this.buildMenu(w, h);
  }

  private buildBackground(w: number, h: number): void {
    const grid = this.add.graphics();
    grid.fillStyle(COLORS.grid, 1);
    for (let x = 0; x < w; x += CELL) grid.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += CELL) grid.fillRect(0, y, w, 1);
    this.bg.push(grid);

    const itemIds = Object.keys(ITEMS) as ItemId[];
    const rowYs = [0.16, 0.3, 0.72, 0.86].map((f) => Math.floor((h * f) / CELL) * CELL + CELL / 2);
    rowYs.forEach((y, r) => {
      for (let x = CELL / 2; x < w + CELL; x += CELL) {
        this.bg.push(this.add.image(x, y, 'belt0').setAngle(r % 2 === 0 ? 90 : 270).setAlpha(0.5));
      }
      const row: BgRow = { y, speed: (r % 2 === 0 ? 1 : -1) * (60 + r * 12), items: [] };
      for (let x = 0; x < w + CELL; x += CELL * (1.5 + (r % 3))) {
        const id = itemIds[(Math.floor(x / CELL) + r * 5) % itemIds.length];
        const img = this.add.image(x, y, `item_${id}`).setAlpha(0.8);
        row.items.push(img);
        this.bg.push(img);
      }
      this.rows.push(row);
    });
  }

  private buildMenu(w: number, h: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const panelW = Math.min(520, w - 32);
    const panel = makePanel(this, panelW, 330, 0.95).setPosition(cx - panelW / 2, cy - 175);
    const title = this.add.text(cx, cy - 130, GAME_TITLE, textStyle(52, COLORS.accentText, true)).setOrigin(0.5);
    title.setStroke('#0f1115', 8);
    const sub = this.add.text(cx, cy - 82, 'Ставь буры, тяни конвейеры, выполняй заказы базы', textStyle(15, COLORS.textDim)).setOrigin(0.5);
    this.ui.push(panel, title, sub);
    this.tweens.add({ targets: title, scale: 1.04, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const saved = hasSave();
    let y = cy - 40;
    if (saved) {
      const cont = makeButton(this, 'Продолжить', 240, 46, () => this.startGame(true), 18);
      cont.setActive(true);
      cont.container.setPosition(cx - 120, y);
      this.ui.push(cont.container);
      y += 58;
    }
    const fresh = makeButton(this, 'Новая игра', 240, 46, () => (saved ? this.confirmNewGame() : this.startGame(false)), 18);
    if (!saved) fresh.setActive(true);
    fresh.container.setPosition(cx - 120, y);
    this.ui.push(fresh.container);

    const help = this.add.text(cx, cy + 115,
      'WASD / стрелки — камера · колесо — зум · B — постройки · Q — конвейер\nE — удалить · R — поворот · Esc / ПКМ — выход из режима',
      { ...textStyle(13, COLORS.textDim), align: 'center', wordWrap: { width: panelW - 32 } }).setOrigin(0.5);
    this.ui.push(help);
  }

  /** «Новая игра» при наличии сохранения: спрашиваем подтверждение. */
  private confirmNewGame(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const items: Phaser.GameObjects.GameObject[] = [];
    const dim = this.add.rectangle(0, 0, w, h, 0x05070a, 0.75).setOrigin(0, 0).setInteractive();
    const box = makePanel(this, 380, 160, 1).setPosition(w / 2 - 190, h / 2 - 80).setStrokeStyle(2, COLORS.accent);
    const text = this.add.text(w / 2, h / 2 - 40, 'Начать заново?\nТекущий прогресс будет потерян.', { ...textStyle(16), align: 'center' }).setOrigin(0.5);
    const close = () => items.forEach((o) => o.destroy());
    const yes = makeButton(this, 'Да, заново', 150, 40, () => {
      close();
      clearSave();
      this.startGame(false);
    }, 15);
    yes.container.setPosition(w / 2 - 160, h / 2 + 18);
    const no = makeButton(this, 'Отмена', 150, 40, close, 15);
    no.container.setPosition(w / 2 + 10, h / 2 + 18);
    items.push(dim, box, text, yes.container, no.container);
    this.ui.push(...items);
  }

  private startGame(load: boolean): void {
    Sound.click();
    this.scene.start('GameScene', { load });
  }

  update(_time: number, delta: number): void {
    const w = this.scale.width;
    for (const row of this.rows) {
      for (const img of row.items) {
        img.x += (row.speed * delta) / 1000;
        if (img.x > w + CELL) img.x -= w + CELL * 2;
        if (img.x < -CELL) img.x += w + CELL * 2;
      }
    }
  }
}
