// HUD поверх игры (своя неподвижная камера): уровень и опыт, задание, кнопки режимов,
// меню построек, панель здания, выбор рецепта, карточки улучшений, подсказки и обучение.

import Phaser from 'phaser';
import { BUILDINGS, COLORS, ITEMS, PHASE2_LEVEL, PHASE2_SPEED_MULT } from './balance';
import type { GameScene, Mode } from './GameScene';
import { xpToNext } from './sim/Progression';
import type { BuildingType, GameEvent, Machine } from './sim/types';
import type { World } from './sim/World';
import { Sound } from './Sound';
import { BuildMenu } from './ui/BuildMenu';
import { BuildingPanel } from './ui/BuildingPanel';
import { RecipePicker } from './ui/RecipePicker';
import { UpgradeCards } from './ui/UpgradeCards';
import { GoalGuide } from './ui/GoalGuide';
import { formatNumber, makeAttentionRing, makeButton, makePanel, pulseRing, stopRing, textStyle } from './ui/widgets';
import type { Button } from './ui/widgets';

/** Тексты обучения по шагам (шаг хранится в мире и сохраняется). */
const TUTORIAL_TEXT = [
  'Шаг 1: поставь бур на железное месторождение — нажми B, выбери «Бур» и кликни по подсвеченному месторождению',
  'Шаг 2: нажми Q и протяни конвейер от бура (оранжевая стрелка) к базе — зажми ЛКМ и тяни',
  'Отлично! База принимает любые ресурсы — за них даётся опыт. Выполняй задания, чтобы расти',
];

export class UIScene extends Phaser.Scene {
  private gameScene!: GameScene;

  // Верх слева: уровень и опыт
  private levelPanel!: Phaser.GameObjects.Container;
  private levelText!: Phaser.GameObjects.Text;
  private xpText!: Phaser.GameObjects.Text;
  private xpBar!: Phaser.GameObjects.Rectangle;
  private xpShown = 0;

  // Верх по центру: задание
  private goalPanel!: Phaser.GameObjects.Container;
  private goalIcon!: Phaser.GameObjects.Image;
  private goalName!: Phaser.GameObjects.Text;
  private goalCount!: Phaser.GameObjects.Text;
  private goalBar!: Phaser.GameObjects.Rectangle;
  private goalShown = 0;

  // Кнопки
  private buildButton!: Button;
  private beltButton!: Button;
  private deleteButton!: Button;
  private menuToggle!: Button;
  private pauseButton!: Button;
  private modeHint!: Phaser.GameObjects.Text;

  // Подсказки и уведомления
  private toast!: Phaser.GameObjects.Text;
  private notice!: Phaser.GameObjects.Text;
  private tutorialBox!: Phaser.GameObjects.Container;
  private tutorialBg!: Phaser.GameObjects.Rectangle;
  private tutorialText!: Phaser.GameObjects.Text;
  /** Пульсирующая рамка вокруг плашки обучения — чтобы на неё смотрели в первую очередь. */
  private tutorialRing!: Phaser.GameObjects.Rectangle;
  private tutorialShown = -1;
  private goalGuide!: GoalGuide;

  // Верх справа: фаза и таймер игрового времени
  private timerPanel!: Phaser.GameObjects.Container;
  private timerText!: Phaser.GameObjects.Text;
  /** Подсказка под таймером, как попасть в фазу 2 (видна только в фазе 1). */
  private phaseHint!: Phaser.GameObjects.Text;
  /** Уведомление об открытии ждёт, пока игрок выберет улучшение. */
  private pendingNotice = '';

  private buildMenu!: BuildMenu;
  private buildingPanel!: BuildingPanel;
  private recipePicker!: RecipePicker;
  private cards!: UpgradeCards;

  constructor() {
    super('UIScene');
  }

  private get world(): World {
    return this.gameScene.world;
  }

