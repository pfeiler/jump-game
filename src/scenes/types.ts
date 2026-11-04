import type { Container } from 'pixi.js';

export interface Scene {
  readonly name: string;
  container: Container;
  /** camera layer opacity wanted by this scene (0 = hidden) */
  cameraAlpha: number;
  /** opacity when there is no person mask (raw video); default cameraAlpha × 0.4 */
  rawCameraAlpha?: number;
  update(dt: number, t: number): void;
  destroy(): void;
}
