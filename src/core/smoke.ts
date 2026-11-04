/** Pure smoke tuning (no Pixi import, so it is unit-testable in node). */
/**
 * TNT smoke/dust tuning: short-lived and see-through so it never hides the playfield for long.
 * (was: life 1.8–3.2 s, delay up to 0.28 s, alpha 0.9, 26 puffs, grows to 280–500 px)
 */
export const SMOKE = { count: 16, lifeMin: 0.65, lifeMax: 0.85, delayMax: 0.1, alpha: 0.5, sizeMin: 180, sizeMax: 300 } as const;
/** longest time a smoke puff can be on screen (delay + life) */
export const smokeMaxDuration = (): number => SMOKE.delayMax + SMOKE.lifeMax;
/** smoke alpha over its life k∈[0,1]: quick fade-in, then fades out from the start (front-loaded) */
export const smokeAlpha = (k: number): number => (k < 0.06 ? k / 0.06 : Math.pow(Math.max(0, 1 - (k - 0.06) / 0.94), 1.8));

