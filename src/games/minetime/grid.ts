/**
 * Mine Time – pure game logic (no rendering), fully unit-tested.
 *
 * Our own rule design (official ValoJump rules are not public):
 *  - 6 columns, 8 visible rows; the uppermost row is open air and the view keeps
 *    one air row above the blocks. Each landing hits the top-most block of the
 *    column the player stands in. A normal/half jump is one hit, a high jump hits twice.
 *  - brown dirt: a normal hop breaks it and, if the block directly underneath is
 *    also brown dirt, that one too. Gray stone: one normal hop. Hard rock: 3.
 *    Gems (points scale with depth/level), bomb (clears 1-tile radius, chains),
 *    power-ups: drill (column), cross drill (row), hammer, magnet.
 *  - time blocks (clock): +TIME_BONUS seconds on the countdown, 2–3 per level.
 *  - anvil (Wucht-Amboss): normal landings bounce off ("Klong"), only a high jump smashes it;
 *    it then crashes 2–3 blocks deeper. Never in the exit column, at most one per row.
 *  - spring (Feder-Block): 1 hit, gives that player TURBO for 4 s (landing ×2, high jump ×3).
 *  - an exit tile sits in the bottom row; uncovering it finishes the level.
 *  - score only ever goes up (gems + break points × combo, level bonus).
 */
import { mulberry32 } from '../../core/rng';

export const COLS = 6;
export const VISIBLE_ROWS = 8;
export const HAMMER_DURATION = 8;
export const COMBO_WINDOW = 1.6;
/** seconds a time block adds to the countdown */
export const TIME_BONUS = 5;
/** Boing-Turbo duration (s) */
export const TURBO_DURATION = 4;
/** hits per landing: normal/half jump 1, high 2; with turbo normal 2, high 3 */
export const hitsFor = (high: boolean, turbo: boolean): number => (turbo ? (high ? 3 : 2) : high ? 2 : 1);
/** open rows kept above the highest block so the top of the playfield stays air */
export const SKY_ROWS = 1;
/** time blocks per level: 2 in the first two levels, 3 from level 3 (deeper levels take longer) */
export const timeBlocksFor = (level: number): number => (level >= 3 ? 3 : 2);

export type BlockKind = 'dirt' | 'stone' | 'hard' | 'gem' | 'bomb' | 'drill' | 'hdrill' | 'hammer' | 'magnet' | 'clock' | 'anvil' | 'spring' | 'exit';
export type PowerKind = 'drill' | 'hdrill' | 'hammer' | 'magnet';
export type Cause = 'hit' | 'bomb' | 'drill' | 'hdrill' | 'magnet' | 'anvil' | 'cavein';

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
  | { type: 'time'; col: number; row: number; seconds: number; cause: Cause }
  | { type: 'clank'; col: number; row: number }
  | { type: 'anvil'; col: number; row: number; depth: number }
  | { type: 'turbo'; player: number; col: number; row: number; until: number }
  | { type: 'cavein'; row: number }
  | { type: 'exitReached'; col: number; row: number };

const BREAK_POINTS: Record<BlockKind, number> = {
  dirt: 1, stone: 3, hard: 5, gem: 0, bomb: 5, drill: 5, hdrill: 5, hammer: 5, magnet: 5, clock: 5, anvil: 10, spring: 3, exit: 0,
};
const GEM_BASE = [10, 20, 35, 60];

export const comboMultiplier = (combo: number): number =>
  combo >= 20 ? 3 : combo >= 10 ? 2 : combo >= 5 ? 1.5 : 1;

/** power-up mix (cumulative draw): both drill types equally often, together 44 % */
export const POWER_MIX: [PowerKind, number][] = [['drill', 0.22], ['hdrill', 0.22], ['hammer', 0.28], ['magnet', 0.28]];
/** level-generation probabilities per cell (d = relative depth 0..1 inside the level) */
export const genProbs = (level: number, row: number, d: number) => ({
  gem: Math.min(0.3, 0.17 + 0.025 * level),
  bomb: 0.045,
  power: 0.035,
  hard: row === 0 ? 0 : Math.min(0.35, 0.03 + 0.1 * d + 0.04 * (level - 1)),
  stone: 0.12 + 0.06 * d,
  /** Feder-Block ≈ 4 % */
  spring: 0.04,
  /** Wucht-Amboss ≈ 3 % (level 1) → 4–5 % (deep rows / later levels), never in row 0 */
  anvil: row === 0 ? 0 : Math.min(0.055, 0.038 + 0.006 * (level - 1) + 0.012 * d),
});

