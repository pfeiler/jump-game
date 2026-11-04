import { Graphics } from 'pixi.js';
import type { Block } from './grid';

/** gem base colours (also used for pop-ups/particles); diamond = icy white-blue */
export const GEM_COLORS = [0x2ee66b, 0x3fa9f5, 0xff3b5c, 0xc8efff];
export const KIND_COLORS: Record<string, number> = {
  dirt: 0x9a6233, stone: 0x8d939e, hard: 0x4b4f5e, gem: 0x9a6233, bomb: 0x7a4a33,
  drill: 0x6b5a3a, hdrill: 0x6b5a3a, hammer: 0x6b5a3a, magnet: 0x6b5a3a, clock: 0x1d7f86, anvil: 0x33343c, spring: 0x6b5a3a, exit: 0x1d1d2b,
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

const lighten = (c: number, k: number): number => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r + (255 - r) * k) << 16) | (Math.round(g + (255 - g) * k) << 8) | Math.round(b + (255 - b) * k);
};
/** facet tone: light comes from the top-left; `n` = facet direction angle (screen coords) */
const facetTone = (c: number, n: number): number => {
  const l = Math.cos(n - (-3 * Math.PI) / 4); // 1 = facing the light
  return l > 0.2 ? lighten(c, (l - 0.2) * 0.55) : shade(c, 0.78 + 0.22 * (l + 1) / 1.2);
};

/** polygon "ring" cut: outer outline + inner table, facets between them toned by direction */
function ringCut(g: Graphics, cx: number, cy: number, outer: number[], tableScale: number, c: number, s: number): void {
  const n = outer.length / 2;
  const inner = outer.map((v, i) => (i % 2 ? cy + (v - cy) * tableScale : cx + (v - cx) * tableScale));
  // soft outline/shadow
  g.poly(outer).fill(shade(c, 0.35));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mx = (outer[2 * i] + outer[2 * j]) / 2 - cx, my = (outer[2 * i + 1] + outer[2 * j + 1]) / 2 - cy;
    g.poly([outer[2 * i], outer[2 * i + 1], outer[2 * j], outer[2 * j + 1], inner[2 * j], inner[2 * j + 1], inner[2 * i], inner[2 * i + 1]])
      .fill(facetTone(c, Math.atan2(my, mx)));
  }
  g.poly(inner).fill(lighten(c, 0.12));
  // facet edges
  for (let i = 0; i < n; i++) g.moveTo(outer[2 * i], outer[2 * i + 1]).lineTo(inner[2 * i], inner[2 * i + 1]);
  g.stroke({ width: Math.max(1, s * 0.05), color: 0xffffff, alpha: 0.28 });
  g.poly(inner).stroke({ width: Math.max(1, s * 0.05), color: 0xffffff, alpha: 0.35 });
  g.poly(outer).stroke({ width: Math.max(1.5, s * 0.1), color: shade(c, 0.42) });
}

/** 4-point glint star */
export function glint(g: Graphics, x: number, y: number, r: number, alpha = 1, color = 0xffffff): void {
  const t = r * 0.22;
  g.poly([x, y - r, x + t, y - t, x + r, y, x + t, y + t, x, y + r, x - t, y + t, x - r, y, x - t, y - t]).fill({ color, alpha });
  g.circle(x, y, r * 0.22).fill({ color: 0xffffff, alpha });
}

/**
 * Gem art (faceted, lit from the top-left, outline, specular streak + glint).
 * Shapes differ by type so they're distinguishable without colour:
 * 0 emerald = octagonal step cut, 1 sapphire = round brilliant, 2 ruby = triangle (trillion), 3 diamond = brilliant profile.
 */
