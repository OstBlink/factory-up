// Панель выбранного здания (справа): название, рецепт, буферы, прогресс, кнопка смены рецепта.

import Phaser from 'phaser';
import { BUFFER_MAX, BUILDINGS, COLORS, ITEMS } from '../balance';
import { cycleTime, getRecipe, recipesFor } from '../sim/Buildings';
import { outputBonus, speedMultiplier } from '../sim/Progression';
import type { ItemId, Machine } from '../sim/types';
import type { World } from '../sim/World';
import { makeButton, makePanel, textStyle } from './widgets';
import type { Button } from './widgets';

const WIDTH = 290;

export class BuildingPanel {
  readonly container: Phaser.GameObjects.Container;
  machineId: number | null = null;
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private sub: Phaser.GameObjects.Text;
  private rows: Phaser.GameObjects.Container;
  private rowTexts: { text: Phaser.GameObjects.Text; update: (m: Machine) => string }[] = [];
  private barBg: Phaser.GameObjects.Rectangle;
  private bar: Phaser.GameObjects.Rectangle;
  private status: Phaser.GameObjects.Text;
  private recipeButton: Button;
  private structureKey = '';

  constructor(private scene: Phaser.Scene, onChangeRecipe: (machineId: number) => void) {
    this.container = scene.add.container(0, 0).setVisible(false);
    this.bg = makePanel(scene, WIDTH, 200);
    this.title = scene.add.text(16, 12, '', textStyle(17, COLORS.accentText, true));
    this.sub = scene.add.text(16, 38, '', textStyle(12, COLORS.textDim));
    const close = makeButton(scene, '✕', 28, 26, () => this.hide(), 14);
    close.container.setPosition(WIDTH - 40, 10);
    this.rows = scene.add.container(0, 0);
    this.barBg = scene.add.rectangle(16, 0, WIDTH - 32, 8, 0x000000, 0.5).setOrigin(0, 0);
    this.bar = scene.add.rectangle(16, 0, WIDTH - 32, 8, COLORS.accent).setOrigin(0, 0);
    this.status = scene.add.text(16, 0, '', { ...textStyle(12, COLORS.textDim), wordWrap: { width: WIDTH - 32 } });
    this.recipeButton = makeButton(scene, 'Сменить рецепт', WIDTH - 32, 30, () => {
      if (this.machineId !== null) onChangeRecipe(this.machineId);
    }, 13);
    this.container.add([this.bg, this.title, this.sub, close.container, this.rows, this.barBg, this.bar, this.status, this.recipeButton.container]);
  }

  show(machineId: number): void {
    this.machineId = machineId;
    this.structureKey = '';
    this.container.setVisible(true);
  }

