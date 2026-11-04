import { describe, it, expect } from 'vitest';
import { JumpDetector, heightFromFlightTime, type JumpEvent, type LandingEvent } from '../src/input/jumpDetector';
import { mulberry32 } from '../src/core/rng';

const FPS = 30;
const BASE = 0.6; // hip y at rest (normalised, y down)
const SCALE = 0.15; // torso length in image units (person ~2.5 m away)
const PX_PER_M = SCALE / 0.45; // torso ≈ 45 cm

/** hip y over time for a list of jumps; heights in metres */
function trajectory(jumps: { start: number; flight: number }[], duration: number, noise = 0.002, seed = 3) {
  const rnd = mulberry32(seed);
  const samples: { t: number; y: number }[] = [];
  for (let i = 0; i < duration * FPS; i++) {
    const t = i / FPS;
    let h = 0;
    for (const j of jumps) {
      if (t >= j.start && t <= j.start + j.flight) {
        const v0 = (9.81 * j.flight) / 2;
        const tt = t - j.start;
        h = v0 * tt - 0.5 * 9.81 * tt * tt;
      }
    }
    samples.push({ t, y: BASE - h * PX_PER_M + (rnd() - 0.5) * noise });
  }
  return samples;
}

function run(samples: { t: number; y: number }[], det = new JumpDetector()) {
  det.calibrate(BASE, SCALE);
  const events: JumpEvent[] = [];
  const states = new Set<string>();
  for (const s of samples) {
    events.push(...det.update(s.t, s.y, SCALE));
    states.add(det.state);
  }
  return { events, landings: events.filter((e): e is LandingEvent => e.type === 'landing'), states };
}

describe('JumpDetector', () => {
  it('h = g·T²/8', () => {
    expect(heightFromFlightTime(0.5)).toBeCloseTo(0.3066, 3);
  });

  it('standing still with sensor noise produces no jumps', () => {
    const { events } = run(trajectory([], 10, 0.006));
    expect(events).toHaveLength(0);
  });

  it('detects a normal jump and goes through all states', () => {
    const { landings, states } = run(trajectory([{ start: 1, flight: 0.4 }], 3));
    expect(landings).toHaveLength(1);
    expect(landings[0].high).toBe(false);
    expect(landings[0].flightTime).toBeGreaterThan(0.3);
    expect(landings[0].flightTime).toBeLessThan(0.5);
    for (const s of ['GROUNDED', 'TAKEOFF', 'AIRBORNE', 'APEX', 'LANDING']) expect(states.has(s)).toBe(true);
  });

  it('classifies a long flight as high jump', () => {
    const { landings } = run(trajectory([{ start: 1, flight: 0.7 }], 3));
    expect(landings).toHaveLength(1);
    expect(landings[0].high).toBe(true);
    expect(landings[0].height).toBeGreaterThan(0.4);
  });

  it('ignores small trampoline bounces (few cm)', () => {
    const bounces = Array.from({ length: 12 }, (_, i) => ({ start: 0.5 + i * 0.35, flight: 0.14 }));
    const { landings } = run(trajectory(bounces, 6));
    expect(landings).toHaveLength(0);
  });

  it('counts a series of consecutive jumps', () => {
    const jumps = Array.from({ length: 5 }, (_, i) => ({ start: 1 + i * 0.8, flight: 0.45 }));
    const { landings } = run(trajectory(jumps, 6));
    expect(landings).toHaveLength(5);
  });

  it('works the same at a different camera distance (body-scale normalisation)', () => {
    const det = new JumpDetector();
    det.calibrate(0.55, 0.08);
    let n = 0;
    for (let i = 0; i < 90; i++) {
      const t = i / FPS;
      let h = 0;
      if (t >= 1 && t <= 1.45) { const tt = t - 1; h = 2.207 * tt - 4.905 * tt * tt; }
      n += det.update(t, 0.55 - h * (0.08 / 0.45), 0.08).filter((e) => e.type === 'landing').length;
    }
    expect(n).toBe(1);
  });

  it('resets when the person is lost mid-air', () => {
    const det = new JumpDetector();
    det.calibrate(BASE, SCALE);
    const traj = trajectory([{ start: 1, flight: 0.6 }], 1.2);
    for (const s of traj) det.update(s.t, s.y, SCALE);
    expect(det.state === 'AIRBORNE' || det.state === 'APEX').toBe(true);
    det.update(2.0, null);
    expect(det.state).toBe('GROUNDED');
  });
});