  create(): void {
    this.gameScene = this.scene.get('GameScene') as GameScene;
    this.tutorialShown = -1;
    this.pendingNotice = '';
    this.xpShown = 0;
    this.goalShown = 0;

    this.createLevelPanel();
    this.createGoalPanel();
    this.createButtons();
    this.createTimer();
    this.createMessages();
    this.goalGuide = new GoalGuide(this);

    this.buildMenu = new BuildMenu(this, (type) => this.pickBuilding(type));
    this.buildingPanel = new BuildingPanel(this, (id) => this.openRecipePicker(id));
    this.recipePicker = new RecipePicker(this, (id, recipe) => {
      this.world.setRecipe(id, recipe);
      Sound.click();
    });
    this.cards = new UpgradeCards(this, (id) => {
      this.world.chooseUpgrade(id);
      this.cards.hide();
      Sound.click();
      if (this.pendingNotice && !this.world.upgradeChoices) {
        this.showNotice(this.pendingNotice);
        this.pendingNotice = '';
      }
    });
    this.cards.container.setDepth(50);
    this.notice.setDepth(60);

    // Сообщения от сцены игры.
    const g = this.gameScene.events;
    g.on('mode', this.onModeChanged, this);
    g.on('hint', this.showToast, this);
    g.on('select', this.onSelect, this);
    g.on('pickRecipe', this.openRecipePicker, this);
    g.on('removed', this.onRemoved, this);
    g.on('sim', this.onSimEvent, this);
    this.events.once('shutdown', () => {
      g.off('mode', this.onModeChanged, this);
      g.off('hint', this.showToast, this);
      g.off('select', this.onSelect, this);
      g.off('pickRecipe', this.openRecipePicker, this);
      g.off('removed', this.onRemoved, this);
      g.off('sim', this.onSimEvent, this);
      this.scale.off('resize', this.layout, this);
    });

    // Клавиши 1–4 выбирают карточку улучшения.
    ['ONE', 'TWO', 'THREE', 'FOUR'].forEach((key, i) => this.input.keyboard?.on(`keydown-${key}`, () => this.cards.pick(i)));

    this.scale.on('resize', this.layout, this);
    this.layout();
    this.onModeChanged(this.gameScene.mode, this.gameScene.buildType);
  }

  // ---------------------------------------------------------------------------
  // Создание элементов
  // ---------------------------------------------------------------------------

  private createLevelPanel(): void {
    this.levelPanel = this.add.container(12, 12);
    const bg = makePanel(this, 260, 66);
    this.levelText = this.add.text(14, 10, '', textStyle(18, COLORS.accentText, true));
    const barBg = this.add.rectangle(14, 38, 232, 10, 0x000000, 0.5).setOrigin(0, 0);
    barBg.setRounded(4);
    this.xpBar = this.add.rectangle(14, 38, 232, 10, COLORS.accent).setOrigin(0, 0);
    this.xpText = this.add.text(246, 13, '', textStyle(12, COLORS.textDim)).setOrigin(1, 0);
    this.levelPanel.add([bg, this.levelText, barBg, this.xpBar, this.xpText]);
  }

  private createGoalPanel(): void {
    this.goalPanel = this.add.container(0, 12);
    const bg = makePanel(this, 360, 66).setStrokeStyle(1, COLORS.accent);
    const caption = this.add.text(56, 8, 'ЗАДАНИЕ БАЗЫ', textStyle(11, COLORS.textDim, true));
    this.goalIcon = this.add.image(30, 33, 'item_iron_ore').setScale(1.7);
    this.goalName = this.add.text(56, 22, '', textStyle(15, COLORS.text, true));
    this.goalCount = this.add.text(346, 22, '', textStyle(15, COLORS.accentText, true)).setOrigin(1, 0);
    const barBg = this.add.rectangle(56, 46, 290, 8, 0x000000, 0.5).setOrigin(0, 0);
    this.goalBar = this.add.rectangle(56, 46, 290, 8, COLORS.good).setOrigin(0, 0);
    this.goalPanel.add([bg, caption, this.goalIcon, this.goalName, this.goalCount, barBg, this.goalBar]);
  }