export const levelRows = (level: number): number => Math.min(22, 10 + 2 * level);
export const levelBonus = (level: number): number => 100 * level;

export function makeBlock(kind: BlockKind, extra: Partial<Block> = {}): Block {
  // gray stone breaks on one normal jump; only hard rock still needs several hits
  const hp = kind === 'hard' ? 3 : 1;
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
  /** Boing-Turbo end time per player */
  turboUntil = [-999, -999];
  /** player whose landing is being resolved (springs give turbo to them) */
  private curPlayer = 0;
  viewTop = 0;
  exitCol = 0;
  exitReached = false;
  gems = 0;
  blocksBroken = 0;
  /** time blocks collected / seconds won (whole game) */
  clocks = 0;
  timeBonus = 0;
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

  turboActive(player: number, t: number): boolean {
    return t < (this.turboUntil[player] ?? -999);
  }

  /** Level pause: timed power-ups (hammer, turbo) don't run out while paused. */
  shiftTimers(pauseStart: number, pausedFor: number): void {
    if (this.hammerUntil > pauseStart) this.hammerUntil += pausedFor;
    for (let i = 0; i < this.turboUntil.length; i++) if (this.turboUntil[i] > pauseStart) this.turboUntil[i] += pausedFor;
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
      // uppermost row is open air: more room at the top of the screen. The exit
      // stays on the bottom row (levels are always taller than one row).
      if (row === 0 && row !== this.exitRow) {
        this.cells.push(Array.from({ length: COLS }, () => null));
        continue;
      }
      const d = row / this.rows;
      for (let col = 0; col < COLS; col++) {
        if (row === this.exitRow && col === this.exitCol) {
          line.push(makeBlock('exit'));
          continue;
        }
        const x = r();
        const pr = genProbs(level, row, d);
        const pGem = pr.gem;
        const pBomb = pr.bomb;
        const pPow = powerups < 2 + level ? pr.power : 0;
        const pHard = pr.hard;
        const pStone = pr.stone;
        // anvil: never in the exit column, at most one per row, never directly below another anvil
        const anvilOk = col !== this.exitCol && !line.some((b) => b?.kind === 'anvil') && this.cells[row - 1]?.[col]?.kind !== 'anvil';
        const pSpring = pr.spring;
        const pAnvil = anvilOk ? pr.anvil : 0;
        let acc = pGem;
        if (x < acc) {
          // a bit better gems than before (+0.12): diamonds already show up in level 1–2
          const q = r() + d * 0.35 + (level - 1) * 0.12 + 0.12;
          const gemType = q > 1.15 ? 3 : q > 0.85 ? 2 : q > 0.5 ? 1 : 0;
          const value = Math.round((GEM_BASE[gemType] * (1 + 0.25 * (level - 1)) * (1 + d)) / 5) * 5;
          line.push(makeBlock('gem', { gemType, gemValue: value }));
          continue;
        }
        if (x < (acc += pBomb)) { line.push(makeBlock('bomb')); continue; }
        if (x < (acc += pPow)) {
          powerups++;
          const y = r();
          let a = 0;
          const kind = POWER_MIX.find(([, p]) => y < (a += p))?.[0] ?? 'magnet';
          line.push(makeBlock(kind));
          continue;
        }
        if (x < (acc += pSpring)) { line.push(makeBlock('spring')); continue; }
        if (x < (acc += pAnvil)) { line.push(makeBlock('anvil')); continue; }
        if (x < (acc += pHard)) { line.push(makeBlock('hard')); continue; }
        if (x < (acc += pStone)) { line.push(makeBlock('stone')); continue; }
        line.push(makeBlock('dirt'));
      }
      this.cells.push(line);
    }
    this.placeClocks(timeBlocksFor(level));
  }

  /** Spreads `n` time blocks over the depth of the level (one per depth band, never row 0 or the exit row). */
  private placeClocks(n: number): void {
    const r = this.rng;
    const first = 1, last = this.exitRow - 1; // rows that may hold a clock
    const span = last - first + 1;
    for (let i = 0; i < n; i++) {
      const lo = first + Math.floor((i * span) / n), hi = first + Math.floor(((i + 1) * span) / n) - 1;
      const row = lo + Math.floor(r() * (hi - lo + 1));
      const col = Math.floor(r() * COLS);
      this.cells[row][col] = makeBlock('clock');
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
  hit(col: number, t: number, high = false, player = 0): MineEvent[] {
    const ev: MineEvent[] = [];
    if (this.exitReached) return ev;
    col = Math.max(0, Math.min(COLS - 1, col));
    // combo
    this.combo = t - this.lastHitT <= COMBO_WINDOW ? this.combo + 1 : 1;
    this.lastHitT = t;
    this.multiplier = comboMultiplier(this.combo);
    ev.push({ type: 'combo', combo: this.combo, multiplier: this.multiplier });

    this.curPlayer = player;
    const hits = hitsFor(high, this.turboActive(player, t));
    for (let i = 0; i < hits && !this.exitReached; i++) {
      const row = this.topRow(col);
      if (row >= this.rows) { ev.push({ type: 'empty', col }); break; }
      const b = this.cells[row][col]!;
      if (b.kind === 'exit') { this.checkExit(ev); break; }
      // the anvil only gives way to a high jump – a normal landing bounces off (no damage, no penalty)
      if (b.kind === 'anvil' && !high) { ev.push({ type: 'clank', col, row }); break; }
      const dmg = this.hammerActive(t) ? 2 : 1;
      b.hp -= dmg;
      if (b.hp <= 0) {
        const kind = b.kind;
        this.destroy(col, row, 'hit', t, ev);
        // Brown dirt, normal/half jump only: also break the brown block directly
        // underneath. Anything else (stone, gem, anvil, …) stays. One block, no
        // cascade. High jumps stay pure multi-hits so anvils and hit counts don't shift.
        if (!high && kind === 'dirt') {
          const below = this.cells[row + 1]?.[col];
          if (below?.kind === 'dirt') this.destroy(col, row + 1, 'hit', t, ev);
        }
      } else ev.push({ type: 'damage', col, row, block: b });
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
      if (b.kind === 'clock') {
        // time is always credited – also when a bomb, drill or cave-in takes the block
        this.clocks++;
        this.timeBonus += TIME_BONUS;
        ev.push({ type: 'time', col: c, row: r, seconds: TIME_BONUS, cause: why });
        continue;
      }
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
        case 'hdrill':
          // cross drill: clears the whole row, left and right
          ev.push({ type: 'powerup', kind: 'hdrill', col: c, row: r });
          for (let d = 1; d < COLS; d++)
            for (const nc of [c - d, c + d]) if (nc >= 0 && nc < COLS && this.cells[r][nc]) queue.push([nc, r, 'hdrill']);
          break;
        case 'anvil': {
          if (why !== 'hit') break; // blown up / drilled: just gone
          // smashed by a high jump: it crashes 2–3 blocks deeper down its column
          const depth = 2 + (this.rng() < 0.5 ? 1 : 0);
          ev.push({ type: 'anvil', col: c, row: r, depth });
          for (let k = 1; k <= depth; k++) {
            const nr = r + k;
            if (nr >= this.rows || this.cells[nr][c]?.kind === 'exit') break;
            if (this.cells[nr][c]) queue.push([c, nr, 'anvil']);
          }
          break;
        }
        case 'spring': {
          const p = this.curPlayer;
          this.turboUntil[p] = Math.min(t + TURBO_DURATION * 2, Math.max(t, this.turboUntil[p]) + TURBO_DURATION);
          ev.push({ type: 'turbo', player: p, col: c, row: r, until: this.turboUntil[p] });
          break;
        }
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

  /** Scrolls the view: one row of air stays above the blocks. If a column is dug
   *  out of view the ceiling caves in so there is always something to hit. */
  private settle(ev: MineEvent[], t: number): void {
    const maxTop = Math.max(0, this.rows - VISIBLE_ROWS);
    for (let guard = 0; guard < this.rows + 2; guard++) {
      let minTop = this.rows;
      let deepest = 0;
      for (let c = 0; c < COLS; c++) {
        const tr = this.topRow(c);
        minTop = Math.min(minTop, tr);
        deepest = Math.max(deepest, tr);
      }
      const target = Math.min(maxTop, Math.max(this.viewTop, minTop - SKY_ROWS));
      if (target > this.viewTop) { this.viewTop = target; continue; }
      if (deepest >= this.viewTop + VISIBLE_ROWS && this.viewTop < maxTop) {
        // collapse the first row that still has blocks (skip the empty sky)
        const limit = Math.min(this.rows, this.viewTop + VISIBLE_ROWS);
        let row = this.viewTop;
        while (row < limit && !this.cells[row].some((b) => b)) row++;
        if (row >= limit) { this.viewTop++; continue; }
        ev.push({ type: 'cavein', row });
        for (let c = 0; c < COLS; c++) if (this.cells[row][c]) this.destroy(c, row, 'cavein', t, ev);
        // advance at least one row; keep a row of air above the new ceiling when it fits
        this.viewTop = Math.min(maxTop, Math.max(this.viewTop + 1, row + 1 - SKY_ROWS));
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
