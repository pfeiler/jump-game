import { Container, Graphics } from 'pixi.js';
import type { Scene } from './types';
import { label } from '../core/fx';
import { W, H } from '../games/types';

export class StartScene implements Scene {
  readonly name = 'start';
  container = new Container();
  cameraAlpha = 0;
  private title;
  private press;
  private t = 0;

  constructor(private onStart: () => void) {
    const bg = new Graphics().rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.001 });
    bg.eventMode = 'static';
    bg.on('pointerdown', () => this.go());
    this.title = label('Jump Game', 120, 0xffe66b);
    this.title.position.set(W / 2, 230);
    const sub = label('Springen, graben, Schätze finden!', 40, 0xffffff);
    sub.position.set(W / 2, 340);
    this.press = label('Klicke oder drücke eine Taste zum Starten', 36, 0x7dffa8);
    this.press.position.set(W / 2, 470);
    const privacy = label('Die Kamera bleibt auf diesem Gerät – es wird kein Video hochgeladen oder gespeichert.', 22, 0xc8c0e0, { fontWeight: '600' });
    privacy.position.set(W / 2, 640);
    this.container.addChild(bg, this.title, sub, this.press, privacy);
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'F12' || e.code === 'F5') return;
    this.go();
  };

  private done = false;
  private go(): void {
    if (this.done) return;
    this.done = true;
    this.onStart();
  }

  update(dt: number): void {
    this.t += dt;
    this.title.scale.set(1 + Math.sin(this.t * 2.5) * 0.04);
    this.title.rotation = Math.sin(this.t * 1.7) * 0.02;
    this.press.alpha = 0.6 + 0.4 * Math.sin(this.t * 4);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.container.destroy({ children: true });
  }
}
