import type { Container } from 'pixi.js';
import type { InputManager } from '../input/inputManager';
import type { Sfx } from '../core/audio';

export const W = 1280;
export const H = 720;

export interface GameResult {
  score: number;
  /** short German stat lines for the end screen */
  stats: string[];
}

export interface GameContext {
  /** root container of the game (1280×720 logical units) */
  root: Container;
  input: InputManager;
  sfx: Sfx;
  /** shakes the whole screen */
  shake(amount: number): void;
  /** finish the round */
  end(result: GameResult): void;
}

/** Every game is a module behind this small interface. */
export interface GameModule {
  id: string;
  title: string;
  init(ctx: GameContext): void | Promise<void>;
  /** dt and t in seconds */
  update(dt: number, t: number): void;
  destroy(): void;
}

export interface GameDefinition {
  id: string;
  title: string;
  /** kid-friendly German one-liner for the menu tile */
  subtitle: string;
  color: number;
  create(): GameModule;
}
