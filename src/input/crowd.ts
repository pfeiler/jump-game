/**
 * A second person in frame pauses play. This is not a second player:
 * the camera may see two bodies, and the game still follows only one.
 */

/** How many poses MediaPipe may return. 2 is enough to notice someone else. */
export const POSE_SLOTS = 2;
/** a second person must stay this long before the pause engages */
export const CROWD_ON_S = 0.4;
/** they must be gone this long before play resumes (avoids flicker) */
export const CROWD_OFF_S = 0.5;

export function visiblePeople(hips: { visible: boolean }[]): number {
  let n = 0;
  for (const h of hips) if (h.visible) n++;
  return n;
}

export interface CrowdClock {
  crowd: boolean;
  /** when the opposite condition started, or null while it matches `crowd` */
  since: number | null;
}

export const idleCrowd = (): CrowdClock => ({ crowd: false, since: null });

/** Step the pause flag. `people` is how many bodies are visible right now. */
export function stepCrowd(state: CrowdClock, people: number, t: number): CrowdClock {
  const want = people >= 2;
  if (want === state.crowd) return { crowd: state.crowd, since: null };
  const since = state.since ?? t;
  const wait = want ? CROWD_ON_S : CROWD_OFF_S;
  if (t - since >= wait - 1e-9) return { crowd: want, since: null };
  return { crowd: state.crowd, since };
}