export function drawGem(g: Graphics, cx: number, cy: number, s: number, type: number): void {
  const c = GEM_COLORS[type] ?? GEM_COLORS[0];
  if (type === 3) { drawDiamond(g, cx, cy, s); return; }
  // soft glow
  g.circle(cx, cy, s * 1.25).fill({ color: c, alpha: 0.12 });
  if (type === 0) {
    const w = s * 0.95, h = s * 0.75, k = s * 0.3;
    ringCut(g, cx, cy, [cx - w + k, cy - h, cx + w - k, cy - h, cx + w, cy - h + k, cx + w, cy + h - k, cx + w - k, cy + h, cx - w + k, cy + h, cx - w, cy + h - k, cx - w, cy - h + k], 0.58, c, s);
    // step-cut lines on the table
    g.moveTo(cx - w * 0.4, cy - h * 0.15).lineTo(cx + w * 0.4, cy - h * 0.15).moveTo(cx - w * 0.4, cy + h * 0.15).lineTo(cx + w * 0.4, cy + h * 0.15).stroke({ width: 1.2, color: 0xffffff, alpha: 0.25 });
  } else if (type === 1) {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; pts.push(cx + Math.cos(a) * s, cy + Math.sin(a) * s * 0.92); }
    ringCut(g, cx, cy, pts, 0.52, c, s);
    // star facets on the table
    const r = s * 0.52;
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92); }
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.22 });
  } else {
    // trillion: rounded triangle pointing down
    const R = s * 1.08, pts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2 + Math.PI; // point down
      const a1 = a - 0.32, a2 = a + 0.32;
      pts.push(cx + Math.cos(a1) * R * 0.9, cy - s * 0.08 + Math.sin(a1) * R * 0.9, cx + Math.cos(a2) * R * 0.9, cy - s * 0.08 + Math.sin(a2) * R * 0.9);
    }
    ringCut(g, cx, cy - s * 0.08, pts, 0.5, c, s);
  }
  // specular streak + glint
  g.poly([cx - s * 0.5, cy - s * 0.42, cx - s * 0.2, cy - s * 0.55, cx - s * 0.32, cy - s * 0.18, cx - s * 0.56, cy - s * 0.12]).fill({ color: 0xffffff, alpha: 0.55 });
  glint(g, cx - s * 0.45, cy - s * 0.5, s * 0.32, 0.95);
}

/** premium diamond: white-blue brilliant with crown/pavilion facets, rainbow fire and a glow */
function drawDiamond(g: Graphics, cx: number, cy: number, s: number): void {
  for (const [r, a] of [[1.55, 0.08], [1.25, 0.12], [1.0, 0.12]] as const) g.circle(cx, cy, s * r).fill({ color: 0xbfe9ff, alpha: a });
  const w = s * 1.08, tw = s * 0.55, top = cy - s * 0.62, gird = cy - s * 0.18, bot = cy + s * 0.95;
  const outline = [cx - tw, top, cx + tw, top, cx + w, gird, cx, bot, cx - w, gird];
  g.poly(outline).fill(0x6fa9cf);
  // crown: table + side facets
  const crown: [number[], number][] = [
    [[cx - tw, top, cx + tw, top, cx + tw * 0.55, gird, cx - tw * 0.55, gird], 0xf4fdff],
    [[cx - tw, top, cx - tw * 0.55, gird, cx - w, gird], 0xffffff],
    [[cx + tw, top, cx + w, gird, cx + tw * 0.55, gird], 0xa9dcf7],
  ];
  for (const [pts, col] of crown) g.poly(pts).fill(col);
  // pavilion: fan of facets to the culet, alternating light/dark
  const xs = [-w, -w * 0.55, -w * 0.1, w * 0.1 + 0, w * 0.55, w];
  const tones = [0xd9f3ff, 0x8fc9ec, 0xeefaff, 0x7dbbe3, 0xc4e9fb];
  for (let i = 0; i < xs.length - 1; i++) g.poly([cx + xs[i], gird, cx + xs[i + 1], gird, cx, bot]).fill(tones[i]);
  // rainbow fire
  const fire: [number, number, number][] = [[-0.45, 0.15, 0xff7ad9], [0.28, 0.3, 0xffe66b], [-0.15, 0.45, 0x7dffa8], [0.5, 0.05, 0x9f8cff]];
  for (const [fx, fy, col] of fire) g.poly([cx + fx * s, cy + fy * s, cx + (fx + 0.16) * s, cy + (fy + 0.05) * s, cx + (fx + 0.04) * s, cy + (fy + 0.2) * s]).fill({ color: col, alpha: 0.55 });
  // edges + outline
  g.moveTo(cx - w, gird).lineTo(cx + w, gird).stroke({ width: Math.max(1, s * 0.06), color: 0xffffff, alpha: 0.7 });
  for (const x of xs.slice(1, -1)) g.moveTo(cx + x, gird).lineTo(cx, bot);
  g.moveTo(cx - tw * 0.55, gird).lineTo(cx - tw, top).moveTo(cx + tw * 0.55, gird).lineTo(cx + tw, top);
  g.stroke({ width: Math.max(1, s * 0.04), color: 0xffffff, alpha: 0.45 });
  g.poly(outline).stroke({ width: Math.max(1.5, s * 0.1), color: 0x2f6f99 });
  // specular + glints
  g.poly([cx - tw * 0.8, top + s * 0.08, cx - tw * 0.2, top + s * 0.08, cx - tw * 0.5, gird - s * 0.06]).fill({ color: 0xffffff, alpha: 0.9 });
  glint(g, cx - tw * 0.75, top + s * 0.02, s * 0.42, 1);
  glint(g, cx + w * 0.55, gird + s * 0.25, s * 0.2, 0.8, 0xe8fbff);
}

