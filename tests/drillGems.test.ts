import { describe, it, expect } from 'vitest';
import { MineGrid, makeBlock, COLS, POWER_MIX, genProbs, type MineEvent } from '../src/games/minetime/grid';
import { planGemPopups, GEM_POP_MAX_SINGLE, GEM_POP_DURATION } from '../src/games/minetime/popups';

function blank(rows = 12): MineGrid {
  const g = new MineGrid(1, 1);
  g.rows = rows;
  g.cells = Array.from({ length: rows }, () => Array.from({ length: COLS }, () => makeBlock('dirt')));
  g.exitCol = 0;
  g.cells[rows - 1][0] = makeBlock('exit');
  g.viewTop = 0;
  return g;
}
const share = (level: number, kinds: string[], seeds = 300) => {
  let n = 0, tot = 0;
  for (let s = 0; s < seeds; s++) {
    const g = new MineGrid(s * 7919 + 3, level);
    for (const row of g.cells) for (const b of row) { if (!b) continue; tot++; if (kinds.includes(b.kind)) n++; }
  }
  return n / tot;
};

describe('horizontal drill (Quer-Bohrer)', () => {
  it('clears the whole row left and right, nothing else', () => {
    const g = blank();
    // make row 0 deeper in col 2 so the hdrill sits in row 2 of that column
    g.cells[0][2] = null; g.cells[1][2] = null;
    g.cells[2][2] = makeBlock('hdrill');
    g.cells[2][5] = makeBlock('stone');
    g.cells[2][0] = makeBlock('gem', { gemType: 3, gemValue: 60 });
    const ev = g.hit(2, 0);
    expect(ev).toContainEqual({ type: 'powerup', kind: 'hdrill', col: 2, row: 2 });
    for (let c = 0; c < COLS; c++) expect(g.get(c, 2)).toBeNull(); // stone and gem too
    for (let c = 0; c < COLS; c++) { expect(g.get(c, 3)).not.toBeNull(); if (c !== 2) expect(g.get(c, 1)).not.toBeNull(); }
    expect(ev.filter((e) => e.type === 'break' && e.cause === 'hdrill')).toHaveLength(5);
    expect(ev.some((e) => e.type === 'gem' && e.cause === 'hdrill')).toBe(true);
  });

  it('chains into a vertical drill in the same row', () => {
    const g = blank(12);
    g.cells[0][3] = makeBlock('hdrill');
    g.cells[0][5] = makeBlock('drill');
    const ev = g.hit(3, 0);
    expect(ev.filter((e) => e.type === 'powerup').map((e) => (e as Extract<MineEvent, { type: 'powerup' }>).kind)).toEqual(['hdrill', 'drill']);
    for (let r = 0; r < 11; r++) expect(g.get(5, r)).toBeNull();
  });

  it('both drill types appear about equally often in generated levels', () => {
    const h = share(3, ['hdrill'], 600), v = share(3, ['drill'], 600);
    expect(h).toBeGreaterThan(0);
    expect(h / v).toBeGreaterThan(0.7);
    expect(h / v).toBeLessThan(1.4);
    expect(POWER_MIX.reduce((a, [, p]) => a + p, 0)).toBeCloseTo(1);
  });
});

describe('generation balance: fewer stones, more gems', () => {
  it('stone share roughly halved, gem share up by ~60 %', () => {
    // previous generator (for reference): level 1 ≈ 28 % stone, 12 % gems; level 3 ≈ 28 % / 16 %
    expect(share(1, ['stone'])).toBeLessThan(0.17);
    expect(share(1, ['gem'])).toBeGreaterThan(0.17);
    expect(share(3, ['stone'])).toBeLessThan(0.17);
    expect(share(3, ['gem'])).toBeGreaterThan(0.21);
    expect(genProbs(30, 5, 1).gem).toBeLessThanOrEqual(0.3);
  });
  it('still gets harder: deeper levels have more hard rock, but less than before', () => {
    expect(share(5, ['hard'])).toBeGreaterThan(share(1, ['hard']));
    expect(share(5, ['hard'])).toBeLessThan(0.26); // was ≈ 28 %
    expect(share(1, ['dirt'])).toBeGreaterThan(0.4); // still plenty of quick 1-hit blocks
  });
  it('diamonds appear already in level 1 and dominate deep levels', () => {
    let d = 0, n = 0;
    for (let s = 0; s < 300; s++) for (const row of new MineGrid(s + 11, 1).cells) for (const b of row) if (b?.kind === 'gem') { n++; if (b.gemType === 3) d++; }
    expect(d / n).toBeGreaterThan(0.1); // was ≈ 5 %
  });
});

describe('gem point pop-ups', () => {
  it('one pop-up per gem, staggered, for a few gems', () => {
    const p = planGemPopups([{ col: 1, row: 2, points: 50, gemType: 3 }, { col: 2, row: 2, points: 20, gemType: 1 }]);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ text: '+50', gemType: 3, col: 1, row: 2, delay: 0, combined: false });
    expect(p[1].text).toBe('+20');
    expect(p[1].delay).toBeGreaterThan(0);
    expect(p[1].delay).toBeLessThan(0.15);
    expect(GEM_POP_DURATION).toBeGreaterThanOrEqual(0.6);
    expect(GEM_POP_DURATION).toBeLessThanOrEqual(0.8);
  });
  it('many gems at once (TNT/drill/magnet) are combined into one pop-up', () => {
    const gems = Array.from({ length: 6 }, (_, i) => ({ col: i, row: 4, points: 10 * (i + 1), gemType: i % 4 }));
    const p = planGemPopups(gems);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ text: '+210  (6×)', combined: true, gemType: 3, count: 6, row: 4 });
    expect(p[0].col).toBeCloseTo(2.5);
    expect(planGemPopups(gems.slice(0, GEM_POP_MAX_SINGLE))).toHaveLength(GEM_POP_MAX_SINGLE);
    expect(planGemPopups([])).toEqual([]);
  });
  it('gems destroyed by TNT produce gem events (→ pop-ups) with their points', () => {
    const g = blank();
    g.cells[0][2] = makeBlock('bomb');
    g.cells[1][2] = makeBlock('gem', { gemType: 2, gemValue: 35 });
    const ev = g.hit(2, 0);
    const gems = ev.filter((e) => e.type === 'gem') as Extract<MineEvent, { type: 'gem' }>[];
    expect(gems).toHaveLength(1);
    expect(gems[0]).toMatchObject({ cause: 'bomb', points: 35 });
    expect(planGemPopups(gems)[0].text).toBe('+35');
  });
});
