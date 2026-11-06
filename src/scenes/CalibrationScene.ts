import { Container, Graphics, Text } from 'pixi.js';
import type { Scene } from './types';
import { label } from '../core/fx';
import { W, H } from '../games/types';
import type { InputManager } from '../input/inputManager';
import type { Sfx } from '../core/audio';

const CALIB_TIME = 3;

/**
 * ~3 s standing still: captures baseline hip height and body scale (torso
 * length) before each round. Keyboard mode: short countdown.
 */
export class CalibrationScene implements Scene {
  readonly name = 'calibration';
  container = new Container();
  cameraAlpha = 1;
  private ring = new Graphics();
  private ringText: Text | null = null;
  private info: Text;
  private msg: Text;
  private progress = 0;
  private samples: { y: number; s: number }[] = [];
  private done = false;
  private t = 0;
  private finished = false;
  private lastSec = 4;
  private readonly camera: boolean;

  constructor(
    private input: InputManager,
    private sfx: Sfx,
    private onDone: () => void,
    private onJumpCalib?: () => void,
  ) {
    this.camera = input.cameraRunning;
    const title = label(this.camera ? 'Kurz stillstehen!' : 'Ohne Kamera', 72, 0xffe66b);
    title.position.set(W / 2, 80);
    this.msg = label('', 32, 0xffffff, { wordWrap: true, wordWrapWidth: 1100 });
    this.msg.position.set(W / 2, 160);
    this.ring.position.set(W / 2, 420);
    this.info = label('', 30, 0xffffff);
    this.info.position.set(W / 2, 600);
    this.container.addChild(title, this.msg, this.ring, this.info);
    if (!this.camera) {
      this.msg.text = 'In der Runde gräbst du nur mit der Kamera. Enter überspringt diese Anzeige.';
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
      this.drawRing(1 - left / CALIB_TIME, `${sec}`);
      this.info.text = '';
      if (left <= 0) this.finish();
      return;
    }
    const tp = this.input.tracked;
    if (this.done) {
      this.drawRing(1, '✓');
      if (this.t > 0.5) this.finish();
      return;
    }
    let missing = false;
    if (tp.visible && tp.hip && tp.hip.visible) {
      const s = this.samples;
      s.push({ y: tp.hip.y, s: tp.hip.scale });
      const recent = s.slice(-15);
      const mean = recent.reduce((a, b) => a + b.y, 0) / recent.length;
      const sd = Math.sqrt(recent.reduce((a, b) => a + (b.y - mean) ** 2, 0) / recent.length);
      const scale = recent.reduce((a, b) => a + b.s, 0) / recent.length;
      if (sd > Math.max(0.006, scale * 0.06)) {
        this.progress = Math.max(0, this.progress - dt * 2);
        s.length = 0;
        this.info.text = 'Bitte stillhalten …';
      } else {
        this.progress += dt / CALIB_TIME;
        this.info.text = 'Super, so bleiben!';
      }
      if (this.progress >= 1) {
        const n = Math.min(s.length, 60);
        const last = s.slice(-n);
        const y = last.reduce((a, b) => a + b.y, 0) / n;
        const sc = last.reduce((a, b) => a + b.s, 0) / n;
        let d2 = 0;
        for (let j = 1; j < n; j++) d2 += (last[j].y - last[j - 1].y) ** 2;
        const noiseSd = n > 5 ? Math.sqrt(d2 / (n - 1) / 2) : undefined;
        tp.detector.calibrate(y, sc, noiseSd);
        this.done = true;
        this.sfx.confirm();
      }
    } else {
      missing = true;
      this.info.text = 'Ich sehe dich noch nicht';
      this.progress = Math.max(0, this.progress - dt);
    }
    this.drawRing(this.progress, `${Math.max(1, Math.ceil((1 - this.progress) * CALIB_TIME))}`);
    this.msg.text = missing
      ? 'Geh ein Stück zurück, bis dein ganzer Körper im Bild ist (ca. 2–3 m Abstand).'
      : 'Stell dich locker hin und halte still – gleich geht\u2019s los!';
  }

  private drawRing(p: number, text: string): void {
    const g = this.ring;
    g.clear();
    g.circle(0, 0, 110).fill({ color: 0x140a24, alpha: 0.55 }).stroke({ width: 16, color: 0x3a2a5a });
    if (p > 0) g.arc(0, 0, 110, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p)).stroke({ width: 16, color: 0x3fd0ff, cap: 'round' });
    if (!this.ringText) {
      this.ringText = label('', 90, 0xffffff);
      this.ringText.position.copyFrom(g.position);
      this.container.addChild(this.ringText);
    }
    this.ringText.text = text;
  }

  destroy(): void {
    this.input.keyListeners.delete(this.onKey);
    this.container.destroy({ children: true });
  }
}
