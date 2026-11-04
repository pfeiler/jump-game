import { describe, it, expect } from 'vitest';
import { assignPoses, type HipSample } from '../src/input/players';

const h = (x: number, scale = 0.2): HipSample => ({ x, y: 0.6, scale, visible: true });

describe('assignPoses', () => {
  it('1P picks the biggest person', () => {
    expect(assignPoses([h(0.2, 0.1), h(0.7, 0.3)], [null], 1)).toEqual([1]);
  });
  it('2P assigns by x', () => {
    expect(assignPoses([h(0.8), h(0.3)], [null, null], 2)).toEqual([1, 0]);
  });
  it('2P single person near the middle keeps its slot (hysteresis)', () => {
    expect(assignPoses([h(0.53)], [0.47, 0.85], 2)).toEqual([0, null]);
    expect(assignPoses([h(0.53)], [null, null], 2)).toEqual([null, 0]);
  });
});
