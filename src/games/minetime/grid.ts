/**
 * Mine Time – pure game logic (no rendering), fully unit-tested.
 *
 * Our own rule design (official ValoJump rules are not public):
 *  - 6 columns, 8 visible rows; each landing hits the top-most block of the
 *    column the player stands in, a high jump hits twice.
 *  - dirt 1 hit, stone 2, hard rock 3, gems (points scale with depth/level),
 *    bomb (clears 1-tile radius, chains), power-ups: drill, hammer, magnet.
 *  - an exit tile sits in the bottom row; uncovering it finishes the level.
 *  - score only ever goes up (gems + break points × combo, level bonus).
 */
import { mulberry32 } from '../../core/rng';

export const COLS = 6;
export const VISIBLE_ROWS = 8;
export const HAMMER_DURATION = 8;
export const COMBO_WINDOW = 1.6;

export type BlockKind = 'dirt' | 'stone' | 'hard' | 'gem' | 'bomb' | 'drill' | 'hammer' | 'magnet' | 'exit';
export type PowerKind = 'drill' | 'hammer' | 'magnet';
export type Cause = 'hit' | 'bomb' | 'drill' | 'magnet' | 'cavein';

export interface Block {
  kind: BlockKind;
  hp: number;
  maxHp: number;
  /** 0 emerald, 1 sapphire, 2 ruby, 3 diamond */
  gemType?: number;
  gemValue?: number;
}

export type MineEvent =
  | { type: 'damage'; col: number; row: number; block: Block }
  | { type: 'break'; col: number; row: number; block: Block; points: number; cause: Cause }
  | { type: 'gem'; col: number; row: number; gemType: number; points: number; cause: Cause }
  | { type: 'bomb'; col: number; row: number }
  | { type: 'powerup'; kind: PowerKind; col: number; row: number }
  | { type: 'combo'; combo: number; multiplier: number }
  | { type: 'empty'; col: number }
  | { type: 'cavein'; row: number }
  | { type: 'exitReached'; col: number; row: number };

const BREAK_POINTS: Record<BlockKind, number> = {
  dirt: 1, stone: 3, hard: 5, gem: 0, bomb: 5, drill: 5, hammer: 5, magnet: 5, exit: 0,
};
const GEM_BASE = [10, 20, 35, 60];

export const comboMultiplier = (combo: number): number =>
  combo >= 20 ? 3 : combo >= 10 ? 2 : combo >= 5 ? 1.5 : 1;

export const levelRows = (level: number): number => Math.min(22, 10 + 2 * level);
export const levelBonus = (level: number): number => 100 * level;

export function makeBlock(kind: BlockKind, extra: Partial<Block> = {}): Block {
  const hp = kind === 'stone' ? 2 : kind === 'hard' ? 3 : 1;
  return { kind, hp, maxHp: hp, ...extra };
}

export class MineGrid {
  cells: (Block | null)[][] = []; // [row][col]
  rows = 0;
  level = 1;
  score = 0;
  combo = 0;
  multiplier = 1;
  lastHitT = -999;
  hammerUntil = -999;
  viewTop = 0;
  exitCol = 0;
  exitReached = false;
  gems = 0;
  blocksBroken = 0;
  /** total rows dug through in previous levels (for the depth display) */
  depthOffset = 0;
  private rng: () => number;

  constructor(seed = Date.now(), level = 1) {
    this.rng = mulberry32(seed);
    this.generate(level);
  }

  get exitRow(): number {
    return this.rows - 1;
  }

  hammerActive(t: number): boolean {
    return t < this.hammerUntil;
  }

  /** Generates a random level; deeper levels have more hard rock and better gems. */
  generate(level: number): void {
    const r = this.rng;
    this.level = level;
    this.rows = levelRows(level);
    this.viewTop = 0;
    this.exitReached = false;
    this.exitCol = Math.floor(r() * COLS);
    this.cells = [];
    let powerups = 0;
    for (let row = 0; row < this.rows; row++) {
      const line: (Block | null)[] = [];
      const d = row / this.rows;
      for (let col = 0; col < COLS; col++) {
        if (row === this.exitRow && col === this.exitCol) {
          line.push(makeBlock('exit'));
          continue;
        }
        const x = r();
        const pGem = 0.1 + 0.02 * level;
        const pBomb = 0.045;
        const pPow = powerups < 2 + level ? 0.035 : 0;
        const pHard = row === 0 ? 0 : Math.min(0.45, 0.04 + 0.14 * d + 0.05 * (level - 1));
        const pStone = 0.25 + 0.1 * d;
        let acc = pGem;
        if (x < acc) {
          const q = r() + d * 0.35 + (level - 1) * 0.12;
          const gemType = q > 1.15 ? 3 : q > 0.85 ? 2 : q > 0.5 ? 1 : 0;
          const value = Math.round((GEM_BASE[gemType] * (1 + 0.25 * (level - 1)) * (1 + d)) / 5) * 5;
          line.push(makeBlock('gem', { gemType, gemValue: value }));
          continue;
        }
        if (x < (acc += pBomb)) { line.push(makeBlock('bomb')); continue; }
        if (x < (acc += pPow)) {
          powerups++;
          const kinds: PowerKind[] = ['drill', 'hammer', 'magnet'];
          line.push(makeBlock(kinds[Math.floor(r() * 3)]));
          continue;
        }
        if (x < (acc += pHard)) { line.push(makeBlock('hard')); continue; }
        if (x < (acc += pStone)) { line.push(makeBlock('stone')); continue; }
        line.push(makeBlock('dirt'));
      }
      this.cells.push(line);
    }
  }

  get(col: number, row: number): Block | null {
    return this.cells[row]?.[col] ?? null;
  }

