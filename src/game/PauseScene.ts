// Пауза: игра и HUD приостановлены (не обновляются, но видны), фон размыт, поверх — окно
// с кнопками «Продолжить», «Звук», «Рестарт» (с подтверждением) и «Выйти в меню».

import Phaser from 'phaser';
import { COLORS, PAUSE_BLUR_STRENGTH } from './balance';
import type { GameScene } from './GameScene';
import { isSoundOn, Sound, toggleSound } from './Sound';
import { makeButton, makePanel, textStyle } from './ui/widgets';

const WIDTH = 300;
const BUTTON_H = 42;

export class PauseScene extends Phaser.Scene {
  /** Фильтры размытия на камерах игры и HUD — снимаем их при выходе из паузы. */
  private blurs: { camera: Phaser.Cameras.Scene2D.Camera; blur: Phaser.Filters.Blur }[] = [];
  private objects: Phaser.GameObjects.GameObject[] = [];
  /** Показан ли вопрос «Вы уверены?» вместо основного окна. */
  private confirming = false;

  constructor() {
    super('PauseScene');
  }

  private get gameScene(): GameScene {
    return this.scene.get('GameScene') as GameScene;
  }

  create(): void {
    this.confirming = false;
    this.blurBackground();
    this.build();

    const kb = this.input.keyboard;
    kb?.on('keydown-P', () => this.resumeGame());
    kb?.on('keydown-ESC', () => {
      if (this.confirming) this.showConfirm(false);
      else this.resumeGame();
    });

    this.scale.on('resize', this.build, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.build, this);
      this.removeBlur();
    });
  }

  /** Размываем всё, что под паузой: мир (GameScene) и интерфейс (UIScene). */
  private blurBackground(): void {
    this.blurs = [];
    for (const key of ['GameScene', 'UIScene']) {
      const camera = this.scene.get(key).cameras.main;
      const blur = camera.filters.internal.addBlur(1, 2, 2, PAUSE_BLUR_STRENGTH);
      this.blurs.push({ camera, blur });
    }
  }

  private removeBlur(): void {
    for (const { camera, blur } of this.blurs) camera.filters.internal.remove(blur);
    this.blurs = [];
  }

  /** Строит окно заново: при открытии, при смене размера экрана и при переходе к вопросу «Вы уверены?». */
  private build(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const w = this.scale.width;
    const h = this.scale.height;
    this.cameras.main.setSize(w, h);

    // Лёгкое затемнение поверх размытого фона; ловит клики, чтобы под ним ничего не нажималось.
    this.objects.push(this.add.rectangle(0, 0, w, h, 0x05070a, 0.45).setOrigin(0, 0).setInteractive());
    if (this.confirming) this.buildConfirm(w, h);
    else this.buildMain(w, h);
  }

  private buildMain(w: number, h: number): void {
    const buttons: [string, () => void][] = [
      ['Продолжить (Esc)', () => this.resumeGame()],
      [soundLabel(), () => this.toggleSoundButton()],
      ['Рестарт', () => this.showConfirm(true)],
      ['Выйти в меню', () => this.gameScene.exitToMenu()],
    ];
    const panelH = 76 + buttons.length * (BUTTON_H + 10) + 10;
    const x = Math.round(w / 2 - WIDTH / 2);
    const y = Math.round(h / 2 - panelH / 2);

    const panel = makePanel(this, WIDTH, panelH, 0.97).setPosition(x, y).setStrokeStyle(2, COLORS.accent);
    const title = this.add.text(w / 2, y + 36, 'Пауза', textStyle(28, COLORS.accentText, true)).setOrigin(0.5);
    this.objects.push(panel, title);

    buttons.forEach(([label, onClick], i) => {
      const b = makeButton(this, label, WIDTH - 40, BUTTON_H, onClick, 16);
      b.container.setPosition(x + 20, y + 76 + i * (BUTTON_H + 10));
      if (i === 0) b.setActive(true);
      this.objects.push(b.container);
    });
  }

  private buildConfirm(w: number, h: number): void {
    const panelH = 180;
    const x = Math.round(w / 2 - WIDTH / 2);
    const y = Math.round(h / 2 - panelH / 2);
    const panel = makePanel(this, WIDTH, panelH, 0.97).setPosition(x, y).setStrokeStyle(2, COLORS.bad);
    const text = this.add.text(w / 2, y + 50, 'Вы уверены?\nВесь прогресс будет потерян.', { ...textStyle(16), align: 'center' })
      .setOrigin(0.5);
    const yes = makeButton(this, 'Да, заново', 120, BUTTON_H, () => this.gameScene.restartGame(), 15);
    yes.container.setPosition(x + 20, y + panelH - BUTTON_H - 20);
    const no = makeButton(this, 'Отмена', 120, BUTTON_H, () => this.showConfirm(false), 15);
    no.container.setPosition(x + WIDTH - 140, y + panelH - BUTTON_H - 20);
    this.objects.push(panel, text, yes.container, no.container);
  }

  private showConfirm(show: boolean): void {
    this.confirming = show;
    Sound.click();
    this.build();
  }

  private toggleSoundButton(): void {
    toggleSound();
    Sound.click();
    this.build();
  }

  /** Снять паузу: убрать размытие, продолжить игру и HUD, закрыть окно. */
  private resumeGame(): void {
    this.removeBlur();
    this.scene.resume('GameScene');
    this.scene.resume('UIScene');
    this.scene.stop();
  }
}

function soundLabel(): string {
  return isSoundOn() ? 'Звук: вкл' : 'Звук: выкл';
}