  private createButtons(): void {
    this.menuToggle = makeButton(this, '☰  Постройки (B)', 180, 34, () => this.toggleBuildMenu());
    this.buildButton = makeButton(this, 'Строить (B)', 140, 40, () => this.toggleBuildMenu(), 15);
    this.beltButton = makeButton(this, 'Конвейер (Q)', 140, 40, () => this.gameScene.setMode(this.gameScene.mode === 'belt' ? 'normal' : 'belt'), 15);
    this.deleteButton = makeButton(this, 'Удалить (E)', 140, 40, () => this.gameScene.setMode(this.gameScene.mode === 'delete' ? 'normal' : 'delete'), 15);
    this.pauseButton = makeButton(this, 'Пауза (P)', 120, 34, () => this.gameScene.openPause(), 13);
    this.modeHint = this.add.text(0, 0, '', textStyle(13, COLORS.textDim)).setOrigin(0.5, 1);
    this.modeHint.setStroke('#0f1115', 4);
  }

  private createTimer(): void {
    this.timerPanel = this.add.container(0, 12);
    const bg = makePanel(this, 150, 34);
    this.timerText = this.add.text(75, 17, '', textStyle(14, COLORS.text, true)).setOrigin(0.5);
    this.timerPanel.add([bg, this.timerText]);

    this.phaseHint = this.add.text(0, 0, `Для перехода на фазу 2 получите ${PHASE2_LEVEL}-й уровень`,
      textStyle(13, COLORS.accentText, true)).setOrigin(1, 0);
    this.phaseHint.setStroke('#0f1115', 4);
  }

  private createMessages(): void {
    this.toast = this.add.text(0, 0, '', { ...textStyle(15, '#ffd6d6', true), backgroundColor: '#2a1618', padding: { x: 12, y: 6 } })
      .setOrigin(0.5).setAlpha(0);
    this.notice = this.add.text(0, 0, '', { ...textStyle(20, COLORS.accentText, true), backgroundColor: '#171a21', padding: { x: 18, y: 10 }, align: 'center' })
      .setOrigin(0.5).setAlpha(0);

    this.tutorialBox = this.add.container(0, 0).setVisible(false);
    this.tutorialBg = makePanel(this, 400, 60, 0.97).setStrokeStyle(2, COLORS.accent);
    this.tutorialText = this.add.text(16, 12, '', { ...textStyle(15, COLORS.text, true), wordWrap: { width: 560 } });
    this.tutorialRing = makeAttentionRing(this, COLORS.accent);
    this.tutorialBox.add([this.tutorialRing, this.tutorialBg, this.tutorialText]);
  }

  // ---------------------------------------------------------------------------
  // Расположение (перестраивается при изменении размера окна)
  // ---------------------------------------------------------------------------

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.cameras.main.setSize(w, h);

    this.levelPanel.setPosition(12, 12);
    this.goalPanel.setPosition(Math.round(w / 2 - 180), 12);
    this.menuToggle.container.setPosition(12, 88);
    this.buildMenu.layout(12, 130);
    this.buildingPanel.layout(w);
    this.pauseButton.container.setPosition(w - 132, 12);
    this.timerPanel.setPosition(w - 132 - 12 - 150, 12);
    this.phaseHint.setPosition(w - 12, 54);
    this.goalGuide.layout(w);

    const barW = 3 * 140 + 2 * 10;
    const bx = Math.round(w / 2 - barW / 2);
    this.buildButton.container.setPosition(bx, h - 52);
    this.beltButton.container.setPosition(bx + 150, h - 52);
    this.deleteButton.container.setPosition(bx + 300, h - 52);
    this.modeHint.setPosition(w / 2, h - 60);