/** Stopwatch icon (time block + the flying HUD icon): white face, green rim, crown, "+" badge. */
export function drawClock(g: Graphics, cx: number, cy: number, R: number, badge = true): void {
  g.rect(cx - R * 0.22, cy - R - 10, R * 0.44, 8).fill(0xdfe6ee);
  g.circle(cx, cy - R - 11, R * 0.18).fill(0x7dffa8);
  g.circle(cx, cy, R + 4).fill(0x0c3a3e);
  g.circle(cx, cy, R).fill(0xffffff).stroke({ width: Math.max(2, R * 0.18), color: 0x7dffa8 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.moveTo(cx + Math.sin(a) * R * 0.7, cy - Math.cos(a) * R * 0.7).lineTo(cx + Math.sin(a) * R * 0.9, cy - Math.cos(a) * R * 0.9).stroke({ width: 3, color: 0x1d7f86 });
  }
  g.moveTo(cx, cy).lineTo(cx, cy - R * 0.7).stroke({ width: Math.max(2, R * 0.18), color: 0x112233, cap: 'round' });
  g.moveTo(cx, cy).lineTo(cx + R * 0.5, cy + R * 0.3).stroke({ width: Math.max(2, R * 0.18), color: 0x2bd96b, cap: 'round' });
  g.circle(cx, cy, Math.max(2, R * 0.15)).fill(0x112233);
  if (badge) {
    const bx = cx + R + 8, by = cy - R + 1;
    g.circle(bx, by, 10).fill(0x2bd96b).stroke({ width: 2, color: 0xffffff });
    g.rect(bx - 5, by - 1.5, 10, 3).fill(0xffffff);
    g.rect(bx - 1.5, by - 5, 3, 10).fill(0xffffff);
  }
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
    case 'anvil': {
      // dark steel anvil: horn to the left, flat face with highlight, waist, foot
      const top = cy - h * 0.26, fh = h * 0.16;
      g.poly([cx - w * 0.36, top + fh * 0.3, cx - w * 0.2, top, cx + w * 0.3, top, cx + w * 0.3, top + fh, cx - w * 0.2, top + fh, cx - w * 0.3, top + fh * 0.75])
        .fill(0x4a4f5c).stroke({ width: 2.5, color: 0x101218 });
      g.poly([cx - w * 0.1, top + fh, cx + w * 0.2, top + fh, cx + w * 0.13, cy + h * 0.12, cx - w * 0.03, cy + h * 0.12]).fill(0x3a3e49).stroke({ width: 2.5, color: 0x101218 });
      g.roundRect(cx - w * 0.2, cy + h * 0.12, w * 0.5, h * 0.13, 3).fill(0x2c2f38).stroke({ width: 2.5, color: 0x101218 });
      g.rect(cx - w * 0.18, top + 2, w * 0.44, 3).fill({ color: 0xdfe8ff, alpha: 0.75 }); // face highlight
      g.circle(cx - w * 0.3, top + fh * 0.45, 2).fill({ color: 0xffffff, alpha: 0.6 });
      // subtle "high jump" hint: double up-chevron in the corner
      const ax = w - 16, ay = 16;
      for (const dy of [0, 8]) g.moveTo(ax - 7, ay + dy + 6).lineTo(ax, ay + dy).lineTo(ax + 7, ay + dy + 6).stroke({ width: 3, color: 0x7df9ff, alpha: 0.85, cap: 'round', join: 'round' });
      break;
    }
    case 'spring': {
      // coil spring between two plates
      const x0 = cx - w * 0.2, x1 = cx + w * 0.2, y0 = cy - h * 0.24, y1 = cy + h * 0.22;
      g.roundRect(x0 - 6, y0 - 7, x1 - x0 + 12, 8, 3).fill(0xff5fa2).stroke({ width: 2, color: 0x7a1a4a });
      g.roundRect(x0 - 6, y1, x1 - x0 + 12, 8, 3).fill(0xff5fa2).stroke({ width: 2, color: 0x7a1a4a });
      const n = 5;
      g.moveTo(x0, y0 + 1);
      for (let i = 1; i <= n * 2; i++) g.lineTo(i % 2 ? x1 : x0, y0 + 1 + ((y1 - y0 - 1) * i) / (n * 2));
      g.stroke({ width: 6, color: 0x8a1f55, cap: 'round', join: 'round' });
      g.moveTo(x0, y0 + 1);
      for (let i = 1; i <= n * 2; i++) g.lineTo(i % 2 ? x1 : x0, y0 + 1 + ((y1 - y0 - 1) * i) / (n * 2));
      g.stroke({ width: 3, color: 0xffd1e8, cap: 'round', join: 'round' });
      break;
    }
    case 'hdrill': {
      // cross drill: orange motor in the middle, two yellow bits pointing left and right
      const L = w * 0.36, bh = h * 0.2;
      for (const dir of [-1, 1]) {
        g.poly([cx + dir * 12, cy - bh, cx + dir * 12, cy + bh, cx + dir * L, cy]).fill(0xffd23f).stroke({ width: 2, color: 0x9a7a10 });
        for (let i = 0; i < 3; i++) {
          const x0 = cx + dir * (16 + i * 8), hh = bh * (1 - (i + 1) * 0.22);
          g.moveTo(x0, cy - hh).lineTo(x0 + dir * 5, cy + hh).stroke({ width: 2, color: 0x9a7a10 });
        }
      }
      g.roundRect(cx - 13, cy - bh - 3, 26, bh * 2 + 6, 5).fill(0xe8742a).stroke({ width: 2, color: 0x7a3a10 });
      g.rect(cx - 2, cy - bh - 1, 4, bh * 2 + 2).fill({ color: 0xffffff, alpha: 0.35 });
      break;
    }
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
    case 'clock':
      drawClock(g, cx, cy + 1, h * 0.3);
      break;
    case 'exit':
      g.roundRect(cx - 22, cy - h * 0.36, 44, h * 0.72, 14).fill(0x2bd96b).stroke({ width: 4, color: 0xb6ffcf });
      g.poly([cx - 10, cy - 6, cx + 10, cy - 6, cx, cy + 10]).fill(0x0c4020);
      g.rect(cx - 4, cy - 18, 8, 13).fill(0x0c4020);
      break;
  }
  if (b.kind === 'drill' || b.kind === 'hdrill' || b.kind === 'hammer' || b.kind === 'magnet') {
    g.roundRect(p, p, w - 2 * p, h - 2 * p, 10).stroke({ width: 4, color: 0xffe66b, alpha: 0.9 });
  }
  if (b.kind === 'spring') g.roundRect(p, p, w - 2 * p, h - 2 * p, 10).stroke({ width: 4, color: 0xff7ad9, alpha: 0.95 });
  if (b.kind === 'anvil') g.roundRect(p, p, w - 2 * p, h - 2 * p, 10).stroke({ width: 3, color: 0x7df9ff, alpha: 0.45 });
  if (b.kind === 'clock') g.roundRect(p, p, w - 2 * p, h - 2 * p, 10).stroke({ width: 4, color: 0x7dffa8, alpha: 0.95 });
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
