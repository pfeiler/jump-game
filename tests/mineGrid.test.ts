import { describe, it, expect } from 'vitest';
import { MineGrid, makeBlock, COLS, VISIBLE_ROWS, levelBonus, comboMultiplier, type Block, type MineEvent } from '../src/games/minetime/grid';

/** grid filled with dirt (or a custom fill) so tests are deterministic */
function blank(rows = 12, fill: () => Block | null = () => makeBlock('dirt')): MineGrid {
  const g = new MineGrid(1, 1);
  g.rows = rows;
  g.cells = Array.from({ length: rows }, () => Array.from({ length: COLS }, fill));
  g.exitCol = 0;
  g.cells[rows - 1][0] = makeBlock('exit');
  g.viewTop = 0;
  return g;
}
const types = (ev: MineEvent[]) => ev.map((e) => e.type);

describe('MineGrid', () => {
  it('generates levels with an exit in the bottom row', () => {
    for (let s = 1; s < 20; s++) {
      const g = new MineGrid(s, 1 + (s % 4));
      expect(g.get(g.exitCol, g.rows - 1)?.kind).toBe('exit');
      expect(g.rows).toBeGreaterThanOrEqual(VISIBLE_ROWS);
    }
  });

  it('deeper levels contain more hard rock', () => {
    const count = (lvl: number) => {
      let n = 0, total = 0;
      for (let s = 0; s < 30; s++) {
        const g = new MineGrid(s, lvl);
        for (const row of g.cells) for (const b of row) { total++; if (b?.kind === 'hard') n++; }
      }
      return n / total;
    };
    expect(count(5)).toBeGreaterThan(count(1));
  });

  it('dirt breaks with one hit, stone needs 2, hard rock 3', () => {
    const g = blank();
    g.cells[0][1] = makeBlock('stone');
    g.cells[0][2] = makeBlock('hard');
    expect(types(g.hit(0, 0))).toContain('break');
    expect(g.get(0, 0)).toBeNull();
    expect(types(g.hit(1, 10))).toContain('damage');
    expect(g.get(1, 0)?.hp).toBe(1);
    g.hit(1, 20);
    expect(g.get(1, 0)).toBeNull();
    g.hit(2, 30); g.hit(2, 40);
    expect(g.get(2, 0)?.hp).toBe(1);
    g.hit(2, 50);
    expect(g.get(2, 0)).toBeNull();
  });

  it('hits the top-most remaining block of the column', () => {
    const g = blank();
    g.hit(3, 0);
    g.hit(3, 10);
    expect(g.topRow(3)).toBe(2);
  });

  it('high jump = double hit', () => {
    const g = blank();
    g.cells[0][1] = makeBlock('stone');
    g.hit(1, 0, true);
    expect(g.get(1, 0)).toBeNull();
    const g2 = blank();
    g2.hit(4, 0, true);
    expect(g2.topRow(4)).toBe(2);
  });

  it('bomb clears 1-tile radius and chains into other bombs', () => {
    const g = blank();
    g.cells[0][2] = makeBlock('bomb');
    g.cells[1][3] = makeBlock('bomb'); // neighbour → chain
    g.cells[1][1] = makeBlock('hard');
    const ev = g.hit(2, 0);
    expect(ev.filter((e) => e.type === 'bomb')).toHaveLength(2);
    // first bomb radius
    for (const [c, r] of [[1, 0], [3, 0], [1, 1], [2, 1], [3, 1]]) expect(g.get(c, r)).toBeNull();
    // chained bomb radius (around col 3,row 1)
    for (const [c, r] of [[4, 0], [4, 1], [4, 2], [2, 2], [3, 2]]) expect(g.get(c, r)).toBeNull();
    expect(g.get(5, 1)).not.toBeNull();
    expect(g.get(0, 0)).not.toBeNull();
  });

  it('drill clears the whole column below and reaches the exit', () => {
    const g = blank(12);
    g.cells[0][0] = makeBlock('drill');
    const ev = g.hit(0, 0);
    expect(types(ev)).toContain('powerup');
    expect(types(ev)).toContain('exitReached');
    expect(g.exitReached).toBe(true);
    for (let r = 0; r < 11; r++) expect(g.get(0, r)).toBeNull();
    expect(g.get(0, 11)?.kind).toBe('exit');
  });

  it('hammer doubles damage for 8 seconds', () => {
    const g = blank();
    g.cells[0][5] = makeBlock('hammer');
    g.cells[0][1] = makeBlock('stone');
    g.cells[0][2] = makeBlock('stone');
    g.hit(5, 0);
    expect(g.hammerActive(1)).toBe(true);
    g.hit(1, 2);
    expect(g.get(1, 0)).toBeNull(); // 2 damage in one hit
    g.hit(2, 9); // hammer expired
    expect(g.get(2, 0)?.hp).toBe(1);
  });

  it('magnet collects all visible gems', () => {
    const g = blank(12);
    g.cells[0][0] = makeBlock('magnet');
    g.cells[3][2] = makeBlock('gem', { gemType: 1, gemValue: 20 });
    g.cells[7][5] = makeBlock('gem', { gemType: 3, gemValue: 60 });
    g.cells[10][4] = makeBlock('gem', { gemType: 0, gemValue: 10 }); // not visible
    const ev = g.hit(0, 0);
    const gems = ev.filter((e) => e.type === 'gem');
    expect(gems).toHaveLength(2);
    expect(g.gems).toBe(2);
    expect(g.get(4, 10)?.kind).toBe('gem');
    expect(g.score).toBe(5 + 20 + 60);
  });

  it('gem points go to the score, combo multiplies, never deducts', () => {
    const g = blank();
    g.cells[0][0] = makeBlock('gem', { gemType: 0, gemValue: 10 });
    g.hit(0, 0);
    expect(g.score).toBe(10);
    // quick consecutive hits build a combo
    let t = 1;
    let last = g.score;
    for (let i = 0; i < 12; i++) {
      g.hit(1 + (i % 5), (t += 0.5));
      expect(g.score).toBeGreaterThanOrEqual(last);
      last = g.score;
    }
    expect(g.combo).toBeGreaterThanOrEqual(10);
    expect(g.multiplier).toBe(2);
    g.hit(1, t + 5); // pause → combo resets
    expect(g.combo).toBe(1);
    expect(comboMultiplier(5)).toBe(1.5);
  });

  it('view scrolls when top rows are cleared and caves in if a column runs out of view', () => {
    const g = blank(14);
    for (let c = 0; c < COLS; c++) g.hit(c, c * 10);
    expect(g.viewTop).toBe(1);
    // dig column 2 down until it leaves the visible window → cave-in
    let caveins = 0;
    for (let i = 0; i < 9; i++) caveins += g.hit(2, 100 + i * 10).filter((e) => e.type === 'cavein').length;
    expect(caveins).toBeGreaterThan(0);
    expect(g.topRow(2)).toBeLessThan(g.viewTop + VISIBLE_ROWS);
  });

  it('reaching the exit advances to a deeper level with bonus', () => {
    const g = blank(10);
    let t = 0;
    while (!g.exitReached && t < 1000) { g.hit(0, (t += 10)); }
    expect(g.exitReached).toBe(true);
    expect(g.hit(1, t + 1)).toHaveLength(0); // ignored until advanced
    const before = g.score;
    const bonus = g.advanceLevel();
    expect(bonus).toBe(levelBonus(1));
    expect(g.score).toBe(before + bonus);
    expect(g.level).toBe(2);
    expect(g.exitReached).toBe(false);
    expect(g.depthOffset).toBe(10);
    expect(g.rows).toBeGreaterThan(10);
  });
});
