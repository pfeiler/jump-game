import { Container, Graphics, Text } from 'pixi.js';
import type { Scene } from './types';
import { label } from '../core/fx';
import { W, H } from '../games/types';
import type { InputManager } from '../input/inputManager';
import type { Sfx } from '../core/audio';

const CALIB_TIME = 3;

/**
 * ~3 s standing still: captures baseline hip height and body scale (torso
 * length) per player before each round. Keyboard mode: short countdown.
 */
export class CalibrationScene implements Scene {
  readonly name = 'calibration';
  container = new Container();
  cameraAlpha = 1;
  private rings: Graphics[] = [];
  private ringTexts: Text[] = [];
  private infos: Text[] = [];
  private msg: Text;
  private progress = [0, 0];
  private samples: { y: number; s: number }[][] = [[], []];
  private done = [false, false];
  private t = 0;
  private finished = false;
  private lastSec = 4;
  private readonly camera: boolean;

  constructor(
    private input: InputManager,
    private sfx: Sfx,
    private players: 1 | 2,
    private onDone: () => void,
    private onJumpCalib?: () => void,
  ) {
    this.camera = input.cameraRunning;
    const title = label(this.camera ? 'Kurz stillstehen!' : 'Tastatur-Modus', 72, 0xffe66b);
    title.position.set(W / 2, 80);
    this.msg = label('', 32, 0xffffff, { wordWrap: true, wordWrapWidth: 1100 });
    this.msg.position.set(W / 2, 160);
    this.container.addChild(title, this.msg);
    for (let i = 0; i < players; i++) {
      const g = new Graphics();
      g.position.set(players === 1 ? W / 2 : W / 2 + (i === 0 ? -300 : 300), 420);
      const info = label('', 30, 0xffffff);
      info.position.set(g.x, 600);
      this.rings.push(g);
      this.infos.push(info);
      this.container.addChild(g, info);
    }
    if (!this.camera) {
      this.msg.text = players === 1
        ? '←/→ oder Maus = Spalte wählen · Leertaste = Landung (1 Treffer) · Shift+Leertaste = Hochsprung (2 Treffer)'
        : 'Spieler 1: A/D bewegen, W springen, E Hochsprung · Spieler 2: ←/→ bewegen, ↑ springen, ↓ Hochsprung';
    }
    const skip = label(this.camera && this.onJumpCalib ? 'Enter = überspringen · C = Sprünge kalibrieren' : 'Enter = überspringen', 20, 0xc8c0e0, { fontWeight: '600' });
    skip.position.set(W / 2, H - 30);
    this.container.addChild(skip);
    input.keyListeners.add(this.onKey);
    input.flush();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyC' && this.camera && this.onJumpCalib && !this.finished) {
      this.onJumpCalib();
      return;
    }
    if (e.code === 'Enter') this.finish();
  };

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.sfx.confirm();
    this.input.flush();
    this.onDone();
  }

  update(dt: number): void {
    this.t += dt;
    this.input.poll(); // drain events
    if (!this.camera) {
      const left = Math.max(0, CALIB_TIME - this.t);
      const sec = Math.ceil(left);
      if (sec !== this.lastSec && sec > 0) { this.lastSec = sec; this.sfx.tick(); }
      for (let i = 0; i < this.players; i++) {
        this.drawRing(i, 1 - left / CALIB_TIME, `${sec}`);
        this.infos[i].text = this.players === 2 ? `Spieler ${i + 1}` : '';
      }
      if (left <= 0) this.finish();
      return;
    }
    let allDone = true;
    let anyMissing = false;
    for (let i = 0; i < this.players; i++) {
      const tp = this.input.tracked[i];
      if (this.done[i]) { this.drawRing(i, 1, '✓'); continue; }
      allDone = false;
      const s = this.samples[i];
      if (tp.visible && tp.hip && tp.hip.visible) {
        s.push({ y: tp.hip.y, s: tp.hip.scale });
        // stability check over the last samples
        const recent = s.slice(-15);
        const mean = recent.reduce((a, b) => a + b.y, 0) / recent.length;
        const sd = Math.sqrt(recent.reduce((a, b) => a + (b.y - mean) ** 2, 0) / recent.length);
        const scale = recent.reduce((a, b) => a + b.s, 0) / recent.length;
        if (sd > Math.max(0.006, scale * 0.06)) {
          this.progress[i] = Math.max(0, this.progress[i] - dt * 2);
          s.length = 0;
          this.infos[i].text = 'Bitte stillhalten …';
        } else {
          this.progress[i] += dt / CALIB_TIME;
          this.infos[i].text = this.players === 2 ? `Spieler ${i + 1}: super!` : 'Super, so bleiben!';
        }
        if (this.progress[i] >= 1) {
          const n = Math.min(s.length, 60);
          const last = s.slice(-n);
          const y = last.reduce((a, b) => a + b.y, 0) / n;
          const sc = last.reduce((a, b) => a + b.s, 0) / n;
          // white-noise estimate from frame-to-frame differences (robust against slow drift)
          let d2 = 0;
          for (let j = 1; j < n; j++) d2 += (last[j].y - last[j - 1].y) ** 2;
          const noiseSd = n > 5 ? Math.sqrt(d2 / (n - 1) / 2) : undefined;
          tp.detector.calibrate(y, sc, noiseSd);
          this.done[i] = true;
          this.sfx.confirm();
        }
      } else {
        anyMissing = true;
        this.infos[i].text = this.players === 2 ? `Spieler ${i + 1}: nicht zu sehen` : 'Ich sehe dich noch nicht';
        this.progress[i] = Math.max(0, this.progress[i] - dt);
      }
      this.drawRing(i, this.progress[i], `${Math.max(1, Math.ceil((1 - this.progress[i]) * CALIB_TIME))}`);
    }
    this.msg.text = anyMissing
      ? (this.players === 2
        ? 'Stellt euch nebeneinander: Spieler 1 links, Spieler 2 rechts. Ganzer Körper im Bild (ca. 2–3 m Abstand).'
        : 'Geh ein Stück zurück, bis dein ganzer Körper im Bild ist (ca. 2–3 m Abstand).')
      : 'Stell dich locker hin und halte still – gleich geht\u2019s los!';
    if (allDone && this.t > 0.5) this.finish();
  }

  private drawRing(i: number, p: number, text: string): void {
    const g = this.rings[i];
    g.clear();
    g.circle(0, 0, 110).fill({ color: 0x140a24, alpha: 0.55 }).stroke({ width: 16, color: 0x3a2a5a });
    if (p > 0) g.arc(0, 0, 110, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p)).stroke({ width: 16, color: i === 0 ? 0x3fd0ff : 0xffa53d, cap: 'round' });
    let t = this.ringTexts[i];
    if (!t) { t = this.ringTexts[i] = label('', 90, 0xffffff); t.position.copyFrom(g.position); this.container.addChild(t); }
    t.text = text;
  }

  destroy(): void {
    this.input.keyListeners.delete(this.onKey);
    this.container.destroy({ children: true });
  }
}
