// Сцена игры: камера, режимы (постройка, конвейер, удаление), ввод на карте и цикл симуляции
// с фиксированным шагом. Правила игры живут в sim/, здесь только ввод → команды миру и отрисовка.

import Phaser from 'phaser';
import {
  AUTOSAVE_INTERVAL, BASE_SIZE, BASE_X, BASE_Y, BUILDINGS, CAMERA_EDGE_MARGIN, CAMERA_MAX_ZOOM, CAMERA_PAN_SPEED, CAMERA_ZOOM_STEP,
  CELL, COLORS, DEPOSITS, DEPOSIT_SIZE, MAP_H, MAP_W, TICKS_PER_SECOND, TUTORIAL_DEPOSIT, TUTORIAL_LAST_HINT_TIME,
} from './balance';
import { checkMap } from './sim/MapCheck';
import { clearSave, loadGame, saveGame } from './sim/Save';
import type { CameraState } from './sim/Save';
import { canLayBelt, planBeltRoute } from './sim/BeltRoute';
import type { PathCell } from './sim/BeltRoute';
import { isMachineType, opposite, turnLeft, turnRight } from './sim/types';
import type { BuildingType, Dir } from './sim/types';
import { TERRAIN_ROCK, TERRAIN_WATER, World } from './sim/World';
import { Sound } from './Sound';
import type { UIScene } from './UIScene';
import { formatNumber } from './ui/widgets';
import { BELT_TEXTURE, DEPTH, WorldView, createPortArrows } from './WorldView';

export type Mode = 'normal' | 'build' | 'belt' | 'delete';

const TICK = 1 / TICKS_PER_SECOND;
const MAP_PX_W = MAP_W * CELL;
const MAP_PX_H = MAP_H * CELL;

interface Drag {
  kind: 'belt' | 'delete' | 'pan';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** Для панорамирования: где была мышь и камера в начале. */
  screenX: number;
  screenY: number;
  camX: number;
  camY: number;
}

export class GameScene extends Phaser.Scene {
  world!: World;
  view!: WorldView;

  // --- режимы ---
  mode: Mode = 'normal';
  buildType: BuildingType | null = null;
  /** Направление выхода для следующей постройки (R поворачивает). */
  rotation: Dir = 2;
  /** Пока игрок не нажал R, бур сам поворачивается выходом к базе. */
  private drillAutoDir = true;

  // --- симуляция ---
  private acc = 0;
  private xpPopup = 0;
  private xpPopupTimer = 0;

  // --- камера: центр в мировых пикселях и зум ---
  private camX = 0;
  private camY = 0;
  private zoom = 1;

  // --- ввод ---
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private hoverX = -1;
  private hoverY = -1;
  private drag: Drag | null = null;
  private startData: { load: boolean } = { load: false };
  private savedCamera: CameraState | null = null;

  // --- подсветка и «призраки» ---
  private hoverRect!: Phaser.GameObjects.Rectangle;
  private ghost: Phaser.GameObjects.Container | null = null;
  private ghostKey = '';
  private beltGhosts: Phaser.GameObjects.Image[] = [];
  /** Последний рассчитанный путь протяжки — пересчитываем, только если что-то изменилось. */
  private routeKey = '';
  private route: PathCell[] = [];
  private onUnload = () => this.save();

  constructor() {
    super('GameScene');
  }

  init(data: { load?: boolean }): void {
    this.startData = { load: data?.load === true };
    this.mode = 'normal';
    this.buildType = null;
    this.rotation = 2;
    this.drillAutoDir = true;
    this.acc = 0;
    this.xpPopup = 0;
    this.drag = null;
    this.ghost = null;
    this.ghostKey = '';
    this.beltGhosts = [];
    this.routeKey = '';
    this.route = [];
    this.hoverX = -1;
    this.hoverY = -1;
  }

