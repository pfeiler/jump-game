import { describe, it, expect } from 'vitest';
import { MineGrid, makeBlock, COLS, VISIBLE_ROWS, SKY_ROWS, levelBonus, comboMultiplier, type Block, type BlockKind, type MineEvent } from '../src/games/minetime/grid';

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

  it('brown dirt breaks on a half jump, and the brown block directly below', () => {
    const g = blank();
    const ev = g.hit(0, 0, false);
    expect(types(ev)).toContain('break');
    expect(g.get(0, 0)).toBeNull();
    expect(g.get(0, 1)).toBeNull();
    expect(g.get(0, 2)?.kind).toBe('dirt'); // one below, no cascade
    const breaks = ev.filter((e) => e.type === 'break');
    expect(breaks).toHaveLength(2);
  });

  it('a half jump does not destroy a non-brown block under the dirt', () => {
    const kinds: BlockKind[] = ['stone', 'hard', 'gem', 'bomb', 'spring', 'anvil', 'clock', 'drill', 'hdrill', 'hammer', 'magnet'];
    for (const kind of kinds) {
      const g = blank();
      g.cells[1][2] = kind === 'gem' ? makeBlock('gem', { gemType: 1, gemValue: 20 }) : makeBlock(kind);
      g.hit(2, 0, false);
      expect(g.get(2, 0), kind).toBeNull();
      expect(g.get(2, 1)?.kind, kind).toBe(kind);
      expect(g.get(2, 2)?.kind, kind).toBe('dirt');
      if (kind === 'anvil') expect(g.get(2, 1)?.hp).toBe(g.get(2, 1)?.maxHp);
    }
    // dirt sitting on the exit: the exit itself stays, and the level still completes
    const guard = blank(4);
    guard.cells[0][1] = makeBlock('dirt');
    guard.cells[1][1] = makeBlock('dirt');
    guard.cells[2][1] = makeBlock('dirt');
    guard.exitCol = 1;
    guard.cells[3][0] = makeBlock('dirt');
    guard.cells[3][1] = makeBlock('exit');
    guard.hit(1, 0, false); // rows 0 and 1
    guard.hit(1, 10, false); // row 2, row 3 is exit → not brown
    expect(guard.get(1, 3)?.kind).toBe('exit');
    expect(guard.exitReached).toBe(true);
  });

  it('turbo digs extra blocks, and a high jump does not gain the brown rider', () => {
    const g = blank();
    g.turboUntil[0] = 10;
    g.hit(1, 1, false, 0); // two hits, each brown break takes the dirt below
    expect(g.topRow(1)).toBe(4);
    const h = blank();
    h.turboUntil[0] = 10;
    h.hit(1, 1, true, 0); // three hits, no rider
    expect(h.topRow(1)).toBe(3);
  });

  it('gray stone breaks with one normal jump and does not pull the block below', () => {
    const g = blank();
    g.cells[0][1] = makeBlock('stone');
    g.cells[1][1] = makeBlock('stone');
    expect(types(g.hit(1, 0, false))).toContain('break');
    expect(g.get(1, 0)).toBeNull();
    expect(g.get(1, 1)?.kind).toBe('stone');
    expect(g.get(1, 1)?.hp).toBe(1);
    // dirt under a stone is not the brown-below rider
    const g2 = blank();
    g2.cells[0][2] = makeBlock('stone');
    g2.hit(2, 5, false);
    expect(g2.get(2, 0)).toBeNull();
    expect(g2.get(2, 1)?.kind).toBe('dirt');
  });

  it('hard rock still needs 3 hits', () => {
    const g = blank();
    g.cells[0][2] = makeBlock('hard');
    g.hit(2, 30); g.hit(2, 40);
    expect(g.get(2, 0)?.hp).toBe(1);
    g.hit(2, 50);
    expect(g.get(2, 0)).toBeNull();
    expect(g.get(2, 1)?.kind).toBe('dirt'); // breaking hard does not take the dirt below
  });

  it('hits the top-most remaining block of the column', () => {
    const g = blank();
    for (let r = 0; r < g.rows; r++) g.cells[r][3] = makeBlock('stone');
    g.hit(3, 0);
    g.hit(3, 10);
    expect(g.topRow(3)).toBe(2);
  });

  it('high jump = double hit (no extra brown block below)', () => {
    const g = blank();
    g.cells[0][1] = makeBlock('hard');
    g.hit(1, 0, true);
    expect(g.get(1, 0)?.hp).toBe(1); // 3 − 2
    const g2 = blank();
    g2.hit(4, 0, true);
    expect(g2.topRow(4)).toBe(2);
  });

  it('generated levels leave the top row empty and keep that air on screen', () => {
    for (let s = 1; s <= 20; s++) {
      const g = new MineGrid(s * 17, 1 + (s % 4));
      expect(g.cells[0].every((b) => b === null)).toBe(true);
      expect(g.viewTop).toBe(0);
      expect(g.topRow(0)).toBe(1);
      expect(g.get(g.exitCol, g.exitRow)?.kind).toBe('exit');
      for (let c = 0; c < COLS; c++) expect(g.cells[0][c]).toBeNull();
    }
    const g = blank(16);
    for (let c = 0; c < COLS; c++) g.cells[0][c] = null;
    g.hit(1, 0, false);
    expect(g.viewTop).toBe(0); // other columns still hold the ceiling
    expect(g.get(0, 1)?.kind).toBe('dirt');
    for (let c = 0; c < COLS; c++) if (g.topRow(c) < 2) g.hit(c, 5 + c, false);
    expect(g.viewTop).toBe(2); // min top 3, one sky row
    expect(SKY_ROWS).toBe(1);
    for (let c = 0; c < COLS; c++) {
      expect(g.get(c, g.viewTop)).toBeNull();
      expect(g.topRow(c)).toBe(g.viewTop + SKY_ROWS);
    }
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
    g.cells[0][1] = makeBlock('hard');
    g.cells[0][2] = makeBlock('hard');
    g.hit(5, 0);
    expect(g.hammerActive(1)).toBe(true);
    g.hit(1, 2);
    expect(g.get(1, 0)?.hp).toBe(1); // 3 HP, hammer hits for 2
    g.hit(2, 9); // hammer expired
    expect(g.get(2, 0)?.hp).toBe(2);
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
    for (let c = 0; c < COLS; c++) g.hit(c, c * 10); // each hop clears two brown blocks
    expect(g.viewTop).toBe(1); // highest block is row 2, one air row stays above it
    // dig column 2 down until it leaves the visible window → cave-in
    let caveins = 0;
    for (let i = 0; i < 9; i++) caveins += g.hit(2, 100 + i * 10).filter((e) => e.type === 'cavein').length;
    expect(caveins).toBeGreaterThan(0);
    // a block still in that column is back inside the window; an emptied column has nowhere left to scroll
    const tr = g.topRow(2);
    if (tr < g.rows) expect(tr).toBeLessThan(g.viewTop + VISIBLE_ROWS);
    else expect(g.viewTop).toBe(Math.max(0, g.rows - VISIBLE_ROWS));
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
