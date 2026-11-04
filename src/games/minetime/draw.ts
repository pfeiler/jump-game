import { Graphics } from 'pixi.js';
import type { Block } from './grid';

export const GEM_COLORS = [0x2ee66b, 0x3fa9f5, 0xff3b5c, 0xe8fbff];
export const KIND_COLORS: Record<string, number> = {
  dirt: 0x9a6233, stone: 0x8d939e, hard: 0x4b4f5e, gem: 0x9a6233, bomb: 0x7a4a33,
  drill: 0x6b5a3a, hammer: 0x6b5a3a, magnet: 0x6b5a3a, exit: 0x1d1d2b,
};

function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

export function drawGem(g: Graphics, cx: number, cy: number, s: number, type: number): void {
  const c = GEM_COLORS[type] ?? GEM_COLORS[0];
  g.poly([cx, cy - s, cx + s * 0.85, cy - s * 0.25, cx + s * 0.55, cy + s, cx - s * 0.55, cy + s, cx - s * 0.85, cy - s * 0.25])
    .fill(c)
    .stroke({ width: 3, color: shade(c, 0.55) });
  g.poly([cx, cy - s, cx + s * 0.3, cy - s * 0.25, cx, cy + s * 0.2, cx - s * 0.3, cy - s * 0.25]).fill({ color: 0xffffff, alpha: 0.55 });
  g.circle(cx - s * 0.35, cy - s * 0.45, s * 0.12).fill({ color: 0xffffff, alpha: 0.9 });
}

/** Draws a block into `g` (local coords 0..w, 0..h). */
export function drawBlock(g: Graphics, b: Block, w: number, h: number, col: number, row: number, level: number): void {
  g.clear();
  const base = KIND_COLORS[b.kind];
  const depthShade = Math.max(0.65, 1 - level * 0.05);
  const fill = shade(base, depthShade);
  const p = 3;
  g.roundRect(p, p, w - 2 * p, h - 2 * p, 10).fill(fill).stroke({ width: 3, color: shade(fill, 0.6) });
  // top highlight
  g.roundRect(p + 4, p + 3, w - 2 * p - 8, 8, 4).fill({ color: 0xffffff, alpha: 0.12 });
  // speckles
  const n = b.kind === 'hard' ? 9 : 6;
  for (let i = 0; i < n; i++) {
    const x = 10 + hash(col, row, i) * (w - 20);
    const y = 14 + hash(row, col, i + 7) * (h - 24);
    const r = 2 + hash(col + 3, row, i) * (b.kind === 'stone' || b.kind === 'hard' ? 6 : 4);
    const light = b.kind === 'hard' ? 0x9aa3c0 : shade(fill, hash(i, col, row) > 0.5 ? 1.25 : 0.7);
    g.circle(x, y, r).fill({ color: light, alpha: b.kind === 'hard' ? 0.5 : 0.6 });
  }
  const cx = w / 2, cy = h / 2;
  switch (b.kind) {
    case 'gem':
      drawGem(g, cx, cy, Math.min(w, h) * 0.32, b.gemType ?? 0);
      break;
    case 'bomb':
      g.circle(cx, cy + 4, h * 0.27).fill(0x1b1b22).stroke({ width: 3, color: 0x000000 });
      g.circle(cx - 6, cy - 3, h * 0.07).fill({ color: 0xffffff, alpha: 0.5 });
      g.moveTo(cx + 8, cy - h * 0.2).quadraticCurveTo(cx + 18, cy - h * 0.38, cx + 24, cy - h * 0.3).stroke({ width: 4, color: 0xc9a26b });
      g.circle(cx + 25, cy - h * 0.31, 5).fill(0xffcc33);
      g.circle(cx + 25, cy - h * 0.31, 2.5).fill(0xff4422);
      break;
    case 'drill':
      g.roundRect(cx - 16, cy - h * 0.32, 32, 14, 4).fill(0x3a6ea5);
      g.poly([cx - 14, cy - h * 0.32 + 14, cx + 14, cy - h * 0.32 + 14, cx, cy + h * 0.34]).fill(0xffd23f).stroke({ width: 2, color: 0x9a7a10 });
      for (let i = 0; i < 3; i++) g.moveTo(cx - 10 + i * 4, cy - 6 + i * 9).lineTo(cx + 10 - i * 4, cy - 2 + i * 9).stroke({ width: 2, color: 0x9a7a10 });
      break;
    case 'hammer':
      g.roundRect(cx - 4, cy - 8, 8, h * 0.42, 3).fill(0x8b5a2b);
      g.roundRect(cx - 22, cy - h * 0.32, 44, 18, 5).fill(0xb8c0cc).stroke({ width: 2, color: 0x5b6270 });
      break;
    case 'magnet':
      g.arc(cx, cy - 2, 18, Math.PI, 0, false).stroke({ width: 12, color: 0xe53935 });
      g.rect(cx - 24, cy - 2, 12, 16).fill(0xe53935);
      g.rect(cx + 12, cy - 2, 12, 16).fill(0xe53935);
      g.rect(cx - 24, cy + 10, 12, 8).fill(0xdfe6ee);
      g.rect(cx + 12, cy + 10, 12, 8).fill(0xdfe6ee);
      break;
    case 'exit':
      g.roundRect(cx - 22, cy - h * 0.36, 44, h * 0.72, 14).fill(0x2bd96b).stroke({ width: 4, color: 0xb6ffcf });
      g.poly([cx - 10, cy - 6, cx + 10, cy - 6, cx, cy + 10]).fill(0x0c4020);
      g.rect(cx - 4, cy - 18, 8, 13).fill(0x0c4020);
      break;
  }
  if (b.kind === 'drill' || b.kind === 'hammer' || b.kind === 'magnet') {
    g.roundRect(p, p, w - 2 * p, h - 2 * p, 10).stroke({ width: 4, color: 0xffe66b, alpha: 0.9 });
  }
  // cracks for damaged blocks
  const dmg = b.maxHp - b.hp;
  for (let i = 0; i < dmg * 2; i++) {
    let x = 12 + hash(col, row, 50 + i) * (w - 24);
    let y = 8 + hash(row, col, 60 + i) * 10;
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (hash(i, s, row + col) - 0.5) * 26;
      y += 8 + hash(s, i, col) * 8;
      g.lineTo(Math.max(6, Math.min(w - 6, x)), Math.min(h - 6, y));
    }
    g.stroke({ width: 3, color: 0x140c08, alpha: 0.85 });
  }
}
