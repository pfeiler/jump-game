/**
 * Jump-sensitivity calibration.
 *
 * The player does a short series of normal hops. We turn the measured peak
 * rise (torso lengths) into the existing `?sens=` factor and, only if those
 * hops would otherwise count as high jumps, nudge the high-jump flight time
 * up so a normal trampoline hop stays one hit.
 *
 * Stored in localStorage. A URL `?sens=` / `?high=` still wins on load.
 */
import { DEFAULT_JUMP_CONFIG } from '../input/jumpDetector';

export const JUMP_CALIB_KEY = 'jumpgame.jumpcalib';
/** how many normal hops the screen asks for */
export const HOP_GOAL = 10;
/**
 * Sensitivity used only while measuring, so hops that are a bit under the
 * default threshold still produce landing events we can measure.
 */
export const MEASURE_SENS = 2.2;

export interface HopSample {
  /** peak rise in torso lengths */
  peak: number;
  /** flight time in seconds */
  flightTime: number;
}

export interface JumpTuning {
  sens: number;
  high: number;
}

export interface StoredJumpCalib extends JumpTuning {
  /** median peak rise of the measured hops (torso lengths) */
  peak: number;
  /** 75th percentile flight time (s) */
  flight: number;
  at: number;
}

export interface JumpCalibResult extends StoredJumpCalib {
  /** false when the hops were too few or too flat to trust */
  ok: boolean;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round = (n: number, digits: number): number => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

/**
 * Map measured normal hops to a sensitivity factor and a high-jump threshold.
 * `defaults` are what is already in effect (so we never lower the high-jump bar).
 */
export function calibrateFromHops(hops: HopSample[], defaults: JumpTuning = { sens: 1, high: DEFAULT_JUMP_CONFIG.highFlightTime }): JumpCalibResult {
  const peaks = hops.map((h) => h.peak).filter((p) => p >= 0.05 && p < 2).sort((a, b) => a - b);
  const flights = hops.map((h) => h.flightTime).filter((t) => t >= 0.12 && t <= 1.2).sort((a, b) => a - b);
  const base: JumpCalibResult = { ok: false, sens: defaults.sens, high: defaults.high, peak: 0, flight: 0, at: 0 };
  if (peaks.length < 4) return base;
  const medP = quantile(peaks, 0.5);
  const p75T = flights.length >= 4 ? quantile(flights, 0.75) : 0;
  // too flat to be real hops (noise / swaying) — don't save a twitchy setting
  if (medP < 0.055) return { ...base, peak: round(medP, 3), flight: round(p75T, 3) };
  // airborne threshold sits at ~45 % of a typical hop, so the measured hops clear it
  const desiredAirborne = clamp(medP * 0.45, 0.03, 0.16);
  const sens = clamp(DEFAULT_JUMP_CONFIG.airborne / desiredAirborne, 0.3, 3);
  let high = defaults.high;
  // only raise the bar: long trampoline hops must stay "normal", a clearly longer jump stays high
  if (p75T > 0 && p75T + 0.1 > high) high = clamp(Math.max(high, p75T + 0.15), 0.45, 0.9);
  return { ok: true, sens: round(sens, 2), high: round(high, 2), peak: round(medP, 3), flight: round(p75T, 3), at: Date.now() };
}

function storageOf(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadJumpCalib(storage?: Storage | null): StoredJumpCalib | null {
  const s = storageOf(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(JUMP_CALIB_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredJumpCalib>;
    if (typeof v.sens !== 'number' || typeof v.high !== 'number') return null;
    if (!Number.isFinite(v.sens) || !Number.isFinite(v.high)) return null;
    return {
      sens: clamp(v.sens, 0.3, 3),
      high: clamp(v.high, 0.3, 1.2),
      peak: typeof v.peak === 'number' ? v.peak : 0,
      flight: typeof v.flight === 'number' ? v.flight : 0,
      at: typeof v.at === 'number' ? v.at : 0,
    };
  } catch {
    return null;
  }
}

export function saveJumpCalib(value: StoredJumpCalib, storage?: Storage | null): void {
  const s = storageOf(storage);
  if (!s) return;
  try {
    s.setItem(JUMP_CALIB_KEY, JSON.stringify(value));
  } catch { /* private mode / full */ }
}

export function hasJumpCalib(storage?: Storage | null): boolean {
  return loadJumpCalib(storage) !== null;
}

/** URL `sens` / `high` win over the stored calibration, which wins over the defaults. */
export function resolveJumpTuning(params: URLSearchParams, stored: StoredJumpCalib | null): JumpTuning {
  const num = (key: string): number | null => {
    if (!params.has(key)) return null;
    const n = Number(params.get(key));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const sens = num('sens');
  const high = num('high');
  return {
    sens: clamp(sens ?? stored?.sens ?? 1, 0.3, 3),
    high: clamp(high ?? stored?.high ?? DEFAULT_JUMP_CONFIG.highFlightTime, 0.3, 1.2),
  };
}
