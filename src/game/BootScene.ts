// Генерация всех текстур кодом (внешних картинок нет): предметы, ленты, здания, логистика и рельеф карты.
// Форма предмета зависит от тира: 0 — круг, 1 — квадрат, 2 — ромб, 3 — шестиугольник, 4 — звезда, 5 — крупная звезда.

import Phaser from 'phaser';
import {
  BASE_SIZE, BUILDINGS, CELL, COLORS, DEPOSITS, DEPOSIT_SIZE, ITEMS, MAP_H, MAP_W, OBSTACLES,
} from './balance';
import { MACHINE_TYPES } from './sim/types';
import type { ItemId } from './sim/types';

/** Размер текстуры предмета. */
export const ITEM_TEX = 20;
/** Кадров анимации ленты (шевроны сдвигаются на 2 px за кадр). */
export const BELT_FRAMES = 8;

/** Смешивает два цвета: t = 0 — первый, t = 1 — второй. */
export function mixColor(a: number, b: number, t: number): number {
  const ca = Phaser.Display.Color.IntegerToColor(a);
  const cb = Phaser.Display.Color.IntegerToColor(b);
  const r = Math.round(ca.red + (cb.red - ca.red) * t);
  const g = Math.round(ca.green + (cb.green - ca.green) * t);
  const bl = Math.round(ca.blue + (cb.blue - ca.blue) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Детерминированное «случайное» число 0..1 по координатам клетки. */
export function cellHash(x: number, y: number, salt = 0): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Точки правильной звезды или многоугольника вокруг (cx, cy). */
function starPoints(cx: number, cy: number, spikes: number, outer: number, inner: number): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

function polygonPoints(cx: number, cy: number, sides: number, r: number, rotation: number): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * Math.PI * 2) / sides;
    pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const g = this.make.graphics({}, false);
    this.makeItemTextures(g);
    this.makeBeltTextures(g);
    this.makeLogisticTextures(g);
    this.makeMachineTextures(g);
    this.makeMiscTextures(g);
    this.makeTerrainTexture(g);
    g.destroy();
    this.scene.start('MenuScene');
  }

  /** Рисует фигуру предмета по тиру (круг, квадрат, ромб, шестиугольник, звезда, крупная звезда). */
  private drawItemShape(g: Phaser.GameObjects.Graphics, id: ItemId, cx: number, cy: number): void {
    const def = ITEMS[id];
    const outline = 0x0b0d10;
    g.fillStyle(def.color, 1);
    g.lineStyle(2, outline, 1);
    switch (def.tier) {
      case 0:
        g.fillCircle(cx, cy, 6);
        g.strokeCircle(cx, cy, 6);
        break;
      case 1:
        g.fillRect(cx - 5.5, cy - 5.5, 11, 11);
        g.strokeRect(cx - 5.5, cy - 5.5, 11, 11);
        break;
      case 2: {
        const pts = polygonPoints(cx, cy, 4, 7.5, -Math.PI / 2);
        g.fillPoints(pts, true);
        g.strokePoints(pts, true);
        break;
      }
      case 3: {
        const pts = polygonPoints(cx, cy, 6, 7.5, 0);
        g.fillPoints(pts, true);
        g.strokePoints(pts, true);
        break;
      }
      case 4: {
        const pts = starPoints(cx, cy, 5, 8.5, 4);
        g.fillPoints(pts, true);
        g.strokePoints(pts, true);
        break;
      }
      default: {
        const pts = starPoints(cx, cy, 5, 9.5, 4.6);
        g.fillPoints(pts, true);
        g.lineStyle(2, 0xffffff, 1);
        g.strokePoints(pts, true);
        break;
      }
    }
  }

  private makeItemTextures(g: Phaser.GameObjects.Graphics): void {
    for (const id of Object.keys(ITEMS) as ItemId[]) {
      g.clear();
      this.drawItemShape(g, id, ITEM_TEX / 2, ITEM_TEX / 2);
      g.generateTexture(`item_${id}`, ITEM_TEX, ITEM_TEX);
    }
  }

  /** Лента «смотрит» вверх; кадр k сдвигает шевроны вверх на 2k px. Поворот делает отрисовка. */
  private makeBeltTextures(g: Phaser.GameObjects.Graphics): void {
    const period = CELL / 2;
    for (let k = 0; k < BELT_FRAMES; k++) {
      g.clear();
      g.fillStyle(COLORS.beltBase, 1);
      g.fillRect(3, 0, CELL - 6, CELL);
      g.fillStyle(0x30343c, 1);
      g.fillRect(3, 0, 2, CELL);
      g.fillRect(CELL - 5, 0, 2, CELL);
      g.lineStyle(2, COLORS.beltChevron, 1);
      for (let j = -1; j <= 2; j++) {
        const y = j * period - k * (period / BELT_FRAMES) + period;
        g.lineBetween(10, y + 5, 16, y);
        g.lineBetween(16, y, 22, y + 5);
      }
      g.generateTexture(`belt${k}`, CELL, CELL);
    }
  }

  private makeLogisticTextures(g: Phaser.GameObjects.Graphics): void {
    const arrow = (cx: number, cy: number, dir: number, len: number, color: number) => {
      // Стрелка из центра (cx, cy) в направлении dir (0 вверх, 1 вправо, ...).
      const dx = [0, 1, 0, -1][dir];
      const dy = [-1, 0, 1, 0][dir];
      const tipX = cx + dx * len;
      const tipY = cy + dy * len;
      g.lineStyle(3, color, 1);
      g.lineBetween(cx, cy, tipX - dx * 3, tipY - dy * 3);
      g.fillStyle(color, 1);
      g.fillTriangle(
        tipX + dx * 2, tipY + dy * 2,
        tipX - dx * 5 + dy * 5, tipY - dy * 5 + dx * 5,
        tipX - dx * 5 - dy * 5, tipY - dy * 5 - dx * 5,
      );
    };
    const box = (type: 'merger' | 'splitter' | 'bridge') => {
      const def = BUILDINGS[type];
      g.clear();
      g.fillStyle(def.color, 1);
      g.fillRoundedRect(2, 2, CELL - 4, CELL - 4, 6);
      g.lineStyle(2, def.border, 1);
      g.strokeRoundedRect(2, 2, CELL - 4, CELL - 4, 6);
    };

    // Объединитель: три коротких входа сходятся, большая стрелка вперёд (вверх).
    box('merger');
    g.lineStyle(2, 0x9cc3ee, 0.8);
    g.lineBetween(16, 27, 16, 16);
    g.lineBetween(6, 16, 16, 16);
    g.lineBetween(26, 16, 16, 16);
    arrow(16, 16, 0, 10, 0xffffff);
    g.generateTexture('merger', CELL, CELL);

    // Сплиттер: вход снизу, стрелки налево, вперёд и направо.
    box('splitter');
    g.lineStyle(2, 0xf5d48a, 0.8);
    g.lineBetween(16, 27, 16, 16);
    arrow(16, 16, 3, 9, 0xffffff);
    arrow(16, 16, 0, 9, 0xffffff);
    arrow(16, 16, 1, 9, 0xffffff);
    g.generateTexture('splitter', CELL, CELL);

    // Мост: два независимых потока крест-накрест.
    box('bridge');
    g.fillStyle(0x2a2a38, 1);
    g.fillRect(12, 4, 8, CELL - 8);
    g.fillStyle(0x50506a, 1);
    g.fillRect(4, 12, CELL - 8, 8);
    g.lineStyle(2, BUILDINGS.bridge.border, 1);
    g.strokeRect(4, 12, CELL - 8, 8);
    g.generateTexture('bridge', CELL, CELL);
  }

  /** Корпус здания без портов (стрелки портов рисуются отдельно, их положение зависит от поворота). */
  private makeMachineTextures(g: Phaser.GameObjects.Graphics): void {
    for (const type of MACHINE_TYPES) {
      const def = BUILDINGS[type];
      const s = def.size * CELL;
      g.clear();
      g.fillStyle(0x000000, 0.35);
      g.fillRoundedRect(3, 5, s - 6, s - 6, 10);
      g.fillStyle(def.color, 1);
      g.fillRoundedRect(3, 3, s - 6, s - 6, 10);
      g.lineStyle(2, def.border, 1);
      g.strokeRoundedRect(3, 3, s - 6, s - 6, 10);
      g.fillStyle(mixColor(def.color, 0x000000, 0.25), 1);
      g.fillRoundedRect(12, 12, s - 24, s - 24, 8);
      g.lineStyle(1, mixColor(def.border, def.color, 0.5), 1);
      g.strokeRoundedRect(12, 12, s - 24, s - 24, 8);
      // Заклёпки по углам — чтобы здание выглядело «железным».
      g.fillStyle(def.border, 1);
      for (const [rx, ry] of [[8, 8], [s - 8, 8], [8, s - 8], [s - 8, s - 8]]) g.fillCircle(rx, ry, 2);
      g.generateTexture(`bld_${type}`, s, s);
    }

    // База 7×7.
    const s = BASE_SIZE * CELL;
    g.clear();
    g.fillStyle(COLORS.base, 1);
    g.fillRoundedRect(2, 2, s - 4, s - 4, 14);
    g.lineStyle(3, COLORS.baseBorder, 1);
    g.strokeRoundedRect(2, 2, s - 4, s - 4, 14);
    g.lineStyle(1, mixColor(COLORS.baseBorder, COLORS.base, 0.6), 1);
    g.strokeRoundedRect(14, 14, s - 28, s - 28, 10);
    g.fillStyle(mixColor(COLORS.base, 0x000000, 0.3), 1);
    g.fillCircle(s / 2, s / 2, 46);
    g.lineStyle(3, COLORS.baseBorder, 0.8);
    g.strokeCircle(s / 2, s / 2, 46);
    g.generateTexture('base', s, s);
  }

  private makeMiscTextures(g: Phaser.GameObjects.Graphics): void {
    // Стрелки портов (смотрят вверх): вход — зелёная, выход — оранжевая.
    for (const [key, color] of [['port_in', 0x7fd18b], ['port_out', COLORS.accent]] as const) {
      g.clear();
      g.fillStyle(0x0b0d10, 0.9);
      g.fillTriangle(7, 0, 14, 11, 0, 11);
      g.fillStyle(color, 1);
      g.fillTriangle(7, 2, 12, 10, 2, 10);
      g.generateTexture(key, 14, 12);
    }

    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillPoints(starPoints(8, 8, 5, 8, 3.5), true);
    g.generateTexture('star', 16, 16);

    // Мягкое пятно света — блики на воде и вспышки.
    g.clear();
    for (let r = 32; r > 0; r -= 2) {
      g.fillStyle(0xffffff, 0.05);
      g.fillCircle(32, 32, r);
    }
    g.generateTexture('glow', 64, 64);

    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 4, 4);
    g.generateTexture('px', 4, 4);
  }

  /** Статичный рельеф всей карты одной текстурой: фон, сетка, месторождения, скалы, вода. */
  private makeTerrainTexture(g: Phaser.GameObjects.Graphics): void {
    const W = MAP_W * CELL;
    const H = MAP_H * CELL;
    g.clear();
    g.fillStyle(COLORS.mapBg, 1);
    g.fillRect(0, 0, W, H);
    g.fillStyle(COLORS.grid, 1);
    for (let x = 0; x <= MAP_W; x++) g.fillRect(x * CELL, 0, 1, H);
    for (let y = 0; y <= MAP_H; y++) g.fillRect(0, y * CELL, W, 1);

    // Месторождения: участок земли цвета руды с «вкраплениями».
    for (const d of DEPOSITS) {
      const color = ITEMS[d.ore].color;
      const px = d.x * CELL;
      const py = d.y * CELL;
      const size = DEPOSIT_SIZE * CELL;
      g.fillStyle(mixColor(color, COLORS.mapBg, 0.72), 1);
      g.fillRoundedRect(px + 2, py + 2, size - 4, size - 4, 12);
      g.lineStyle(2, mixColor(color, COLORS.mapBg, 0.35), 1);
      g.strokeRoundedRect(px + 2, py + 2, size - 4, size - 4, 12);
      for (let i = 0; i < 16; i++) {
        const sx = px + 10 + cellHash(d.x, d.y, i) * (size - 20);
        const sy = py + 10 + cellHash(d.y, d.x, i + 50) * (size - 20);
        const r = 2 + cellHash(d.x + i, d.y, 7) * 3.5;
        g.fillStyle(mixColor(color, COLORS.mapBg, 0.15 + cellHash(i, d.x, 3) * 0.3), 1);
        g.fillCircle(sx, sy, r);
      }
    }

    for (const o of OBSTACLES) {
      const px = o.x * CELL;
      const py = o.y * CELL;
      const w = o.w * CELL;
      const h = o.h * CELL;
      if (o.type === 'water') {
        g.fillStyle(COLORS.waterA, 1);
        g.fillRoundedRect(px + 1, py + 1, w - 2, h - 2, 14);
        for (let y = o.y; y < o.y + o.h; y++) {
          for (let x = o.x; x < o.x + o.w; x++) {
            if (cellHash(x, y) < 0.5) continue;
            g.fillStyle(COLORS.waterB, 1);
            g.fillRoundedRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL - 8, 6);
          }
        }
        // Мелкие волны.
        g.lineStyle(1, mixColor(COLORS.waterB, 0xffffff, 0.12), 1);
        for (let y = o.y; y < o.y + o.h; y++) {
          const wx = px + 10 + cellHash(o.x, y, 9) * (w - 40);
          g.lineBetween(wx, y * CELL + 16, wx + 14, y * CELL + 16);
        }
        g.lineStyle(2, COLORS.waterEdge, 1);
        g.strokeRoundedRect(px + 1, py + 1, w - 2, h - 2, 14);
      } else {
        // Скалы: блоки с фаской и оттенком, зависящим от координат клетки.
        g.fillStyle(mixColor(COLORS.rockA, 0x000000, 0.3), 1);
        g.fillRoundedRect(px, py, w, h, 8);
        for (let y = o.y; y < o.y + o.h; y++) {
          for (let x = o.x; x < o.x + o.w; x++) {
            const base = mixColor(COLORS.rockA, COLORS.rockB, cellHash(x, y));
            const cx = x * CELL + 2;
            const cy = y * CELL + 2;
            const s = CELL - 4;
            g.fillStyle(base, 1);
            g.fillRoundedRect(cx, cy, s, s, 5);
            g.fillStyle(mixColor(base, 0xffffff, 0.18), 1);
            g.fillRect(cx + 3, cy + 1, s - 6, 3);
            g.fillRect(cx + 1, cy + 3, 3, s - 6);
            g.fillStyle(mixColor(base, 0x000000, 0.35), 1);
            g.fillRect(cx + 3, cy + s - 4, s - 6, 3);
            g.fillRect(cx + s - 4, cy + 3, 3, s - 6);
            if (cellHash(x, y, 2) > 0.6) {
              g.lineStyle(1, mixColor(base, 0x000000, 0.4), 1);
              g.lineBetween(cx + 8, cy + 9, cx + 16, cy + 17);
            }
          }
        }
        g.lineStyle(2, COLORS.rockEdge, 1);
        g.strokeRoundedRect(px, py, w, h, 8);
      }
    }
    // Рамка по краю карты.
    g.lineStyle(2, COLORS.panelBorder, 1);
    g.strokeRect(1, 1, W - 2, H - 2);
    g.generateTexture('terrain', W, H);
  }
}
