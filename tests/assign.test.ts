import { describe, it, expect } from 'vitest';
import { assignPoses, fullyInFrame, type HipSample } from '../src/input/players';

const h = (x: number, scale = 0.2): HipSample => ({ x, y: 0.6, scale, visible: true });

describe('assignPoses', () => {
  it('picks the biggest person', () => {
    expect(assignPoses([h(0.2, 0.1), h(0.7, 0.3)], null)).toBe(1);
  });
  it('keeps the previous person while they stay close', () => {
    expect(assignPoses([h(0.2, 0.4), h(0.48, 0.2)], 0.5)).toBe(1);
    expect(assignPoses([h(0.2, 0.4), h(0.9, 0.2)], 0.5)).toBe(0);
  });
});

describe('fullyInFrame', () => {
  const body = (dy = 0, v = 0.9) => Array.from({ length: 33 }, (_, k) => ({ x: 0.5 + (k % 2 ? 0.05 : -0.05), y: 0.1 + (k / 33) * 0.8 + dy, z: 0, v }));
  it('accepts a whole body inside the image', () => expect(fullyInFrame(body())).toBe(true));
  it('rejects feet cut off at the bottom', () => expect(fullyInFrame(body(0.3))).toBe(false));
  it('rejects low-visibility / missing poses', () => {
    expect(fullyInFrame(body(0, 0.2))).toBe(false);
    expect(fullyInFrame(null)).toBe(false);
  });
});