  hide(): void {
    this.machineId = null;
    this.container.setVisible(false);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  layout(screenW: number): void {
    this.container.setPosition(screenW - WIDTH - 12, 90);
  }

  update(world: World): void {
    if (this.machineId === null) return;
    const m = world.entities.get(this.machineId);
    if (!m || m.kind !== 'machine') {
      this.hide();
      return;
    }

    // Состав строк меняется только при смене рецепта или набора предметов во входе.
    const key = `${m.id}|${m.recipe}|${m.cycleRecipe}|${inputItems(m).join(',')}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      this.rebuild(world, m);
    }
    for (const row of this.rowTexts) row.text.setText(row.update(m));

    this.bar.scaleX = m.busy ? Math.min(1, m.progress) : 0;
    this.status.setText(statusText(m));
  }

  private rebuild(world: World, m: Machine): void {
    const s = this.scene;
    const def = BUILDINGS[m.type];
    this.title.setText(def.name);
    const speed = Math.round(speedMultiplier(world, m.type) * 100);
    const bonus = outputBonus(world, m.type);
    this.sub.setText(`Скорость ${speed}% · бонус выхода +${bonus} · цикл ${(cycleTime(m) / speedMultiplier(world, m.type)).toFixed(2)} с`);

    this.rows.removeAll(true);
    this.rowTexts = [];
    let y = 62;
    const addLine = (text: string, color: string = COLORS.text) => {
      this.rows.add(s.add.text(16, y, text, { ...textStyle(13, color), wordWrap: { width: WIDTH - 32 } }));
      y += 22;
    };
    const addItemRow = (item: ItemId, update: (m: Machine) => string) => {
      this.rows.add(s.add.image(26, y + 9, `item_${item}`));
      const text = s.add.text(42, y + 1, update(m), textStyle(13));
      this.rows.add(text);
      this.rowTexts.push({ text, update });
      y += 24;
    };

    // Рецепт
    if (m.type === 'drill') {
      addLine(`Добывает: ${m.ore ? ITEMS[m.ore].name : '—'}`);
    } else if (def.recipeMode === 'select') {
      const r = getRecipe(m.recipe);
      addLine(r ? `Рецепт: ${ITEMS[r.output].name} ×${r.outCount}` : 'Рецепт не выбран', r ? COLORS.text : COLORS.accentText);
    } else {
      const r = getRecipe(m.cycleRecipe);
      addLine(`Рецепт по входу${r ? `: сейчас ${ITEMS[r.output].name}` : ''}`);
    }

    // Входной буфер
    if (m.type !== 'drill') {
      y += 4;
      addLine('Вход:', COLORS.textDim);
      const items = inputItems(m);
      if (items.length === 0) {
        const accepts = [...new Set(recipesFor(m.type).flatMap((r) => r.inputs.map((i) => ITEMS[i.item].label)))];
        addLine(def.recipeMode === 'auto' ? `пусто · принимает: ${accepts.join(', ')}` : 'пусто', COLORS.textDim);
      }
      const r = getRecipe(m.recipe);
      for (const item of items) {
        const need = r?.inputs.find((i) => i.item === item)?.count;
        addItemRow(item, (mm) => `${ITEMS[item].name}: ${mm.inBuf[item] ?? 0} / ${BUFFER_MAX}${need ? ` (нужно ${need})` : ''}`);
      }
    }

    // Выходной буфер
    y += 4;
    addLine('Выход:', COLORS.textDim);
    const outItem = m.type === 'drill' ? m.ore : getRecipe(m.recipe ?? m.cycleRecipe)?.output ?? null;
    if (outItem) addItemRow(outItem, (mm) => `${ITEMS[outItem].name}: ${mm.outBuf.length} / ${BUFFER_MAX}`);
    else addLine('пусто', COLORS.textDim);

    y += 8;
    this.barBg.setY(y);
    this.bar.setY(y);
    this.status.setY(y + 14);
    y += 50;
    const selectable = def.recipeMode === 'select';
    this.recipeButton.container.setVisible(selectable).setPosition(16, y);
    if (selectable) {
      this.recipeButton.label.setText(m.recipe ? 'Сменить рецепт' : 'Выбрать рецепт');
      y += 42;
    }
    this.bg.setSize(WIDTH, y);
  }
}

/** Какие предметы показать во входе: ингредиенты выбранного рецепта или то, что лежит в буфере. */
function inputItems(m: Machine): ItemId[] {
  const r = getRecipe(m.recipe);
  if (r) return r.inputs.map((i) => i.item);
  return (Object.keys(m.inBuf) as ItemId[]).filter((i) => (m.inBuf[i] ?? 0) > 0);
}

function statusText(m: Machine): string {
  if (BUILDINGS[m.type].recipeMode === 'select' && m.recipe === null) return 'Выбери рецепт';
  if (m.busy) return `Работает · ${Math.floor(m.progress * 100)}%`;
  if (m.outBuf.length >= BUFFER_MAX) return 'Выход заполнен — подведи ленту к оранжевой стрелке';
  return 'Ждёт ингредиенты (зелёные стрелки — входы)';
}
