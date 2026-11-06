import { Container } from 'pixi.js';
import type { Scene } from './types';
import type { GameContext, GameDefinition, GameModule, GameResult } from '../games/types';
import type { InputManager } from '../input/inputManager';
import type { Sfx } from '../core/audio';

export class GameScene implements Scene {
  readonly name = 'game';
  container = new Container();
  cameraAlpha = 1;
  game: GameModule;
  private ready = false;

  constructor(def: GameDefinition, private input: InputManager, sfx: Sfx, shake: (a: number) => void, onEnd: (r: GameResult) => void) {
    this.game = def.create();
    let ended = false;
    const ctx: GameContext = {
      root: this.container,
      input,
      sfx,
      shake,
      end: (r) => { if (!ended) { ended = true; onEnd(r); } },
    };
    input.gameplay = true;
    input.kbStep = 1 / 6;
    input.flush();
    void Promise.resolve(this.game.init(ctx)).then(() => { this.ready = true; });
  }

  update(dt: number, t: number): void {
    if (this.ready) this.game.update(dt, t);
  }

  destroy(): void {
    this.input.gameplay = false;
    this.game.destroy();
    this.container.destroy({ children: true });
  }
}
