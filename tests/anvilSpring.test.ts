import { describe, it, expect } from 'vitest';
import { MineGrid, makeBlock, COLS, genProbs, hitsFor, TURBO_DURATION } from '../src/games/minetime/grid';

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

describe('Wucht-Amboss', () => {
  it('normal landings bounce off: KLONG, no damage, no penalty – even with hammer or turbo', () => {
    const g = blank();
    g.cells[0][3] = makeBlock('anvil');
    const score = g.score;
    for (let i = 0; i < 5; i++) {
      const ev = g.hit(3, i * 2, false);
      expect(ev.map((e) => e.type).filter((x) => x !== 'combo')).toEqual(['clank']);
    }
    g.hammerUntil = 100;
    g.turboUntil = 100;
    expect(g.hit(3, 20, false).map((e) => e.type).filter((x) => x !== 'combo')).toEqual(['clank']);
    expect(g.get(3, 0)?.kind).toBe('anvil');
    expect(g.get(3, 0)?.hp).toBe(g.get(3, 0)?.maxHp);
    expect(g.score).toBe(score);
    expect(g.get(3, 1)?.kind).toBe('dirt');
  });

  it('a high jump smashes it and it crashes 2–3 blocks deeper', () => {
    const depths = new Set<number>();
    for (let seed = 1; seed < 40; seed++) {
      const g = blank();
      const v = (seed * 0.137) % 1;
      (g as unknown as { rng: () => number }).rng = () => v;
      g.cells[0][3] = makeBlock('anvil');
      const ev = g.hit(3, 0, true);
      const a = ev.find((e) => e.type === 'anvil');
      expect(a).toBeTruthy();
      if (a?.type !== 'anvil') continue;
      expect(a.depth).toBeGreaterThanOrEqual(2);
      expect(a.depth).toBeLessThanOrEqual(3);
      depths.add(a.depth);
      expect(g.get(3, 0)).toBeNull();
      for (let k = 1; k <= a.depth; k++) expect(g.get(3, k)).toBeNull();
      // 2nd hit of the high jump could have taken the next one – at most one more
      const left = [a.depth + 1, a.depth + 2].filter((r) => g.get(3, r)).length;
      expect(left).toBeGreaterThanOrEqual(1);
      const breaks = ev.filter((e) => e.type === 'break' && e.cause === 'anvil').length;
      expect(breaks).toBe(a.depth);
    }
    expect([...depths].sort()).toEqual([2, 3]);
  });

  it('the crash stops above the exit block', () => {
    const g = blank(5);
    g.exitCol = 2;
    g.cells[4][0] = makeBlock('dirt');
    g.cells[2][2] = makeBlock('exit');
    g.cells[1][2] = makeBlock('anvil');
    g.cells[0][2] = null;
    (g as unknown as { rng: () => number }).rng = () => 0.9; // depth 2
    const ev = g.hit(2, 0, true);
    expect(ev.some((e) => e.type === 'anvil')).toBe(true);
    expect(g.get(2, 2)?.kind).toBe('exit');
  });

  it('bombs or drills just remove it (no crash)', () => {
    const g = blank();
    g.cells[0][2] = makeBlock('bomb');
    g.cells[0][3] = makeBlock('anvil');
    const ev = g.hit(2, 0, false);
    expect(ev.some((e) => e.type === 'anvil')).toBe(false);
    expect(g.get(3, 0)).toBeNull();
    expect(g.get(3, 2)?.kind).toBe('dirt');
  });

  it('generated levels: never in the exit column, max one per row, never stacked, never a full blocker', () => {
    for (let s = 0; s < 400; s++) {
      const lv = 1 + (s % 6);
      const g = new MineGrid(s * 104729 + 5, lv);
      g.cells.forEach((row, r) => {
        const anv = row.map((b, c) => (b?.kind === 'anvil' ? c : -1)).filter((c) => c >= 0);
        expect(anv.length).toBeLessThanOrEqual(1);
        for (const c of anv) {
          expect(c).not.toBe(g.exitCol);
          expect(r).toBeGreaterThan(0);
          expect(g.cells[r - 1]?.[c]?.kind).not.toBe('anvil');
        }
      });
      // exit column itself is always anvil-free → there is always a route without high jumps
      for (const row of g.cells) expect(row[g.exitCol]?.kind).not.toBe('anvil');
    }
  });

  it('spawn rate ≈ 3–5 %, rising with level', () => {
    const l1 = share(1, 'anvil'), l5 = share(5, 'anvil');
    expect(l1).toBeGreaterThan(0.025);
    expect(l1).toBeLessThan(0.045);
    expect(l5).toBeGreaterThan(l1);
    expect(l5).toBeLessThan(0.055);
    expect(genProbs(1, 0, 0).anvil).toBe(0);
    expect(genProbs(8, 10, 1).anvil).toBeLessThanOrEqual(0.055);
  });
});

describe('Feder-Block / Boing-Turbo', () => {
  it('hitsFor: normal 1 / high 2, with turbo 2 / 3', () => {
    expect([hitsFor(false, false), hitsFor(true, false), hitsFor(false, true), hitsFor(true, true)]).toEqual([1, 2, 2, 3]);
  });

  it('spring breaks in one hit and gives that player turbo for 4 s', () => {
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