  /** Index of the top-most remaining block in `col`, or `rows` if empty. */
  topRow(col: number): number {
    for (let row = 0; row < this.rows; row++) if (this.cells[row][col]) return row;
    return this.rows;
  }

  /** Depth in rows (across levels) for display. */
  get depth(): number {
    return this.depthOffset + this.viewTop;
  }

  /**
   * A landing in `col`. `high` = high jump (two hits). Returns all resulting events
   * so the renderer can play effects.
   */
  hit(col: number, t: number, high = false): MineEvent[] {
    const ev: MineEvent[] = [];
    if (this.exitReached) return ev;
    col = Math.max(0, Math.min(COLS - 1, col));
    // combo
    this.combo = t - this.lastHitT <= COMBO_WINDOW ? this.combo + 1 : 1;
    this.lastHitT = t;
    this.multiplier = comboMultiplier(this.combo);
    ev.push({ type: 'combo', combo: this.combo, multiplier: this.multiplier });

    const hits = high ? 2 : 1;
    for (let i = 0; i < hits && !this.exitReached; i++) {
      const row = this.topRow(col);
      if (row >= this.rows) { ev.push({ type: 'empty', col }); break; }
      const b = this.cells[row][col]!;
      if (b.kind === 'exit') { this.checkExit(ev); break; }
      const dmg = this.hammerActive(t) ? 2 : 1;
      b.hp -= dmg;
      if (b.hp <= 0) this.destroy(col, row, 'hit', t, ev);
      else ev.push({ type: 'damage', col, row, block: b });
      this.checkExit(ev);
    }
    if (!this.exitReached) this.settle(ev, t);
    return ev;
  }

  private award(points: number): number {
    const p = Math.round(points * this.multiplier);
    this.score += p;
    return p;
  }

  /** Removes a block and resolves its effect (bombs chain via a queue). */
  private destroy(col: number, row: number, cause: Cause, t: number, ev: MineEvent[]): void {
    const queue: [number, number, Cause][] = [[col, row, cause]];
    while (queue.length) {
      const [c, r, why] = queue.shift()!;
      const b = this.cells[r]?.[c];
      if (!b || b.kind === 'exit') continue;
      this.cells[r][c] = null;
      this.blocksBroken++;
      if (b.kind === 'gem') {
        const points = this.award(b.gemValue ?? 10);
        this.gems++;
        ev.push({ type: 'gem', col: c, row: r, gemType: b.gemType ?? 0, points, cause: why });
        ev.push({ type: 'break', col: c, row: r, block: b, points: 0, cause: why });
        continue;
      }
      const points = this.award(BREAK_POINTS[b.kind]);
      ev.push({ type: 'break', col: c, row: r, block: b, points, cause: why });
      if (why === 'cavein') continue; // collapsing rows don't trigger effects
      switch (b.kind) {
        case 'bomb':
          ev.push({ type: 'bomb', col: c, row: r });
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const nc = c + dc, nr = r + dr;
              if (nc < 0 || nc >= COLS || nr < 0 || nr >= this.rows) continue;
              if (this.cells[nr][nc]) queue.push([nc, nr, 'bomb']);
            }
          break;
        case 'drill':
          ev.push({ type: 'powerup', kind: 'drill', col: c, row: r });
          for (let nr = r + 1; nr < this.rows; nr++) if (this.cells[nr][c]) queue.push([c, nr, 'drill']);
          break;
        case 'hammer':
          ev.push({ type: 'powerup', kind: 'hammer', col: c, row: r });
          this.hammerUntil = Math.max(t, this.hammerUntil) + HAMMER_DURATION;
          if (this.hammerUntil - t > HAMMER_DURATION * 2) this.hammerUntil = t + HAMMER_DURATION * 2;
          break;
        case 'magnet': {
          ev.push({ type: 'powerup', kind: 'magnet', col: c, row: r });
          const end = Math.min(this.rows, this.viewTop + VISIBLE_ROWS);
          for (let nr = this.viewTop; nr < end; nr++)
            for (let nc = 0; nc < COLS; nc++)
              if (this.cells[nr][nc]?.kind === 'gem') queue.push([nc, nr, 'magnet']);
          break;
        }
      }
    }
  }

  private checkExit(ev: MineEvent[]): void {
    if (!this.exitReached && this.topRow(this.exitCol) === this.exitRow) {
      this.exitReached = true;
      ev.push({ type: 'exitReached', col: this.exitCol, row: this.exitRow });
    }
  }

  /** Scrolls the view: cleared top rows scroll away; if a column is dug out of
   *  view the top row caves in so there is always something to hit. */
  private settle(ev: MineEvent[], t: number): void {
    const maxTop = Math.max(0, this.rows - VISIBLE_ROWS);
    for (;;) {
      let minTop = this.rows;
      let deepest = 0;
      for (let c = 0; c < COLS; c++) {
        const tr = this.topRow(c);
        minTop = Math.min(minTop, tr);
        deepest = Math.max(deepest, tr);
      }
      const target = Math.min(maxTop, Math.max(this.viewTop, minTop));
      if (target > this.viewTop) { this.viewTop = target; continue; }
      if (deepest >= this.viewTop + VISIBLE_ROWS && this.viewTop < maxTop) {
        const row = this.viewTop;
        ev.push({ type: 'cavein', row });
        for (let c = 0; c < COLS; c++) if (this.cells[row][c]) this.destroy(c, row, 'cavein', t, ev);
        this.viewTop++;
        continue;
      }
      break;
    }
    this.checkExit(ev);
  }

  /** Call after the exit celebration: awards the depth bonus and builds the next level. */
  advanceLevel(): number {
    const bonus = levelBonus(this.level);
    this.score += bonus;
    this.depthOffset += this.rows;
    this.generate(this.level + 1);
    return bonus;
  }
}
