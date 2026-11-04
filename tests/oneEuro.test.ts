import { describe, it, expect } from 'vitest';
import { OneEuroFilter } from '../src/input/oneEuro';
import { mulberry32 } from '../src/core/rng';

describe('OneEuroFilter', () => {
  it('passes the first sample through', () => {
    const f = new OneEuroFilter(1, 0);
    expect(f.filter(5, 0)).toBe(5);
  });

  it('converges to a constant signal', () => {
    const f = new OneEuroFilter(1, 0);
    f.filter(0, 0);
    let y = 0;
    for (let i = 1; i <= 120; i++) y = f.filter(1, i / 30);
    expect(y).toBeCloseTo(1, 3);
  });

  it('reduces jitter on a noisy constant signal', () => {
    const rnd = mulberry32(1);
    const f = new OneEuroFilter(1, 0.01);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 0.5 + (rnd() - 0.5) * 0.02;
      raw.push(x);
      out.push(f.filter(x, i / 30));
    }
    const sd = (a: number[]) => {
      const m = a.reduce((s, v) => s + v, 0) / a.length;
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
    };
    expect(sd(out.slice(30))).toBeLessThan(sd(raw.slice(30)) * 0.6);
  });

  it('lags less on fast motion with higher beta', () => {
    const slow = new OneEuroFilter(1, 0);
    const fast = new OneEuroFilter(1, 1);
    let a = 0, b = 0;
    for (let i = 0; i <= 10; i++) {
      const x = i * 0.1; // ramp 3 units/s
      a = slow.filter(x, i / 30);
      b = fast.filter(x, i / 30);
    }
    expect(Math.abs(1 - b)).toBeLessThan(Math.abs(1 - a));
  });

  it('reset forgets state', () => {
    const f = new OneEuroFilter(1, 0);
    f.filter(10, 0);
    f.filter(10, 0.1);
    f.reset();
    expect(f.filter(-3, 0.2)).toBe(-3);
  });
});
