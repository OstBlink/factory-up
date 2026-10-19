// Конфиг Phaser.Game: список сцен, масштабирование на всё окно и чёткая пиксельная сетка.

import Phaser from 'phaser';
import { BootScene } from './BootScene';
import { GameScene } from './GameScene';
import { MenuScene } from './MenuScene';
import { PauseScene } from './PauseScene';
import { UIScene } from './UIScene';

export function createGame(parent: string): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0f1115',
    // BootScene рисует текстуры, MenuScene — стартовый экран, GameScene + UIScene — сама игра,
    // PauseScene — окно паузы поверх всего.
    scene: [BootScene, MenuScene, GameScene, UIScene, PauseScene],
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      parent,
      width: '100%',
      height: '100%',
    },
  };

  return new Phaser.Game(config);
}