    this.toast.setPosition(w / 2, h - 96);
    this.notice.setPosition(w / 2, Math.round(h * 0.3));
    this.layoutTutorial();
    this.recipePicker.layout(w, h);
    this.cards.layout(w, h);
  }

  private layoutTutorial(): void {
    const w = this.scale.width;
    const maxW = Math.min(620, w - 24);
    this.tutorialText.setWordWrapWidth(maxW - 32);
    const boxW = Math.min(maxW, this.tutorialText.width + 32);
    const boxH = this.tutorialText.height + 24;
    this.tutorialBg.setSize(boxW, boxH);
    this.tutorialRing.setSize(boxW, boxH).setPosition(boxW / 2, boxH / 2);
    this.tutorialBox.setPosition(Math.round(w / 2 - boxW / 2), 90);
  }

  // ---------------------------------------------------------------------------
  // Покадровое обновление
  // ---------------------------------------------------------------------------

  update(): void {
    const world = this.world;

    // Уровень и плавное заполнение полосы опыта.
    const need = xpToNext(world.level);
    this.levelText.setText(`Уровень ${world.level}`);
    this.xpText.setText(`${formatNumber(world.xp)} / ${need} опыта`);
    const xpFrac = Math.min(1, world.xp / need);
    this.xpShown = xpFrac < this.xpShown ? xpFrac : this.xpShown + (xpFrac - this.xpShown) * 0.15;
    this.xpBar.scaleX = this.xpShown;

    // Задание.
    const goal = world.goal;
    this.goalIcon.setTexture(`item_${goal.item}`);
    this.goalName.setText(ITEMS[goal.item].name);
    this.goalCount.setText(`${goal.delivered} / ${goal.amount}`);
    const goalFrac = goal.delivered / goal.amount;
    this.goalShown = goalFrac < this.goalShown ? goalFrac : this.goalShown + (goalFrac - this.goalShown) * 0.2;
    this.goalBar.scaleX = this.goalShown;

    // Карточки улучшений: показываем, пока мир ждёт выбора.
    if (world.upgradeChoices && !this.cards.visible) {
      this.recipePicker.hide();
      this.buildMenu.setOpen(false);
      this.cards.show(world);
    }

    // Фаза и игровое время (на паузе не идёт — время считает сама симуляция).
    this.timerText.setText(`Фаза ${world.phase} · ${formatTime(world.playTime)}`);
    this.phaseHint.setVisible(world.phase === 1);

    this.buildMenu.update(world);
    this.buildingPanel.update(world);
    this.goalGuide.update(world);
    this.updateTutorial();
  }

  private updateTutorial(): void {
    const step = this.world.tutorial;
    if (step === this.tutorialShown) return;
    this.tutorialShown = step;
    const text = TUTORIAL_TEXT[step];
    if (!text) {
      this.tweens.add({ targets: this.tutorialBox, alpha: 0, duration: 400, onComplete: () => this.tutorialBox.setVisible(false) });
      stopRing(this, this.tutorialRing);
      return;
    }
    this.tutorialText.setText(text);
    const color = step === 2 ? COLORS.good : COLORS.accent;
    this.tutorialBg.setStrokeStyle(2, color);
    this.tutorialRing.setStrokeStyle(3, color);
    this.layoutTutorial();
    this.tutorialBox.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.tutorialBox, alpha: 1, duration: 300 });
    pulseRing(this, this.tutorialRing, -1);
  }

  // ---------------------------------------------------------------------------
  // Реакции на события
  // ---------------------------------------------------------------------------

  private onModeChanged(mode: Mode, type: BuildingType | null): void {
    this.buildButton.setActive(mode === 'build');
    this.beltButton.setActive(mode === 'belt');
    this.deleteButton.setActive(mode === 'delete');
    const hints: Record<Mode, string> = {
      normal: 'Клик по зданию — информация · B — постройки · Q — конвейер · E — удалить · WASD, колесо, средняя кнопка — камера',
      build: `Режим: строительство «${type ? BUILDINGS[type].name : ''}» · ЛКМ — поставить · R — поворот выхода · Esc — выход`,
      belt: 'Режим: конвейер (Q) · зажми ЛКМ и тяни · клик — одна клетка · R — поворот · Esc — выход',
      delete: 'Режим: удаление (E) · ЛКМ или протяжка удаляет · Esc — выход',
    };
    this.modeHint.setText(hints[mode]);
  }

  private onSelect(machineId: number | null): void {
    if (machineId === null) this.buildingPanel.hide();
    else this.buildingPanel.show(machineId);
  }

  private onRemoved(entityId: number): void {
    if (this.buildingPanel.machineId === entityId) this.buildingPanel.hide();
    this.recipePicker.hide();
  }

  private openRecipePicker(machineId: number): void {
    const m = this.world.entities.get(machineId);
    if (!m || m.kind !== 'machine') return;
    this.buildingPanel.show(machineId);
    this.recipePicker.show(m as Machine);
  }

  private onSimEvent(ev: GameEvent): void {
    if (ev.type === 'unlock') {
      const names = ev.types.map((t) => BUILDINGS[t].name).join(', ');
      const text = `Открыто: ${names}!  Смотри меню построек (B)`;
      this.pendingNotice = this.pendingNotice ? `${this.pendingNotice}
${text}` : text;
      this.tweens.add({ targets: this.menuToggle.container, scale: 1.1, duration: 200, yoyo: true, repeat: 5 });
    }
    if (ev.type === 'levelUp') {
      this.tweens.add({ targets: this.levelPanel, scale: 1.08, duration: 160, yoyo: true, ease: 'Quad.easeOut' });
    }
    if (ev.type === 'phase') this.showPhase(ev.phase);
    if (ev.type === 'goalDone') {
      this.tweens.add({ targets: this.goalPanel, scale: 1.05, duration: 160, yoyo: true, ease: 'Quad.easeOut' });
      this.goalShown = 0;
    }
  }

  private pickBuilding(type: BuildingType): void {
    this.gameScene.setMode('build', type);
    this.buildMenu.setOpen(false);
    Sound.click();
  }

  private showToast(text: string): void {
    this.toast.setText(text);
    this.tweens.killTweensOf(this.toast);
    this.toast.setAlpha(1);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1300, duration: 400 });
  }

  /** Крупная надпись о начале новой фазы поверх всего экрана. */
  private showPhase(phase: number): void {
    const w = this.scale.width;
    const y = Math.round(this.scale.height * 0.4);
    const band = this.add.rectangle(w / 2, y, w, 150, 0x05070a, 0.85);
    const title = this.add.text(w / 2, y - 22, `Фаза ${phase}`, textStyle(60, COLORS.accentText, true)).setOrigin(0.5);
    title.setStroke('#0f1115', 8);
    const sub = this.add.text(w / 2, y + 40, `Всё производство было ускорено в ${PHASE2_SPEED_MULT} раза`, textStyle(22, COLORS.text, true)).setOrigin(0.5);
    const parts = [band, title, sub];
    for (const o of parts) o.setDepth(70);

    band.scaleY = 0;
    title.setScale(0.3).setAlpha(0);
    sub.setAlpha(0);
    this.tweens.add({ targets: band, scaleY: 1, duration: 250, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: title, scale: 1, alpha: 1, delay: 120, duration: 450, ease: 'Back.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, delay: 400, duration: 400 });
    this.tweens.add({
      targets: parts, alpha: 0, delay: 4000, duration: 600,
      onComplete: () => parts.forEach((o) => o.destroy()),
    });
    this.tweens.add({ targets: this.timerPanel, scale: 1.12, duration: 200, yoyo: true, repeat: 3 });
  }

  private showNotice(text: string): void {
    this.notice.setText(text);
    this.tweens.killTweensOf(this.notice);
    this.notice.setAlpha(0).setScale(0.8);
    this.tweens.add({ targets: this.notice, alpha: 1, scale: 1, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.notice, alpha: 0, delay: 3500, duration: 500 });
  }

  // ---------------------------------------------------------------------------
  // Вызывается из GameScene
  // ---------------------------------------------------------------------------

  toggleBuildMenu(): void {
    if (this.cards.visible) return;
    this.buildMenu.toggle();
  }

  /** Закрывает верхнее открытое окно. Возвращает false, если закрывать было нечего. */
  closePanels(): boolean {
    if (this.recipePicker.visible) {
      this.recipePicker.hide();
      return true;
    }
    if (this.buildMenu.isOpen) {
      this.buildMenu.setOpen(false);
      return true;
    }
    if (this.buildingPanel.visible) {
      this.buildingPanel.hide();
      return true;
    }
    return false;
  }

  /** Находится ли курсор над элементом интерфейса (тогда карта клик не получает). */
  isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
    return this.input.hitTestPointer(pointer).length > 0;
  }
}

/** Время в виде мм:сс (или ч:мм:сс после часа игры). */
function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