  create(): void {
    // Мир: из сохранения или новый.
    const loaded = this.startData.load ? loadGame() : null;
    this.world = loaded ? loaded.world : new World();
    this.savedCamera = loaded ? loaded.camera : null;

    // Dev-проверка карты из balance.ts (на пустом мире, без построек игрока).
    if (import.meta.env.DEV) {
      for (const warning of checkMap(new World())) console.warn('[карта]', warning);
    }

    this.view = new WorldView(this, this.world);
    this.hoverRect = this.add.rectangle(0, 0, CELL, CELL).setOrigin(0, 0)
      .setStrokeStyle(2, 0xffffff, 0.5).setDepth(DEPTH.hover).setVisible(false);

    this.setupCamera();
    this.setupInput();

    this.scene.launch('UIScene');
    this.scene.bringToTop('UIScene');

    // Автосохранение по таймеру и при закрытии вкладки.
    this.time.addEvent({ delay: AUTOSAVE_INTERVAL * 1000, loop: true, callback: () => this.save() });
    window.addEventListener('beforeunload', this.onUnload);
    this.events.once('shutdown', () => window.removeEventListener('beforeunload', this.onUnload));

    if (this.world.tutorial === 0 && !this.savedCamera) this.time.delayedCall(700, () => this.showTutorialTarget());
    if (this.world.tutorial === 2) this.scheduleTutorialEnd();
  }

  // ---------------------------------------------------------------------------
  // Главный цикл
  // ---------------------------------------------------------------------------

  update(time: number, delta: number): void {
    this.moveCameraByKeys(delta);

    // Фиксированный шаг: накапливаем время и делаем столько тиков, сколько «набежало».
    let alpha = 1;
    if (this.world.isPaused()) {
      this.acc = 0;
    } else {
      this.acc += Math.min(delta, 250) / 1000;
      while (this.acc >= TICK && !this.world.isPaused()) {
        this.world.update();
        this.acc -= TICK;
      }
      alpha = this.world.isPaused() ? 1 : this.acc / TICK;
    }

    this.handleSimEvents(delta);
    this.view.update(time, alpha);
    this.updatePointer();
  }

  /** Разбираем события мира: эффекты здесь, остальное пересылаем в HUD. */
  private handleSimEvents(delta: number): void {
    for (const ev of this.world.events) {
      if (ev.type === 'xp') this.xpPopup += ev.amount;
      if (ev.type === 'goalDone') {
        this.view.goalBurst();
        this.view.popText(`Задание! +${formatNumber(ev.bonus)}`, '#9fe0b5', 22);
        Sound.goal();
      }
      if (ev.type === 'levelUp' || ev.type === 'phase') Sound.levelUp();
      if (ev.type === 'unlock') this.time.delayedCall(300, () => Sound.unlock());
      if (ev.type === 'tutorial' && ev.step === 2) this.scheduleTutorialEnd();
      this.events.emit('sim', ev);
    }
    this.world.events.length = 0;

    // Опыт за отдельные предметы копим и показываем одним «+N» раз в ~0.4 сек.
    this.xpPopupTimer += delta;
    if (this.xpPopupTimer > 400 && this.xpPopup > 0) {
      this.view.popText(`+${formatNumber(this.xpPopup)}`);
      this.xpPopup = 0;
      this.xpPopupTimer = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Камера
  // ---------------------------------------------------------------------------

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBackgroundColor(COLORS.outsideBg);
    if (this.savedCamera) {
      this.camX = this.savedCamera.x;
      this.camY = this.savedCamera.y;
      this.zoom = this.savedCamera.zoom;
    } else {
      // При старте камера центрируется на базе.
      this.camX = (BASE_X + BASE_SIZE / 2) * CELL;
      this.camY = (BASE_Y + BASE_SIZE / 2) * CELL;
      this.zoom = 1;
    }
    this.applyCamera();
    this.scale.on('resize', this.applyCamera, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.applyCamera, this));
  }

  /** Минимальный зум — такой, чтобы карта целиком влезала в экран. */
  private minZoom(): number {
    const cam = this.cameras.main;
    return Math.min(cam.width / MAP_PX_W, cam.height / MAP_PX_H);
  }

  /** Ограничивает зум и положение камеры границами карты (с небольшим отступом) и применяет их. */
  private applyCamera(): void {
    const cam = this.cameras.main;
    this.zoom = Phaser.Math.Clamp(this.zoom, this.minZoom(), CAMERA_MAX_ZOOM);
    const viewW = cam.width / this.zoom;
    const viewH = cam.height / this.zoom;
    const m = CAMERA_EDGE_MARGIN / this.zoom;
    this.camX = viewW >= MAP_PX_W + 2 * m ? MAP_PX_W / 2 : Phaser.Math.Clamp(this.camX, viewW / 2 - m, MAP_PX_W - viewW / 2 + m);
    this.camY = viewH >= MAP_PX_H + 2 * m ? MAP_PX_H / 2 : Phaser.Math.Clamp(this.camY, viewH / 2 - m, MAP_PX_H - viewH / 2 + m);
    cam.setZoom(this.zoom);
    cam.centerOn(this.camX, this.camY);
  }

