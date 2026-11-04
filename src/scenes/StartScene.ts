import { Container, Graphics } from 'pixi.js';
import type { Scene } from './types';
import { label } from '../core/fx';
import { W, H } from '../games/types';
import type { InputManager } from '../input/inputManager';
import { POSE_EDGES } from '../input/camera';
import { fullyInFrame } from '../input/players';

export interface StartInfo {
  state: 'off' | 'starting' | 'running' | 'error';
  message: string;
  players: number;
  /** camera sprite rect in stage coordinates (mirrored image) */
  cam: { x: number; y: number; w: number; h: number } | null;
}

const PLAYER_COLORS = [0x4fd1ff, 0xff8a3d];

export class StartScene implements Scene {
  readonly name = 'start';
  container = new Container();
  cameraAlpha = 1;
  rawCameraAlpha = 0.85;
  private title;
  private press;
  private status;
  private pill = new Graphics();
  private check = new Graphics();
  private skeleton = new Graphics();
  private t = 0;
  private lastText = '';

  constructor(private onStart: () => void, private input: InputManager, private info: () => StartInfo) {
    const bg = new Graphics().rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.001 });
    bg.eventMode = 'static';
    bg.on('pointerdown', () => this.go());
    this.title = label('Jump Game', 92, 0xffe66b);
    this.title.position.set(W / 2, 78);
    const sub = label('Springen, graben, Schätze finden!', 32, 0xffffff);
    sub.position.set(W / 2, 150);
    this.status = label('', 34, 0xffffff);
    this.status.position.set(W / 2, 566);
    this.press = label('Klicke oder drücke eine Taste zum Starten', 30, 0x7dffa8);
    this.press.position.set(W / 2, 640);
    const privacy = label('Die Kamera bleibt auf diesem Gerät – es wird kein Video hochgeladen oder gespeichert.', 18, 0xc8c0e0, { fontWeight: '600' });
    privacy.position.set(W / 2, 694);
    this.container.addChild(bg, this.skeleton, this.title, sub, this.pill, this.check, this.status, this.press, privacy);
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'F12' || e.code === 'F5' || e.code === 'KeyB' || e.code === 'F2' || e.code === 'KeyM') return;
    this.go();
  };

  private done = false;
  private go(): void {
    if (this.done) return;
    this.done = true;
    this.onStart();
  }

  /** current status line + whether everyone is ready (for tests / UI) */
  get readiness(): { text: string; ok: boolean } {
    const info = this.info();
    if (info.state === 'off' || info.state === 'error') return { text: info.message || 'Tastatur-Modus', ok: false };
    if (info.state === 'starting') return { text: info.message || 'Kamera wird gestartet …', ok: false };
    const parts: string[] = [];
    let ok = true;
    for (let i = 0; i < info.players; i++) {
      const p = this.input.tracked[i];
      const who = info.players > 1 ? `Spieler ${i + 1}` : 'Spieler 1';
      if (!p.visible) { ok = false; parts.push(info.players > 1 ? `${who}: noch nicht im Bild` : ''); }
      else if (!fullyInFrame(p.landmarks)) { ok = false; parts.push(`${who}: Geh etwas zurück – Kopf und Füße ins Bild!`); }
      else parts.push(`${who} erkannt ✓`);
    }
    if (info.players === 1 && !this.input.tracked[0].visible) return { text: 'Stell dich so hin, dass du ganz im Bild bist', ok: false };
    return { text: parts.join('   ·   '), ok };
  }

  update(dt: number): void {
    this.t += dt;
    this.title.scale.set(1 + Math.sin(this.t * 2.5) * 0.04);
    this.title.rotation = Math.sin(this.t * 1.7) * 0.02;
    this.press.alpha = 0.6 + 0.4 * Math.sin(this.t * 4);
    // jumps on the start screen do nothing – drop them so the menu starts clean
    this.input.flush();

    const info = this.info();
    const r = this.readiness;
    const anyVisible = info.state === 'running' && this.input.tracked.slice(0, info.players).some((p) => p.visible);
    const color = info.state === 'error' ? 0xffc46b : r.ok ? 0x7dff8a : anyVisible ? 0xffe66b : 0xffffff;
    if (r.text !== this.lastText) { this.status.text = r.text; this.lastText = r.text; }
    this.status.style.fill = color;
    this.status.alpha = info.state === 'running' && !anyVisible ? 0.75 + 0.25 * Math.sin(this.t * 4) : 1;

    // pill behind the status line, green check when ready
    const tw = this.status.width;
    const checkW = r.ok ? 64 : 0;
    const pw = tw + 60 + checkW;
    this.pill.clear().roundRect(W / 2 - pw / 2, 566 - 34, pw, 68, 34).fill({ color: r.ok ? 0x0f4a26 : 0x1a1030, alpha: 0.78 })
      .stroke({ color, width: 3, alpha: 0.9 });
    this.status.x = W / 2 + checkW / 2;
    this.check.clear();
    if (r.ok) {
      const cx = W / 2 - pw / 2 + 30 + 22, cy = 566;
      this.check.circle(cx, cy, 24).fill(0x2ecc71).stroke({ color: 0xffffff, width: 3 })
        .moveTo(cx - 11, cy + 1).lineTo(cx - 3, cy + 9).lineTo(cx + 12, cy - 9).stroke({ color: 0xffffff, width: 6, cap: 'round', join: 'round' });
      this.check.scale.set(1);
    }

    // skeleton overlay on the (mirrored) camera image
    const g = this.skeleton.clear();
    if (info.cam) {
      const c = info.cam;
      for (let i = 0; i < info.players; i++) {
        const p = this.input.tracked[i];
        const lm = p.landmarks;
        if (!p.visible || !lm) continue;
        const col = r.ok ? 0x7dff8a : PLAYER_COLORS[i];
        const P = (k: number) => [c.x + (1 - lm[k].x) * c.w, c.y + lm[k].y * c.h] as const;
        for (const [a, b] of POSE_EDGES) {
          if (lm[a].v < 0.4 || lm[b].v < 0.4) continue;
          const [x1, y1] = P(a), [x2, y2] = P(b);
          g.moveTo(x1, y1).lineTo(x2, y2);
        }
        g.stroke({ color: col, width: 6, alpha: 0.85, cap: 'round' });
        for (const k of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
          if (lm[k].v < 0.4) continue;
          const [x, y] = P(k);
          g.circle(x, y, 7);
        }
        g.fill({ color: 0xffffff, alpha: 0.9 });
      }
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.container.destroy({ children: true });
  }
}
