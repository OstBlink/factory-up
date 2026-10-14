// Мелкие строительные блоки интерфейса: стиль текста, панель, кнопка, форматирование чисел.

import Phaser from 'phaser';
import { COLORS, FONT } from '../balance';

export function textStyle(size: number, color: string = COLORS.text, bold = false): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color,
    fontStyle: bold ? 'bold' : 'normal',
    resolution: Math.max(2, window.devicePixelRatio || 1),
  };
}

/** Опыт бывает дробным (из-за бонуса): мелкие числа с одной цифрой после запятой. */
export function formatNumber(v: number): string {
  if (v < 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v));
}

/** Панель: скруглённый прямоугольник с рамкой. Интерактивна, чтобы клик не «проваливался» на карту. */
export function makePanel(scene: Phaser.Scene, w: number, h: number, alpha = 0.96): Phaser.GameObjects.Rectangle {
  const r = scene.add.rectangle(0, 0, w, h, COLORS.panel, alpha).setOrigin(0, 0).setStrokeStyle(1, COLORS.panelBorder);
  r.setRounded(10);
  r.setInteractive();
  return r;
}

export interface Button {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  setActive(active: boolean): void;
  setEnabled(enabled: boolean): void;
}

/** Кнопка с подсветкой при наведении. Координаты — левый верхний угол. */
export function makeButton(
  scene: Phaser.Scene, text: string, w: number, h: number, onClick: () => void, fontSize = 14,
): Button {
  const container = scene.add.container(0, 0);
  const bg = scene.add.rectangle(0, 0, w, h, 0x222731, 1).setOrigin(0, 0).setStrokeStyle(1, COLORS.panelBorder);
  bg.setRounded(8);
  const label = scene.add.text(w / 2, h / 2, text, textStyle(fontSize)).setOrigin(0.5);
  container.add([bg, label]);

  let active = false;
  let enabled = true;
  const paint = (hover: boolean) => {
    const fill = !enabled ? 0x1a1d24 : active ? 0x3a2c12 : hover ? 0x2c3240 : 0x222731;
    bg.setFillStyle(fill, 1);
    bg.setStrokeStyle(active ? 2 : 1, active ? COLORS.accent : COLORS.panelBorder);
    label.setColor(!enabled ? COLORS.textDim : active ? COLORS.accentText : COLORS.text);
  };

  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => paint(true));
  bg.on('pointerout', () => paint(false));
  bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (enabled && pointer.leftButtonDown()) onClick();
  });

  return {
    container,
    bg,
    label,
    setActive(value: boolean) {
      active = value;
      paint(false);
    },
    setEnabled(value: boolean) {
      enabled = value;
      paint(false);
    },
  };
}
