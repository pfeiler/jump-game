import { Container, Text, type TextStyleOptions } from 'pixi.js';

export const FONT = '"Baloo 2", "Comic Sans MS", "Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif';

export function label(text: string, size: number, color = 0xffffff, extra: Partial<TextStyleOptions> = {}): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: FONT,
      fontSize: size,
      fontWeight: '900',
      fill: color,
      stroke: { color: 0x1a1030, width: Math.max(2, size / 8), join: 'round' },
      align: 'center',
      ...extra,
    },
  });
  t.anchor.set(0.5);
  return t;
}

type Tween = { t: number; dur: number; fn: (k: number) => void; done?: () => void };

/** Tiny tween/timer helper driven by the game loop. */
export class Tweens {
  private list: Tween[] = [];
  add(dur: number, fn: (k: number) => void, done?: () => void): void {
    this.list.push({ t: 0, dur, fn, done });
  }
  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      try {
        tw.fn(k);
      } catch {
        // target was destroyed (e.g. a block removed while it was still wobbling) – drop the tween
        this.list.splice(i, 1);
        continue;
      }
      if (k >= 1) { this.list.splice(i, 1); tw.done?.(); }
    }
  }
  clear(): void { this.list = []; }
}

export const easeOutBack = (k: number) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
export const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

/** Floating "+35" style text that rises and fades. */
export function floatText(parent: Container, tweens: Tweens, text: string, x: number, y: number, color: number, size = 34): void {
  const t = label(text, size, color);
  t.position.set(x, y);
  parent.addChild(t);
  tweens.add(1.1, (k) => {
    t.y = y - 70 * easeOutCubic(k);
    t.scale.set(k < 0.15 ? 0.5 + (k / 0.15) * 0.7 : 1.2 - (k - 0.15) * 0.25);
    t.alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  }, () => t.destroy());
}