  private moveCameraByKeys(delta: number): void {
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (k.left.isDown || k.a.isDown) dx -= 1;
    if (k.right.isDown || k.d.isDown) dx += 1;
    if (k.up.isDown || k.w.isDown) dy -= 1;
    if (k.down.isDown || k.s.isDown) dy += 1;
    if (dx === 0 && dy === 0) return;
    const step = (CAMERA_PAN_SPEED * delta) / 1000 / this.zoom;
    this.camX += dx * step;
    this.camY += dy * step;
    this.applyCamera();
  }

  /** Зум колесом относительно точки под курсором. */
  private zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = Phaser.Math.Clamp(this.zoom * factor, this.minZoom(), CAMERA_MAX_ZOOM);
    const cam = this.cameras.main;
    this.camX = before.x - (screenX - cam.width / 2) / this.zoom;
    this.camY = before.y - (screenY - cam.height / 2) / this.zoom;
    this.applyCamera();
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: this.camX + (sx - cam.width / 2) / this.zoom, y: this.camY + (sy - cam.height / 2) / this.zoom };
  }

  getCameraState(): CameraState {
    return { x: this.camX, y: this.camY, zoom: this.zoom };
  }

  /**
   * Обучение: камера плавно показывает и железо, на которое нужно поставить бур, и базу —
   * в свободной от интерфейса части экрана (сверху задание и подсказка, снизу кнопки).
   */
  private showTutorialTarget(): void {
    const d = DEPOSITS[TUTORIAL_DEPOSIT];
    const cam = this.cameras.main;
    const screenTop = 175;
    const screenBottom = cam.height - 120;
    const worldTop = d.y * CELL;
    const worldBottom = (BASE_Y + BASE_SIZE) * CELL;
    const zoom = Phaser.Math.Clamp((screenBottom - screenTop) / (worldBottom - worldTop), this.minZoom(), 1);
    const from = { x: this.camX, y: this.camY, zoom: this.zoom };
    const to = {
      x: (d.x + DEPOSIT_SIZE / 2) * CELL,
      y: worldTop + (cam.height / 2 - screenTop) / zoom,
      zoom,
    };
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 1400,
      ease: 'Sine.easeInOut',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 1;
        this.camX = from.x + (to.x - from.x) * t;
        this.camY = from.y + (to.y - from.y) * t;
        this.zoom = from.zoom + (to.zoom - from.zoom) * t;
        this.applyCamera();
      },
    });
  }

  private scheduleTutorialEnd(): void {
    this.time.delayedCall(TUTORIAL_LAST_HINT_TIME * 1000, () => this.world.setTutorial(3));
  }

  // ---------------------------------------------------------------------------
  // Управление: клавиатура и мышь
  // ---------------------------------------------------------------------------

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Клавиатура недоступна');
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D,
    }) as GameScene['keys'];
    kb.addCapture('TAB');

    kb.on('keydown-Q', () => this.setMode(this.mode === 'belt' ? 'normal' : 'belt'));
    kb.on('keydown-E', () => this.setMode(this.mode === 'delete' ? 'normal' : 'delete'));
    kb.on('keydown-R', () => this.rotate());
    kb.on('keydown-B', () => this.ui()?.toggleBuildMenu());
    kb.on('keydown-TAB', () => this.ui()?.toggleBuildMenu());
    kb.on('keydown-P', () => this.openPause());
    kb.on('keydown-ESC', () => {
      // Esc по очереди: закрыть окно → выйти из режима → пауза.
      if (this.ui()?.closePanels()) return;
      if (this.mode !== 'normal') this.setMode('normal');
      else this.openPause();
    });
    // Клавиши, отпущенные во время паузы, сцена не заметила — сбрасываем их, чтобы камера не «ехала» сама.
    const resetKeys = () => kb.resetKeys();
    this.events.on('resume', resetKeys);
    this.events.once('shutdown', () => this.events.off('resume', resetKeys));

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      this.zoomAt(pointer.x, pointer.y, dy > 0 ? 1 / CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP);
    });
  }

  /** HUD-сцена (null, пока она ещё не запущена). */
  private ui(): UIScene | null {
    return this.scene.isActive('UIScene') ? (this.scene.get('UIScene') as UIScene) : null;
  }

  /** Переключение режима. В режим постройки передаётся тип здания. */
  setMode(mode: Mode, type: BuildingType | null = null): void {
    if (mode === 'build' && type === 'belt') mode = 'belt';
    this.mode = mode;
    this.buildType = mode === 'build' ? type : null;
    if (mode === 'build' && type === 'drill') this.drillAutoDir = true;
    this.drag = null;
    this.events.emit('mode', this.mode, this.buildType);
  }

  private rotate(): void {
    if (this.mode === 'build' || this.mode === 'belt') {
      this.rotation = turnRight(this.rotation);
      this.drillAutoDir = false;
      return;
    }
    // В обычном режиме R поворачивает ленту под курсором.
    const cell = this.world.cellAt(this.hoverX, this.hoverY);
    if (this.mode === 'normal' && cell !== null && cell !== 'base' && cell.kind === 'belt') {
      this.world.placeBelt(cell.x, cell.y, turnRight(cell.dir));
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const cell = this.pointerCell(pointer);
    if (pointer.middleButtonDown()) {
      this.drag = {
        kind: 'pan', startX: 0, startY: 0, lastX: 0, lastY: 0,
        screenX: pointer.x, screenY: pointer.y, camX: this.camX, camY: this.camY,
      };
      return;
    }
    if (pointer.rightButtonDown()) {
      this.setMode('normal');
      return;
    }
    if (!pointer.leftButtonDown()) return;

    switch (this.mode) {
      case 'build':
        this.placeSelected();
        break;
      case 'belt':
        this.drag = { kind: 'belt', startX: cell.x, startY: cell.y, lastX: cell.x, lastY: cell.y, screenX: 0, screenY: 0, camX: 0, camY: 0 };
        break;
      case 'delete':
        this.drag = { kind: 'delete', startX: cell.x, startY: cell.y, lastX: cell.x, lastY: cell.y, screenX: 0, screenY: 0, camX: 0, camY: 0 };
        this.deleteAt(cell.x, cell.y, true);
        break;
      case 'normal': {
        const e = this.world.cellAt(cell.x, cell.y);
        const id = e !== null && e !== 'base' && e.kind === 'machine' ? e.id : null;
        this.events.emit('select', id);
        if (id !== null) Sound.click();
        break;
      }
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.drag?.kind === 'belt') {
      const end = this.pointerCell(pointer);
      this.placeBeltPath(this.drag.startX, this.drag.startY, end.x, end.y);
    }
    this.drag = null;
  }

  private pointerCell(pointer: { x: number; y: number }): { x: number; y: number } {
    const w = this.screenToWorld(pointer.x, pointer.y);
    return { x: Math.floor(w.x / CELL), y: Math.floor(w.y / CELL) };
  }

  /** Каждый кадр: клетка под курсором, протяжка, призраки. */
  private updatePointer(): void {
    const pointer = this.input.activePointer;
    const cell = this.pointerCell(pointer);
    this.hoverX = cell.x;
    this.hoverY = cell.y;

    if (this.drag?.kind === 'pan') {
      if (!pointer.middleButtonDown()) {
        this.drag = null;
      } else {
        this.camX = this.drag.camX - (pointer.x - this.drag.screenX) / this.zoom;
        this.camY = this.drag.camY - (pointer.y - this.drag.screenY) / this.zoom;
        this.applyCamera();
      }
    }
    // Кнопку отпустили над интерфейсом — сцена игры не получила pointerup; завершаем протяжку здесь.
    if (this.drag && this.drag.kind !== 'pan' && !pointer.leftButtonDown()) this.onPointerUp(pointer);

    if (this.drag?.kind === 'delete' && (cell.x !== this.drag.lastX || cell.y !== this.drag.lastY)) {
      for (const c of lineCells(this.drag.lastX, this.drag.lastY, cell.x, cell.y)) this.deleteAt(c.x, c.y, false);
      this.drag.lastX = cell.x;
      this.drag.lastY = cell.y;
    }

    const overUi = this.ui()?.isPointerOverUI(pointer) ?? false;
    this.updateGhost(overUi);
  }

  // ---------------------------------------------------------------------------
  // Постройка, конвейеры, удаление
  // ---------------------------------------------------------------------------

  /** Левый верхний угол постройки под курсором. Бур «прилипает» к месторождению. */
  private buildOrigin(): { x: number; y: number } | null {
    if (!this.buildType) return null;
    if (this.buildType === 'drill') {
      const index = this.world.depositAt(this.hoverX, this.hoverY);
      if (index >= 0) {
        const d = DEPOSITS[index];
        if (this.drillAutoDir) this.rotation = dirToBase(d.x + 1, d.y + 1);
        return { x: d.x, y: d.y };
      }
    }
    const half = (BUILDINGS[this.buildType].size - 1) / 2;
    return { x: this.hoverX - half, y: this.hoverY - half };
  }

  private placeSelected(): void {
    const origin = this.buildOrigin();
    if (!origin || !this.buildType) return;
    const result = this.world.placeBuilding(this.buildType, origin.x, origin.y, this.rotation);
    if (!result.ok) {
      this.hint(result.reason);
      Sound.error();
      return;
    }
    Sound.place();
    // Здание с выбираемым рецептом: сразу открываем окно выбора.
    const placed = this.world.cellAt(origin.x, origin.y);
    if (placed !== null && placed !== 'base' && placed.kind === 'machine' && BUILDINGS[placed.type].recipeMode === 'select') {
      this.events.emit('pickRecipe', placed.id);
    }
  }

  /**
   * Путь протяжки от (sx, sy) до (ex, ey): Г-образный или в обход препятствий (см. sim/BeltRoute.ts).
   * Поиск обхода не самый дешёвый, поэтому результат запоминается, пока не сдвинется курсор или мир.
   */
  private currentRoute(sx: number, sy: number, ex: number, ey: number): PathCell[] {
    const key = `${sx},${sy},${ex},${ey},${this.rotation},${this.world.version}`;
    if (key !== this.routeKey) {
      this.routeKey = key;
      this.route = planBeltRoute(this.world, sx, sy, ex, ey, this.rotation);
    }
    return this.route;
  }

  /** Ставит ленту по пути протяжки (или одну клетку при простом клике). */
  private placeBeltPath(sx: number, sy: number, ex: number, ey: number): void {
    const path = this.currentRoute(sx, sy, ex, ey);
    let placed = 0;
    let firstError = '';
    for (const c of path) {
      const r = this.world.placeBelt(c.x, c.y, c.dir);
      if (r.ok) placed++;
      else if (!firstError) firstError = r.reason;
    }
    if (path.length > 1) this.rotation = path[path.length - 1].dir;
    if (firstError) {
      this.hint(firstError);
      if (placed === 0) Sound.error();
    }
    if (placed > 0) Sound.place();
  }

  private deleteAt(x: number, y: number, explain: boolean): void {
    const cell = this.world.cellAt(x, y);
    if (cell === 'base') {
      if (explain) this.hint('Базу удалить нельзя');
      return;
    }
    if (cell === null) {
      const t = this.world.terrainAt(x, y);
      if (explain && (t === TERRAIN_ROCK || t === TERRAIN_WATER)) this.hint('Препятствия удалить нельзя');
      else if (explain && this.world.depositAt(x, y) >= 0) this.hint('Месторождение удалить нельзя');
      return;
    }
    if (this.world.remove(x, y)) {
      Sound.remove();
      this.events.emit('removed', cell.id);
    }
  }

  private hint(text: string): void {
    this.events.emit('hint', text);
  }

  // ---------------------------------------------------------------------------
  // «Призраки» и подсветка
  // ---------------------------------------------------------------------------

  private updateGhost(overUi: boolean): void {
    this.hoverRect.setVisible(false);
    for (const g of this.beltGhosts) g.setVisible(false);
    if (this.ghost) this.ghost.setVisible(false);
    if (overUi && !this.drag) return;

    if (this.mode === 'build' && this.buildType) {
      const origin = this.buildOrigin();
      if (!origin) return;
      const ghost = this.getGhost(this.buildType, this.rotation);
      const ok = this.world.checkPlace(this.buildType, origin.x, origin.y).ok;
      ghost.setPosition(origin.x * CELL, origin.y * CELL).setVisible(true);
      for (const child of ghost.list) {
        if (child instanceof Phaser.GameObjects.Image) child.setTint(ok ? 0x9cffaa : 0xff6b6b);
        // Подложка: зелёная — можно поставить, красная — нельзя.
        if (child instanceof Phaser.GameObjects.Rectangle) {
          child.setFillStyle(ok ? COLORS.good : COLORS.bad, 0.25).setStrokeStyle(2, ok ? COLORS.good : COLORS.bad, 0.9);
        }
      }
      return;
    }

    if (this.mode === 'belt') {
      const path = this.drag?.kind === 'belt'
        ? this.currentRoute(this.drag.startX, this.drag.startY, this.hoverX, this.hoverY)
        : [{ x: this.hoverX, y: this.hoverY, dir: this.rotation }];
      path.forEach((c, i) => {
        if (i >= this.beltGhosts.length) {
          this.beltGhosts.push(this.add.image(0, 0, 'belt0').setDepth(DEPTH.ghost).setAlpha(0.7));
        }
        // На повороте призрак рисуется уголком: вход — со стороны предыдущей клетки.
        const inSide = i > 0 ? opposite(path[i - 1].dir) : opposite(c.dir);
        const shape = inSide === turnLeft(c.dir) ? 'left' : inSide === turnRight(c.dir) ? 'right' : 'straight';
        const ok = canLayBelt(this.world, c.x, c.y);
        this.beltGhosts[i]
          .setTexture(`${BELT_TEXTURE[shape]}0`)
          .setPosition((c.x + 0.5) * CELL, (c.y + 0.5) * CELL)
          .setAngle(c.dir * 90)
          .setTint(ok ? 0x9cffaa : 0xff6b6b)
          .setVisible(true);
      });
      return;
    }

    // Обычный режим и удаление: подсветка клетки или объекта под курсором.
    const cell = this.world.cellAt(this.hoverX, this.hoverY);
    let x = this.hoverX;
    let y = this.hoverY;
    let size = 1;
    if (cell === 'base') {
      x = BASE_X;
      y = BASE_Y;
      size = BASE_SIZE;
    } else if (cell !== null) {
      x = cell.x;
      y = cell.y;
      size = cell.kind === 'machine' ? cell.size : 1;
    }
    if (!this.world.inBounds(this.hoverX, this.hoverY)) return;
    const color = this.mode === 'delete' ? COLORS.bad : 0xffffff;
    this.hoverRect.setPosition(x * CELL, y * CELL).setSize(size * CELL, size * CELL)
      .setStrokeStyle(2, color, this.mode === 'delete' ? 0.9 : 0.35).setVisible(true);
  }

  /** Призрак здания: корпус + стрелки портов. Пересоздаётся при смене типа или поворота. */
  private getGhost(type: BuildingType, dir: Dir): Phaser.GameObjects.Container {
    const key = `${type}:${dir}`;
    if (this.ghost && this.ghostKey === key) return this.ghost;
    this.ghost?.destroy();
    this.ghostKey = key;
    const size = BUILDINGS[type].size;
    const c = this.add.container(0, 0).setDepth(DEPTH.ghost).setAlpha(0.75);
    const center = (size * CELL) / 2;
    c.add(this.add.rectangle(0, 0, size * CELL, size * CELL).setOrigin(0, 0));
    if (isMachineType(type)) {
      c.add(this.add.image(center, center, `bld_${type}`));
      c.add(createPortArrows(this, 0, 0, size, dir, type !== 'drill', DEPTH.ghost));
    } else {
      const img = this.add.image(center, center, type);
      if (type !== 'bridge') img.setAngle(dir * 90);
      c.add(img);
    }
    this.ghost = c;
    return c;
  }

  // ---------------------------------------------------------------------------
  // Сохранение и выход в меню
  // ---------------------------------------------------------------------------

  save(): void {
    saveGame(this.world, this.getCameraState());
  }

  /** Пауза: игра и HUD останавливаются (но остаются видны), поверх открывается PauseScene. */
  openPause(): void {
    if (this.scene.isActive('PauseScene')) return;
    this.drag = null;
    this.scene.pause();
    this.scene.pause('UIScene');
    this.scene.launch('PauseScene');
    this.scene.bringToTop('PauseScene');
  }

  /** Из окна паузы: сохранить и выйти на стартовый экран. */
  exitToMenu(): void {
    this.save();
    this.scene.stop('PauseScene');
    this.scene.stop('UIScene');
    this.scene.start('MenuScene');
  }

  /** Из окна паузы: «Рестарт» — стереть сохранение и начать новую игру с нуля. */
  restartGame(): void {
    clearSave();
    this.scene.stop('PauseScene');
    this.scene.stop('UIScene');
    this.scene.restart({ load: false });
  }
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/** Клетки на отрезке (для удаления протяжкой без пропусков при быстром движении мыши). */
function lineCells(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 1; i <= steps; i++) {
    cells.push({ x: Math.round(x0 + ((x1 - x0) * i) / steps), y: Math.round(y0 + ((y1 - y0) * i) / steps) });
  }
  return cells;
}

/** Направление от точки (x, y) к центру базы — так бур по умолчанию «смотрит» выходом на базу. */
function dirToBase(x: number, y: number): Dir {
  const dx = BASE_X + (BASE_SIZE - 1) / 2 - x;
  const dy = BASE_Y + (BASE_SIZE - 1) / 2 - y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}
