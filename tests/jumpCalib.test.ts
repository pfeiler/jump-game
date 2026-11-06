import { describe, it, expect } from 'vitest';
import { JumpDetector, DEFAULT_JUMP_CONFIG, sensitivityConfig } from '../src/input/jumpDetector';
import {
  JUMP_CALIB_KEY, HOP_GOAL, calibrateFromHops, loadJumpCalib, saveJumpCalib, resolveJumpTuning,
  type HopSample, type StoredJumpCalib,
} from '../src/core/jumpCalib';

function mem(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

const hops = (peak: number, flight: number, n = HOP_GOAL): HopSample[] =>
  Array.from({ length: n }, () => ({ peak, flightTime: flight }));

describe('calibrateFromHops', () => {
  it('typical in-place hops stay near the default and do not become high jumps', () => {
    const r = calibrateFromHops(hops(0.16, 0.28));
    expect(r.ok).toBe(true);
    expect(r.sens).toBeGreaterThan(0.8);
    expect(r.sens).toBeLessThan(1.2);
    expect(r.high).toBe(0.5);
    // the resulting airborne threshold sits under the measured hop
    expect(DEFAULT_JUMP_CONFIG.airborne / r.sens).toBeLessThan(0.16 * 0.7);
  });

  it('small trampoline signals raise sensitivity so those hops still count', () => {
    const r = calibrateFromHops(hops(0.09, 0.22));
    expect(r.ok).toBe(true);
    expect(r.sens).toBeGreaterThan(1.4);
    expect(DEFAULT_JUMP_CONFIG.airborne / r.sens).toBeLessThan(0.09);
    expect(r.high).toBe(0.5); // short flights stay below the high-jump bar
  });

  it('big hops lower sensitivity and long flights raise only the high-jump bar', () => {
    const r = calibrateFromHops(hops(0.32, 0.62));
    expect(r.ok).toBe(true);
    expect(r.sens).toBeLessThan(0.7);
    expect(r.high).toBeGreaterThan(0.62); // the measured "normal" hop is not a high jump
    expect(r.high).toBeLessThanOrEqual(0.9);
  });

  it('does not lower an existing higher high-jump threshold', () => {
    const r = calibrateFromHops(hops(0.16, 0.3), { sens: 1, high: 0.7 });
    expect(r.high).toBe(0.7);
  });

  it('rejects too few or too flat samples', () => {
    expect(calibrateFromHops(hops(0.2, 0.3, 3)).ok).toBe(false);
    expect(calibrateFromHops(hops(0.04, 0.2)).ok).toBe(false);
    expect(calibrateFromHops([]).sens).toBe(1);
  });
});

describe('storage and URL override', () => {
  it('round-trips the tuning under jumpgame.jumpcalib', () => {
    const s = mem();
    expect(loadJumpCalib(s)).toBeNull();
    const stored: StoredJumpCalib = { sens: 1.4, high: 0.66, peak: 0.11, flight: 0.5, at: 1 };
    saveJumpCalib(stored, s);
    expect(s.getItem(JUMP_CALIB_KEY)).toContain('1.4');
    expect(loadJumpCalib(s)).toMatchObject({ sens: 1.4, high: 0.66 });
    expect(JUMP_CALIB_KEY).toBe('jumpgame.jumpcalib');
  });

  it('?sens= and ?high= win over the stored value; missing params use it', () => {
    const stored: StoredJumpCalib = { sens: 1.8, high: 0.72, peak: 0.1, flight: 0.5, at: 1 };
    expect(resolveJumpTuning(new URLSearchParams(''), stored)).toEqual({ sens: 1.8, high: 0.72 });
    expect(resolveJumpTuning(new URLSearchParams('sens=1.2'), stored)).toEqual({ sens: 1.2, high: 0.72 });
    expect(resolveJumpTuning(new URLSearchParams('high=0.55'), stored)).toEqual({ sens: 1.8, high: 0.55 });
    expect(resolveJumpTuning(new URLSearchParams('sens=0'), stored).sens).toBe(1.8); // invalid → stored
    expect(resolveJumpTuning(new URLSearchParams(''), null)).toEqual({ sens: 1, high: 0.5 });
  });
});

describe('JumpDetector.applyConfig', () => {
  it('updates the live thresholds and keeps the baseline', () => {
    const d = new JumpDetector();
    d.calibrate(0.6, 0.2, 0.002);
    const before = d.airborneEff;
    d.applyConfig({ ...sensitivityConfig(2), highFlightTime: 0.66 });
    expect(d.cfg.airborne).toBeCloseTo(DEFAULT_JUMP_CONFIG.airborne / 2);
    expect(d.cfg.highFlightTime).toBe(0.66);
    expect(d.airborneEff).toBeLessThan(before);
    expect(d.baselineY).toBe(0.6);
  });
});
