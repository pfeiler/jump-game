import { describe, it, expect } from 'vitest';
import { CROWD_OFF_S, CROWD_ON_S, POSE_SLOTS, idleCrowd, stepCrowd, visiblePeople } from '../src/input/crowd';

const hip = (visible: boolean) => ({ visible });

describe('second person in frame', () => {
  it('counts only visible bodies, and tracking stays at two slots', () => {
    expect(visiblePeople([])).toBe(0);
    expect(visiblePeople([hip(true), hip(false)])).toBe(1);
    expect(visiblePeople([hip(true), hip(true)])).toBe(2);
    expect(POSE_SLOTS).toBe(2);
  });

  it('pauses only after a second person stays, and resumes once they are gone', () => {
    let s = idleCrowd();
    s = stepCrowd(s, 1, 0);
    expect(s.crowd).toBe(false);
    s = stepCrowd(s, 2, 1);
    expect(s.crowd).toBe(false); // not yet
    s = stepCrowd(s, 2, 1 + CROWD_ON_S - 0.05);
    expect(s.crowd).toBe(false);
    s = stepCrowd(s, 2, 1 + CROWD_ON_S);
    expect(s.crowd).toBe(true);
    // a one-frame miss does not resume
    s = stepCrowd(s, 1, 3);
    expect(s.crowd).toBe(true);
    s = stepCrowd(s, 1, 3 + CROWD_OFF_S);
    expect(s.crowd).toBe(false);
  });

  it('does not pause when nobody is there, and a returning second person has to wait again', () => {
    let s = stepCrowd(idleCrowd(), 0, 0);
    expect(s.crowd).toBe(false);
    s = stepCrowd(s, 2, 1);
    s = stepCrowd(s, 2, 1 + CROWD_ON_S);
    expect(s.crowd).toBe(true);
    s = stepCrowd(s, 0, 4);
    s = stepCrowd(s, 0, 4 + CROWD_OFF_S);
    expect(s.crowd).toBe(false);
    s = stepCrowd(s, 2, 6);
    expect(s.crowd).toBe(false);
  });
});
