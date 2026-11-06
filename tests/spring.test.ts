import { describe, it, expect } from 'vitest';
import { MineGrid, makeBlock, COLS, hitsFor, TURBO_DURATION } from '../src/games/minetime/grid';

function blank(rows = 12): MineGrid {
  const g = new MineGrid(1, 1);
  g.rows = rows;
  g.cells = Array.from({ length: rows }, () => Array.from({ length: COLS }, () => makeBlock('dirt')));
  g.exitCol = 0;
  g.cells[rows - 1][0] = makeBlock('exit');
  g.viewTop = 0;
  return g;
}
const share = (level: number, kind: string, seeds = 300) => {
  let n = 0, tot = 0;
  for (let s = 0; s < seeds; s++) {
    const g = new MineGrid(s * 7919 + 11, level);
    for (const row of g.cells) for (const b of row) { if (!b || b.kind === 'exit') continue; tot++; if (b.kind === kind) n++; }
  }
  return n / tot;
};

describe('Feder-Block / Boing-Turbo', () => {
  it('hitsFor: normal 1 / high 2, with turbo 2 / 3', () => {
    expect([hitsFor(false, false), hitsFor(true, false), hitsFor(false, true), hitsFor(true, true)]).toEqual([1, 2, 2, 3]);
  });

  it('spring breaks in one hit and gives turbo for 4 s', () => {
    const g = blank();
    g.cells[0][1] = makeBlock('spring');
    const ev = g.hit(1, 10, false);
    expect(ev.some((e) => e.type === 'turbo')).toBe(true);
    expect(g.get(1, 0)).toBeNull();
    expect(g.turboActive(10 + TURBO_DURATION - 0.01)).toBe(true);
    expect(g.turboActive(10 + TURBO_DURATION + 0.01)).toBe(false);
  });

  it('turbo: normal landing = 2 hits, high jump = 3, expires', () => {
    const g = blank();
    // stone (not dirt) so the count is hits, without the brown-below rider
    for (const c of [2, 3, 5]) for (let r = 0; r < g.rows; r++) g.cells[r][c] = makeBlock('stone');
    g.turboUntil = 4;
    g.hit(2, 1, false); // 2 stone
    expect(g.topRow(2)).toBe(2);
    g.hit(3, 1.5, true); // 3 stone
    expect(g.topRow(3)).toBe(3);
    g.hit(5, 4.5, false); // expired
    expect(g.topRow(5)).toBe(1);
  });

  it('a second spring stacks up to max 8 s', () => {
    const g = blank();
    g.cells[0][1] = makeBlock('spring');
    g.cells[0][2] = makeBlock('spring');
    g.cells[0][3] = makeBlock('spring');
    g.hit(1, 0, false);
    g.hit(2, 1, false);
    expect(g.turboUntil).toBeCloseTo(8);
    g.hit(3, 2, false);
    expect(g.turboUntil).toBeCloseTo(10); // capped at t + 8
  });

  it('level pause freezes the turbo (shiftTimers)', () => {
    const g = blank();
    g.turboUntil = 5;
    g.hammerUntil = 6;
    g.shiftTimers(4, 10); // paused at t=4 for 10 s
    expect(g.turboUntil).toBe(15);
    expect(g.hammerUntil).toBe(16);
    expect(g.turboActive(14)).toBe(true);
  });

  it('spawn rate ≈ 4 %', () => {
    const s = share(2, 'spring');
    expect(s).toBeGreaterThan(0.03);
    expect(s).toBeLessThan(0.05);
  });
});
