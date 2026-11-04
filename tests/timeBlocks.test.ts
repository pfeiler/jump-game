import { describe, it, expect } from 'vitest';
import { MineGrid, makeBlock, COLS, TIME_BONUS, timeBlocksFor, type MineEvent } from '../src/games/minetime/grid';
import { SMOKE, smokeAlpha, smokeMaxDuration } from '../src/core/smoke';

function blank(rows = 12): MineGrid {
  const g = new MineGrid(1, 1);
  g.rows = rows;
  g.cells = Array.from({ length: rows }, () => Array.from({ length: COLS }, () => makeBlock('dirt')));
  g.exitCol = 0;
  g.cells[rows - 1][0] = makeBlock('exit');
  g.viewTop = 0;
  return g;
}
const timeEv = (ev: MineEvent[]) => ev.filter((e) => e.type === 'time');
const countClocks = (g: MineGrid) => g.cells.flat().filter((b) => b?.kind === 'clock').length;

describe('time blocks (Zeit-Blöcke)', () => {
  it('every level gets 2 (level 1–2) or 3 (level 3+) clocks, never in row 0 or on the exit', () => {
    for (let s = 1; s < 60; s++) {
      for (const lvl of [1, 2, 3, 6]) {
        const g = new MineGrid(s, lvl);
        expect(countClocks(g)).toBe(timeBlocksFor(lvl)); // bands never overlap
        expect(g.get(g.exitCol, g.exitRow)?.kind).toBe('exit');
        expect(g.cells[0].some((b) => b?.kind === 'clock')).toBe(false);
        // spread over the depth: first clock in the upper half
        const rows = g.cells.map((r, i) => (r.some((b) => b?.kind === 'clock') ? i : -1)).filter((i) => i >= 0);
        expect(rows[0]).toBeLessThan(g.rows / 2);
      }
    }
    expect(timeBlocksFor(1)).toBe(2);
    expect(timeBlocksFor(3)).toBe(3);
  });

  it('a hit breaks the clock in one go and grants +5 s', () => {
    const g = blank();
    g.cells[0][2] = makeBlock('clock');
    const ev = g.hit(2, 0);
    expect(timeEv(ev)).toEqual([{ type: 'time', col: 2, row: 0, seconds: TIME_BONUS, cause: 'hit' }]);
    expect(TIME_BONUS).toBe(5);
    expect(g.clocks).toBe(1);
    expect(g.timeBonus).toBe(5);
    expect(g.get(2, 0)).toBeNull();
  });

  it('bombs and the drill also collect clocks (time is never lost)', () => {
    const g = blank();
    g.cells[0][2] = makeBlock('bomb');
    g.cells[1][3] = makeBlock('clock');
    g.cells[0][1] = makeBlock('clock');
    const ev = g.hit(2, 0);
    expect(timeEv(ev)).toHaveLength(2);
    expect(g.timeBonus).toBe(10);
    const d = blank();
    d.cells[0][4] = makeBlock('drill');
    d.cells[6][4] = makeBlock('clock');
    expect(timeEv(d.hit(4, 0))[0]).toMatchObject({ cause: 'drill', seconds: 5 });
  });

  it('a clock in a caved-in row still counts', () => {
    const g = blank(14);
    g.cells[1][0] = makeBlock('clock');
    g.cells[1][1] = makeBlock('clock');
    for (let c = 0; c < COLS; c++) if (c !== 0 && c !== 1) g.hit(c, c * 10);
    let got = 0;
    for (let i = 0; i < 12; i++) got += timeEv(g.hit(3, 100 + i * 10)).length;
    expect(got).toBeGreaterThan(0);
    expect(g.timeBonus).toBe(got * 5);
  });
});

describe('TNT smoke is short and see-through', () => {
  it('no smoke puff lives longer than 1 s (was up to ~3.5 s)', () => {
    expect(smokeMaxDuration()).toBeLessThanOrEqual(1.0);
    expect(SMOKE.lifeMin).toBeGreaterThanOrEqual(0.6);
    expect(SMOKE.alpha).toBeLessThanOrEqual(0.55);
  });
  it('fades early: under half opacity by mid-life, gone at the end', () => {
    expect(smokeAlpha(0)).toBe(0);
    expect(smokeAlpha(0.06)).toBeCloseTo(1);
    expect(smokeAlpha(0.5)).toBeLessThan(0.5);
    expect(smokeAlpha(0.8)).toBeLessThan(0.1);
    expect(smokeAlpha(1)).toBe(0);
  });
});
