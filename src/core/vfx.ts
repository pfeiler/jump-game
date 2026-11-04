/**
 * Lightweight "big" effects without physics: explosion fireball + billowing smoke,
 * shockwave rings, screen flashes and lightning bolts.
 * Everything is pooled sprites/graphics with a hard cap so pose tracking keeps its CPU budget.
 */
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { SMOKE, smokeAlpha } from './smoke';
export { SMOKE, smokeAlpha, smokeMaxDuration } from './smoke';

let puffTex: Texture | null = null;
/** soft round blob (radial gradient) used for fire and smoke puffs */
function puffTexture(): Texture {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.75, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  puffTex = Texture.from(c);
  return puffTex;
}

interface Puff {
  s: Sprite; vx: number; vy: number; life: number; max: number;
  s0: number; s1: number; a0: number; drag: number; rise: number;
  c0: number; c1: number; delay: number; spin: number; smoke: boolean;
}
interface Fx { t: number; dur: number; fn: (k: number) => void; done?: () => void; delay: number }

const lerpColor = (a: number, b: number, k: number) => {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

export class Vfx {
  /** world-space effects (smoke, fire, bolts) */
  readonly container = new Container();
  /** full-screen flash layer – add on top of everything */
  readonly flashLayer = new Graphics();
  private puffs: Puff[] = [];
  private fx: Fx[] = [];
  private flashA = 0;
  private flashColor = 0xffffff;
  readonly maxPuffs = 140;
  /** for tests / debugging */
  stats = { explosions: 0, bolts: 0 };

  constructor(private w: number, private h: number) {
    this.flashLayer.eventMode = 'none';
  }

  get active(): number { return this.puffs.length + this.fx.length; }

  private add(dur: number, fn: (k: number) => void, done?: () => void, delay = 0): void {
    this.fx.push({ t: 0, dur, fn, done, delay });
  }

  flash(color: number, alpha: number): void {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, alpha);
  }

  private puff(x: number, y: number, o: Partial<Omit<Puff, 's' | 'smoke'>> & { size: number; add?: boolean; smoke?: boolean }): void {
    if (this.puffs.length >= this.maxPuffs) {
      const old = this.puffs.shift()!;
      old.s.destroy();
    }
    const s = new Sprite(puffTexture());
    s.anchor.set(0.5);
    s.position.set(x, y);
    if (o.add) s.blendMode = 'add';
    s.visible = !(o.delay && o.delay > 0);
    this.container.addChild(s);
    const p: Puff = {
      s, vx: o.vx ?? 0, vy: o.vy ?? 0, life: o.max ?? 1, max: o.max ?? 1,
      s0: o.size / 128, s1: (o.s1 ?? o.size * 2) / 128, a0: o.a0 ?? 1, drag: o.drag ?? 2, rise: o.rise ?? 0,
      c0: o.c0 ?? 0xffffff, c1: o.c1 ?? o.c0 ?? 0xffffff, delay: o.delay ?? 0, spin: (Math.random() - 0.5) * 2,
      smoke: !!o.smoke,
    };
    s.scale.set(p.s0);
    s.tint = p.c0;
    s.alpha = 0;
    this.puffs.push(p);
  }

  /** Big TNT explosion: flash, fireball, shockwave rings and billowing smoke/dust clouds. */
  explosion(x: number, y: number, power = 1): void {
    this.stats.explosions++;
    const P = Math.max(0.4, power);
    this.flash(0xfff1c4, 0.75 * Math.min(1, P));
    // white-hot core
    this.puff(x, y, { size: 160 * P, s1: 460 * P, max: 0.4, a0: 1, c0: 0xffffff, c1: 0xffd36b, add: true, drag: 0 });
    // fireball
    const nFire = Math.round(16 * P);
    for (let i = 0; i < nFire; i++) {
      const a = Math.random() * Math.PI * 2, v = (90 + Math.random() * 220) * P;
      this.puff(x, y, {
        vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8 - 60, size: (80 + Math.random() * 70) * P, s1: (210 + Math.random() * 150) * P,
        max: 0.55 + Math.random() * 0.4, a0: 1, c0: 0xffe9a0, c1: 0xff3d00, add: true, drag: 4, rise: -120,
      });
    }
    // quick smoke / dust puff (short and see-through, so the playfield stays visible)
    const nSmoke = Math.round(SMOKE.count * P);
    for (let i = 0; i < nSmoke; i++) {
      const a = Math.random() * Math.PI * 2, v = (60 + Math.random() * 200) * P;
      const dusty = Math.random() < 0.45;
      this.puff(x + Math.cos(a) * 20, y + Math.sin(a) * 20, {
        vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 30, size: (70 + Math.random() * 50) * P,
        s1: (SMOKE.sizeMin + Math.random() * (SMOKE.sizeMax - SMOKE.sizeMin)) * P,
        max: SMOKE.lifeMin + Math.random() * (SMOKE.lifeMax - SMOKE.lifeMin), a0: SMOKE.alpha,
        c0: dusty ? 0x9a7650 : 0x6a6470, c1: dusty ? 0x3a2c22 : 0x26232b,
        drag: 2.6, rise: -90 - Math.random() * 60, delay: Math.random() * SMOKE.delayMax, smoke: true,
      });
    }
    // shockwave rings
    for (const [delay, maxR, width, col] of [[0, 420, 22, 0xffffff], [0.08, 300, 12, 0xffc86b]] as const) {
      const ring = new Graphics();
      ring.position.set(x, y);
      this.container.addChild(ring);
      this.add(0.6, (k) => {
        const e = 1 - Math.pow(1 - k, 3);
        ring.clear().circle(0, 0, 20 + maxR * P * e).stroke({ color: col, width: width * (1 - k) + 1, alpha: 0.9 * (1 - k) });
      }, () => ring.destroy(), delay);
    }
  }

  /** jagged polyline from (x, y0) to (x2, y1) by midpoint displacement */
  static boltPath(x: number, y0: number, x2: number, y1: number, rough: number, depth = 6, rnd = Math.random): number[] {
    let pts = [x, y0, x2, y1];
    let d = rough;
    for (let i = 0; i < depth; i++) {
      const next: number[] = [];
      for (let j = 0; j < pts.length - 2; j += 2) {
        const ax = pts[j], ay = pts[j + 1], bx = pts[j + 2], by = pts[j + 3];
        next.push(ax, ay, (ax + bx) / 2 + (rnd() - 0.5) * d, (ay + by) / 2 + (rnd() - 0.5) * d * 0.25);
      }
      next.push(pts[pts.length - 2], pts[pts.length - 1]);
      pts = next;
      d *= 0.55;
    }
    return pts;
  }

  /** Lightning bolt striking down from y0 to y1 at x; flickers a few times. */
  lightning(x: number, y0: number, y1: number, onImpact?: () => void, delay = 0): void {
    this.stats.bolts++;
    const g = new Graphics();
    g.blendMode = 'add';
    this.container.addChild(g);
    let lastStage = -1;
    const draw = () => {
      g.clear();
      const main = Vfx.boltPath(x + (Math.random() - 0.5) * 30, y0, x + (Math.random() - 0.5) * 16, y1, 140);
      const stroke = (pts: number[], w: number) => {
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.stroke({ color: 0x5aa8ff, width: w * 4, alpha: 0.35, join: 'round', cap: 'round' });
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.stroke({ color: 0xbfe3ff, width: w * 1.8, alpha: 0.8, join: 'round', cap: 'round' });
        g.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
        g.stroke({ color: 0xffffff, width: w * 0.7, alpha: 1, join: 'round', cap: 'round' });
      };
      stroke(main, 6);
      // a few branches
      for (let b = 0; b < 3; b++) {
        const i = 2 * (8 + Math.floor(Math.random() * (main.length / 2 - 20)));
        const bx = main[i], by = main[i + 1];
        const len = 60 + Math.random() * 120;
        const dir = Math.random() < 0.5 ? -1 : 1;
        stroke(Vfx.boltPath(bx, by, bx + dir * len * 0.7, by + len, 50, 4), 2.5);
      }
      // impact glow
      g.circle(x, y1, 34).fill({ color: 0x9fd0ff, alpha: 0.5 });
      g.circle(x, y1, 14).fill({ color: 0xffffff, alpha: 0.9 });
    };
    const flick = [0, 0.07, 0.14, 0.24]; // stages: on, off, on, on(new), fade
    this.add(0.55, (k) => {
      const t = k * 0.55;
      let stage = 0;
      for (let i = 0; i < flick.length; i++) if (t >= flick[i]) stage = i;
      if (stage !== lastStage) {
        lastStage = stage;
        if (stage !== 1) draw();
        if (stage === 0) { this.flash(0xdff0ff, 0.65); onImpact?.(); }
        if (stage === 2) this.flash(0xa8d4ff, 0.45);
      }
      g.alpha = stage === 1 ? 0.15 : stage === 3 ? Math.max(0, 1 - (t - 0.24) / 0.31) : 1;
    }, () => g.destroy(), delay);
  }

  update(dt: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      try { f.fn(k); } catch { this.fx.splice(i, 1); continue; }
      if (k >= 1) { this.fx.splice(i, 1); f.done?.(); }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      if (p.delay > 0) { p.delay -= dt; if (p.delay <= 0) p.s.visible = true; continue; }
      p.life -= dt;
      if (p.life <= 0) { p.s.destroy(); this.puffs.splice(i, 1); continue; }
      const k = 1 - p.life / p.max;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp; p.vy = p.vy * damp + p.rise * dt;
      p.s.x += p.vx * dt; p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      p.s.scale.set(p.s0 + (p.s1 - p.s0) * (1 - Math.pow(1 - k, 2)));
      p.s.tint = lerpColor(p.c0, p.c1, Math.min(1, k * 1.6));
      p.s.alpha = p.a0 * (p.smoke ? smokeAlpha(k) : k < 0.08 ? k / 0.08 : 1 - Math.pow((k - 0.08) / 0.92, 1.6));
    }
    // flash: decays fast; draws a full-screen rect only while visible
    this.flashA *= Math.exp(-dt * 9);
    this.flashLayer.clear();
    if (this.flashA > 0.02) this.flashLayer.rect(0, 0, this.w, this.h).fill({ color: this.flashColor, alpha: this.flashA });
  }

  destroy(): void {
    this.fx = [];
    this.puffs = [];
    this.container.destroy({ children: true });
    this.flashLayer.destroy();
  }
}
