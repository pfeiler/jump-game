/**
 * Point pop-ups for collected gems (pure planning, unit-tested; MineTime draws them).
 * Few gems → one small pop-up per gem, slightly staggered; many at once (TNT chain,
 * drill, magnet) → a single combined pop-up at their centre so the screen stays readable.
 */
export interface GemHit { col: number; row: number; points: number; gemType: number }
export interface GemPopup {
  col: number; row: number; text: string; gemType: number;
  delay: number; size: number; combined: boolean; count: number;
}

export const GEM_POP_DURATION = 0.7;
export const GEM_POP_STAGGER = 0.07;
/** up to this many gems in one event batch get their own pop-up */
export const GEM_POP_MAX_SINGLE = 3;

export function planGemPopups(gems: GemHit[]): GemPopup[] {
  if (!gems.length) return [];
  if (gems.length <= GEM_POP_MAX_SINGLE) {
    return gems.map((g, i) => ({
      col: g.col, row: g.row, text: `+${g.points}`, gemType: g.gemType,
      delay: i * GEM_POP_STAGGER, size: g.gemType === 3 ? 40 : 34, combined: false, count: 1,
    }));
  }
  const sum = gems.reduce((a, g) => a + g.points, 0);
  const col = gems.reduce((a, g) => a + g.col, 0) / gems.length;
  const row = gems.reduce((a, g) => a + g.row, 0) / gems.length;
  const best = gems.reduce((a, g) => Math.max(a, g.gemType), 0);
  return [{ col, row, text: `+${sum}  (${gems.length}×)`, gemType: best, delay: 0, size: 46, combined: true, count: gems.length }];
}
