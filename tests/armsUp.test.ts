import { describe, it, expect } from 'vitest';
import { armsUp, ArmsUpHold, StillnessCheck, upperBody } from '../src/input/armsUp';
import type { Landmark } from '../src/input/pose/types';

/** simple standing body; wrists at given y (image y grows downwards) */
function body(lwY: number, rwY: number, v = 0.95, opts: { hips?: boolean } = {}): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, v }));
  const set = (k: number, x: number, y: number, vis = v) => { lm[k] = { x, y, z: 0, v: vis }; };
  set(0, 0.5, 0.2);          // nose
  set(11, 0.56, 0.3); set(12, 0.44, 0.3); // shoulders
  set(23, 0.54, 0.55, opts.hips === false ? 0.1 : v); set(24, 0.46, 0.55, opts.hips === false ? 0.1 : v); // hips → torso 0.25
  set(15, 0.62, lwY); set(16, 0.38, rwY); // wrists
  return lm;
}

describe('armsUp (pose test)', () => {
  it('arms hanging down → false', () => expect(armsUp(body(0.55, 0.55))).toBe(false));
  it('arms horizontal (T-pose / yoga) → false', () => expect(armsUp(body(0.3, 0.31))).toBe(false));
  it('both wrists above the head → true', () => expect(armsUp(body(0.1, 0.12))).toBe(true));
  it('both wrists clearly above the shoulders (below nose) → true', () => expect(armsUp(body(0.2, 0.21))).toBe(true));
  it('only one arm up → false', () => {
    expect(armsUp(body(0.1, 0.55))).toBe(false);
    expect(armsUp(body(0.55, 0.1))).toBe(false);
  });
  it('wrists barely above shoulders → false', () => expect(armsUp(body(0.27, 0.27))).toBe(false));
  it('low visibility or missing pose → false', () => {
    expect(armsUp(body(0.1, 0.1, 0.3))).toBe(false);
    expect(armsUp(null)).toBe(false);
    expect(armsUp([])).toBe(false);
  });
  it('works without visible hips (shoulder-width fallback)', () => expect(armsUp(body(0.1, 0.1, 0.95, { hips: false }))).toBe(true));
});

const run = (h: ArmsUpHold, from: number, to: number, f: (t: number) => { up: boolean; grounded?: boolean }, fps = 30) => {
  let fired = -1;
  for (let t = from; t <= to + 1e-9; t += 1 / fps) {
    const s = f(t);
    if (h.update(t, s.up, s.grounded ?? true) && fired < 0) fired = t;
  }
  return fired;
};

describe('ArmsUpHold (debounce)', () => {
  it('triggers after holding ~0.65 s once the arm delay has passed', () => {
    const h = new ArmsUpHold();
    const fired = run(h, 0, 3, (t) => ({ up: t >= 1.2 }));
    expect(fired).toBeGreaterThan(1.8);
    expect(fired).toBeLessThan(1.95);
    expect(h.triggered).toBe(true);
  });
  it('ignores arms up during the arm delay right after the pause appears', () => {
    const h = new ArmsUpHold();
    expect(run(h, 0, 0.99, () => ({ up: true }))).toBe(-1);
    expect(h.progress).toBe(0);
  });
  it('does not trigger from short arm swings (0.3 s up, 0.3 s down)', () => {
    const h = new ArmsUpHold();
    expect(run(h, 0, 6, (t) => ({ up: t > 1 && (t % 0.6) < 0.3 }))).toBe(-1);
  });
  it('does not trigger while jumping with arms up (airborne resets progress)', () => {
    const h = new ArmsUpHold();
    // trampoline: 0.45 s in the air, 0.25 s on the mat, arms up the whole time
    expect(run(h, 0, 8, (t) => ({ up: true, grounded: (t % 0.7) >= 0.45 }))).toBe(-1);
  });
  it('a short tracking dropout only slows the fill instead of restarting', () => {
    const h = new ArmsUpHold();
    const fired = run(h, 0, 4, (t) => ({ up: t >= 1.2 && !(t > 1.5 && t < 1.55) }));
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(2.15);
  });
  it('fires only once until reset', () => {
    const h = new ArmsUpHold();
    let n = 0;
    for (let t = 0; t < 5; t += 1 / 30) if (h.update(t, true)) n++;
    expect(n).toBe(1);
    h.reset();
    expect(h.triggered).toBe(false);
    expect(h.progress).toBe(0);
  });
});

describe('StillnessCheck + ArmsUpHold (jump guard independent of the jump detector)', () => {
  /** body shifted vertically by dy (image units) */
  const shifted = (dy: number) => body(0.1, 0.1).map((p) => ({ ...p, y: p.y + dy }));
  const sim = (fps: number, dyAt: (t: number) => number, until = 8) => {
    const hold = new ArmsUpHold();
    const still = new StillnessCheck();
    let fired = -1;
    for (let t = 0; t <= until; t += 1 / fps) {
      const lm = shifted(dyAt(t));
      const ub = upperBody(lm)!;
      const quiet = still.update(t, ub.y, ub.torso);
      if (hold.update(t, armsUp(lm), quiet) && fired < 0) fired = t;
    }
    return fired;
  };
  it('upperBody gives shoulder line and torso length', () => {
    const ub = upperBody(body(0.5, 0.5))!;
    expect(ub.y).toBeCloseTo(0.3);
    expect(ub.torso).toBeCloseTo(0.25, 2);
    expect(upperBody(null)).toBeNull();
  });
  it('standing still with arms up triggers (30 fps and 5 fps)', () => {
    expect(sim(30, () => 0)).toBeGreaterThan(1);
    expect(sim(30, () => 0)).toBeLessThan(2.2);
    expect(sim(5, () => 0)).toBeGreaterThan(1);
    expect(sim(5, () => 0)).toBeLessThan(2.6);
  });
  it('small tracking jitter does not block the trigger', () => {
    expect(sim(15, (t) => 0.01 * Math.sin(t * 37))).toBeGreaterThan(0);
  });
  it('bouncing with arms up never triggers, even at a low pose frame rate', () => {
    // hop of 0.1 image heights (0.4 torso) every 0.9 s, airborne 0.45 s
    const bounce = (t: number) => { const p = t % 0.9; return p < 0.45 ? -0.1 * Math.sin((p / 0.45) * Math.PI) : 0; };
    expect(sim(30, bounce)).toBe(-1);
    expect(sim(6, bounce)).toBe(-1);
    expect(sim(4, bounce)).toBe(-1);
    expect(sim(3.4, bounce, 20)).toBe(-1);
    expect(sim(3.4, (t) => bounce(t + 0.13), 20)).toBe(-1);
  });
  it('StillnessCheck reports movement within its window', () => {
    const s = new StillnessCheck(0.45, 0.2);
    expect(s.update(0, 0.3, 0.25)).toBe(true);
    expect(s.update(0.1, 0.3, 0.25)).toBe(true);
    expect(s.update(0.2, 0.22, 0.25)).toBe(false); // moved 0.08 > 0.05
    expect(s.update(0.5, 0.22, 0.25)).toBe(false); // still inside the window
    expect(s.update(0.8, 0.22, 0.25)).toBe(true);
  });
});
