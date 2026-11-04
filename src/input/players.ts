/**
 * Turns raw pose landmarks into per-player game input:
 * mirrored hip-centre X (smoothed) + jump events from the JumpDetector.
 */
import { OneEuroFilter } from './oneEuro';
import { JumpDetector, type JumpConfig, type LandingEvent } from './jumpDetector';
import { LM, type Landmark } from './camera';

export interface HipSample {
  x: number;
  /** vertical body signal for jump detection: 65 % hip centre + 35 % shoulder centre (less noise than hips alone) */
  y: number;
  scale: number;
  visible: boolean;
}

/** weight of the shoulder centre in the vertical jump signal */
export const SHOULDER_WEIGHT = 0.35;

/**
 * Hip centre (mirrored x), fused hip/shoulder height, torso length as body scale (aspect-corrected).
 * Shoulders move rigidly with the hips during a hop but have independent detection noise, so
 * averaging lowers jitter. Ankles are not used: at 2–3 m they are often cut off or occluded by the
 * trampoline frame, and they stay on the mat during the "contact" part of a bounce.
 */
export function hipFromPose(lm: Landmark[], aspect: number): HipSample {
  const lh = lm[LM.L_HIP], rh = lm[LM.R_HIP], ls = lm[LM.L_SHOULDER], rs = lm[LM.R_SHOULDER];
  const hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) / 2;
  const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) / 2;
  const dx = (hx - sx) * aspect, dy = hy - sy;
  return {
    x: 1 - hx,
    y: hy + SHOULDER_WEIGHT * (sy - hy),
    scale: Math.hypot(dx, dy),
    // lenient gate: mid-air frames often have slightly lower confidence (motion blur)
    visible: Math.min(lh.v, rh.v) > 0.35 && Math.min(ls.v, rs.v) > 0.25,
  };
}

export class TrackedPlayer {
  /** smoothed mirrored hip x in 0..1 (camera space) */
  x = 0.5;
  rawX = 0.5;
  visible = false;
  lastSeen = -10;
  hip: HipSample | null = null;
  landmarks: Landmark[] | null = null;
  detector: JumpDetector;
  pending: LandingEvent[] = [];
  /** history of rise values for the debug graph */
  history: { t: number; rise: number; state: string }[] = [];
  private fx = new OneEuroFilter(1.2, 3.0, 1.0);

  constructor(cfg: Partial<JumpConfig>) {
    this.detector = new JumpDetector(cfg);
  }

  feed(t: number, hip: HipSample | null, lms: Landmark[] | null): void {
    this.landmarks = lms;
    if (hip && hip.visible) {
      this.hip = hip;
      this.visible = true;
      this.lastSeen = t;
      this.rawX = hip.x;
      this.x = this.fx.filter(hip.x, t);
      for (const e of this.detector.update(t, hip.y, hip.scale)) if (e.type === 'landing') this.pending.push(e);
    } else {
      if (t - this.lastSeen > 0.5) this.visible = false;
      this.detector.update(t, null);
    }
    this.history.push({ t, rise: this.detector.rise, state: this.detector.state });
    while (this.history.length && this.history[0].t < t - 6) this.history.shift();
  }
}

/**
 * Assigns detected poses to player slots. 1P: largest/closest person.
 * 2P: left half → P1, right half → P2, with hysteresis (nearest previous
 * position wins) so players crossing the middle briefly don't swap.
 */
export function assignPoses(hips: HipSample[], prev: (number | null)[], players: 1 | 2): (number | null)[] {
  const idx = hips.map((_, i) => i).filter((i) => hips[i].visible);
  if (players === 1) {
    if (!idx.length) return [null];
    if (prev[0] !== null && idx.length > 1) {
      idx.sort((a, b) => Math.abs(hips[a].x - prev[0]!) - Math.abs(hips[b].x - prev[0]!));
      if (Math.abs(hips[idx[0]].x - prev[0]!) < 0.15) return [idx[0]];
    }
    idx.sort((a, b) => hips[b].scale - hips[a].scale);
    return [idx[0]];
  }
  const out: (number | null)[] = [null, null];
  if (idx.length >= 2) {
    const [a, b] = idx.slice(0, 2).sort((p, q) => hips[p].x - hips[q].x);
    if (prev[0] !== null && prev[1] !== null) {
      const keep = Math.abs(hips[a].x - prev[0]) + Math.abs(hips[b].x - prev[1]);
      const swap = Math.abs(hips[b].x - prev[0]) + Math.abs(hips[a].x - prev[1]);
      if (swap + 0.05 < keep) return [b, a];
    }
    return [a, b];
  }
  if (idx.length === 1) {
    const i = idx[0];
    const x = hips[i].x;
    const d0 = prev[0] === null ? Infinity : Math.abs(x - prev[0]);
    const d1 = prev[1] === null ? Infinity : Math.abs(x - prev[1]);
    let slot = x < 0.5 ? 0 : 1;
    if (Math.min(d0, d1) < 0.12) slot = d0 <= d1 ? 0 : 1; // hysteresis around the middle
    out[slot] = i;
  }
  return out;
}

/** Is the whole body (head to feet) inside the image? */
export function fullyInFrame(lm: Landmark[] | null): boolean {
  if (!lm || lm.length < 33) return false;
  const pts = [0, 11, 12, 23, 24, 27, 28].map((k) => lm[k]);
  return pts.every((p) => p.v > 0.5 && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99);
}
