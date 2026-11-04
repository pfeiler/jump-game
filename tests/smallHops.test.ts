/**
 * Small-hop sensitivity: a kid hopping on a mini trampoline / in place in front of a laptop
 * webcam (2–3 m away). Hops of 0.12–0.2 torso lengths (≈ 5–9 cm) with 0.2–0.3 s flight must be
 * counted at typical pose rates, while swaying, arm raising, tiptoeing and squatting must not.
 */
import { describe, it, expect } from 'vitest';
import { JumpDetector, sensitivityConfig, DEFAULT_JUMP_CONFIG, type JumpConfig } from '../src/input/jumpDetector';
import { BASE, SCALE, hopRise, sample, type Sample } from './helpers/jumpSim';

const NOISE = 0.01; // landmark jitter σ in torso lengths (fused hip+shoulder signal)

function landings(samples: Sample[], cfg: Partial<JumpConfig> = {}, calibrate = true) {
  const det = new JumpDetector(cfg);
  if (calibrate) det.calibrate(BASE, SCALE, NOISE * SCALE);
  let n = 0, high = 0;
  for (const s of samples) for (const e of det.update(s.t, s.y, SCALE)) if (e.type === 'landing') { n++; if (e.high) high++; }
  return { n, high, det };
}

describe('small hops', () => {
  for (const fps of [10, 15, 30]) {
    it(`detects every small hop at ${fps} fps (rise 0.12–0.2 torso, flight 0.2–0.3 s, noisy)`, () => {
      const misses: string[] = [];
      for (const peak of [0.12, 0.16, 0.2]) for (const flight of [0.2, 0.25, 0.3]) for (let seed = 1; seed <= 6; seed++) {
        const hops = { peak, flight, contact: 0.15 + (seed % 3) * 0.05, dip: 0.04, count: 8 };
        const s = sample((t) => hopRise(hops, t), { fps, duration: 1 + 8 * 0.6 + 1, noise: NOISE, jitter: 0.004, phase: seed / 7, seed });
        const r = landings(s);
        if (r.n !== 8) misses.push(`p${peak} f${flight} s${seed}: ${r.n}/8`);
        expect(r.high).toBe(0); // small hops are never high jumps
      }
      expect(misses).toEqual([]);
    });
  }

  it('still detects hops with dropped frames and without calibration', () => {
    const hops = { peak: 0.16, flight: 0.25, contact: 0.2, count: 10 };
    const s = sample((t) => hopRise(hops, t), { fps: 15, duration: 7, noise: NOISE, seed: 4, drop: 0.1 });
    expect(landings(s).n).toBe(10);
    // uncalibrated: baseline taken from the first frame, noise estimated on the fly
    const s2 = sample((t) => hopRise({ ...hops, start: 2 }, t), { fps: 15, duration: 8, noise: NOISE, seed: 5 });
    expect(landings(s2, {}, false).n).toBe(10);
  });

  it('counts a landing at very low fps even if the hop was seen in a single frame', () => {
    // 8 fps, 0.25 s flight → only 1–2 samples in the air
    let n = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const hops = { peak: 0.2, flight: 0.25, contact: 0.25, count: 6 };
      n += landings(sample((t) => hopRise(hops, t), { fps: 8, duration: 5, noise: 0.005, phase: seed / 11, seed })).n;
    }
    expect(n).toBe(60);
  });

  it('high jumps are still high at 10 and 30 fps', () => {
    for (const fps of [10, 30]) {
      // flight 0.65 s ≈ 52 cm ≈ 1.15 torso
      const s = sample((t) => hopRise({ peak: 1.15, flight: 0.65, contact: 0.4, count: 3 }, t), { fps, duration: 5, noise: NOISE, seed: 2 });
      const r = landings(s);
      expect(r.n).toBe(3);
      expect(r.high).toBe(3);
    }
  });

  it('?sens scales thresholds (higher = more sensitive)', () => {
    const hi = sensitivityConfig(2), lo = sensitivityConfig(0.5);
    expect(hi.airborne!).toBeCloseTo(DEFAULT_JUMP_CONFIG.airborne / 2);
    expect(lo.edge!).toBeCloseTo(DEFAULT_JUMP_CONFIG.edge * 2);
    expect(sensitivityConfig(100).airborne!).toBeCloseTo(DEFAULT_JUMP_CONFIG.airborne / 3); // clamped
    const tiny = { peak: 0.06, flight: 0.2, contact: 0.2, count: 8 };
    const s = sample((t) => hopRise(tiny, t), { fps: 30, duration: 5, noise: 0.004, seed: 1 });
    expect(landings(s).n).toBe(0); // below default threshold
    expect(landings(s, sensitivityConfig(2)).n).toBe(8);
  });
});

describe('no false jumps (hips static or slow movement)', () => {
  const cases: Record<string, (t: number) => number> = {
    'standing still': () => 0,
    'slow swaying': (t) => 0.03 * Math.sin(t * 2 * Math.PI * 0.6),
    'fast bobbing': (t) => 0.04 * Math.sin(t * 2 * Math.PI * 1.5),
    // raising both arms lifts the shoulders by ≈ 0.12 torso; weight 0.35 in the fused signal
    'raising arms': (t) => { const p = t % 3; return p > 1 && p < 2 ? 0.35 * 0.12 * Math.min(1, (p - 1) * 4) : 0; },
    'arms up, waving': (t) => (t > 1 ? 0.042 * Math.min(1, (t - 1) / 0.3) + 0.01 * Math.sin(t * 2 * Math.PI * 2) : 0),
    'tiptoe up and down': (t) => { const p = t % 4; return p < 1 ? 0 : p < 1.6 ? (0.12 * (p - 1)) / 0.6 : p < 2.6 ? 0.12 : p < 3.2 ? (0.12 * (3.2 - p)) / 0.6 : 0; },
    'squatting': (t) => { const p = t % 4; return p < 1 ? 0 : p < 1.7 ? (-0.5 * (p - 1)) / 0.7 : p < 2.5 ? -0.5 : p < 3 ? (-0.5 * (3 - p)) / 0.5 : 0; },
  };
  for (const [name, f] of Object.entries(cases)) {
    it(`${name} → 0 jumps at 10/15/30 fps`, () => {
      for (const fps of [10, 15, 30]) for (let seed = 1; seed <= 5; seed++) {
        const s = sample(f, { fps, duration: 20, noise: NOISE, jitter: 0.004, phase: seed / 7, seed });
        expect(landings(s).n, `${name} ${fps} fps seed ${seed}`).toBe(0);
      }
    });
  }

  it('missed hops at very low fps do not inflate the noise estimate', () => {
    // 3.5 fps (headless CPU-level) with rhythmic 0.28 s hops: most hops fall between frames
    const hops = { peak: 0.2, flight: 0.28, contact: 0.22, count: 60 };
    const s = sample((t) => hopRise(hops, t), { fps: 3.5, duration: 32, noise: 0.006, seed: 3 });
    const r = landings(s);
    expect(r.det.noise).toBeLessThan(0.02);
    expect(r.det.airborneEff).toBeCloseTo(DEFAULT_JUMP_CONFIG.airborne);
  });

  it('very noisy tracking without calibration adapts thresholds → 0 jumps', () => {
    const s = sample(() => 0, { fps: 30, duration: 30, noise: 0.03, seed: 9 });
    const r = landings(s, {}, false);
    expect(r.n).toBeLessThanOrEqual(1); // at most one during the first seconds of noise learning
    expect(r.det.noise).toBeGreaterThan(0.02);
  });
});
