/**
 * "Both arms up" gesture used to continue from pause screens.
 * Pure logic (no DOM) so it can be unit-tested.
 */
import type { Landmark } from './pose/types';

const NOSE = 0, LS = 11, RS = 12, LW = 15, RW = 16, LH = 23, RH = 24;

export interface ArmsUpConfig {
  /** wrists must be this many torso lengths above the shoulder line … */
  aboveShoulder: number;
  /** … or above the nose */
  minVisibility: number;
}
export const DEFAULT_ARMS_UP: ArmsUpConfig = { aboveShoulder: 0.3, minVisibility: 0.5 };

/** true if BOTH wrists are clearly above the shoulders (or the head). */
export function armsUp(lm: Landmark[] | null | undefined, cfg: ArmsUpConfig = DEFAULT_ARMS_UP): boolean {
  if (!lm || lm.length < 25) return false;
  const vis = (k: number) => lm[k].v >= cfg.minVisibility;
  if (!vis(LS) || !vis(RS) || !vis(LW) || !vis(RW)) return false;
  const shY = (lm[LS].y + lm[RS].y) / 2;
  const shX = (lm[LS].x + lm[RS].x) / 2;
  // torso length (image units); fall back to shoulder width if hips are not visible
  let torso = Math.abs(lm[LS].x - lm[RS].x) * 1.4;
  if (vis(LH) && vis(RH)) torso = Math.hypot((lm[LH].x + lm[RH].x) / 2 - shX, (lm[LH].y + lm[RH].y) / 2 - shY);
  if (torso < 0.02) return false;
  const limit = shY - cfg.aboveShoulder * torso;
  const noseY = vis(NOSE) ? lm[NOSE].y : Infinity;
  const up = (w: Landmark) => w.y < limit || w.y < noseY;
  return up(lm[LW]) && up(lm[RW]);
}

export interface ArmsHoldConfig {
  /** seconds the pose has to be held */
  hold: number;
  /** seconds after the pause appears before the gesture is accepted at all */
  armDelay: number;
  /** progress falls back this many times faster than it fills */
  decay: number;
}
export const DEFAULT_ARMS_HOLD: ArmsHoldConfig = { hold: 0.65, armDelay: 1.0, decay: 2.5 };

/**
 * Debounced hold detector: arms must be up continuously for `hold` seconds while
 * the player is on the ground. Being airborne (jumping) resets progress, so
 * cheering while jumping cannot trigger it.
 */
export class ArmsUpHold {
  progress = 0;
  triggered = false;
  private t0: number | null = null;
  private lastT: number | null = null;

  constructor(private cfg: ArmsHoldConfig = DEFAULT_ARMS_HOLD) {}

  reset(): void {
    this.progress = 0;
    this.triggered = false;
    this.t0 = null;
    this.lastT = null;
  }

  /** feed one observation; returns true exactly once when the hold completes */
  update(t: number, up: boolean, grounded = true): boolean {
    if (this.t0 === null) this.t0 = t;
    const dt = this.lastT === null ? 0 : Math.min(0.25, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.triggered) return false;
    if (t - this.t0 < this.cfg.armDelay) { this.progress = 0; return false; }
    if (!grounded) { this.progress = 0; return false; }
    if (up) this.progress = Math.min(1, this.progress + dt / this.cfg.hold);
    else this.progress = Math.max(0, this.progress - (dt * this.cfg.decay) / this.cfg.hold);
    if (this.progress >= 1) { this.triggered = true; return true; }
    return false;
  }
}

/** shoulder-line height and torso length (image units), or null if the upper body is not visible */
export function upperBody(lm: Landmark[] | null | undefined, minVisibility = 0.5): { y: number; torso: number } | null {
  if (!lm || lm.length < 25) return null;
  const vis = (k: number) => lm[k].v >= minVisibility;
  if (!vis(LS) || !vis(RS)) return null;
  const shY = (lm[LS].y + lm[RS].y) / 2;
  const shX = (lm[LS].x + lm[RS].x) / 2;
  let torso = Math.abs(lm[LS].x - lm[RS].x) * 1.4;
  if (vis(LH) && vis(RH)) torso = Math.hypot((lm[LH].x + lm[RH].x) / 2 - shX, (lm[LH].y + lm[RH].y) / 2 - shY);
  return torso < 0.02 ? null : { y: shY, torso };
}

/**
 * Second, detector-independent guard against jumping: the shoulder line must stay
 * (nearly) still for `window` seconds. A bounce moves it by far more than `maxMove` torso lengths.
 */
export class StillnessCheck {
  private hist: { t: number; y: number }[] = [];
  constructor(private window = 1.0, private maxMove = 0.12) {}
  reset(): void { this.hist = []; }
  /** returns true while the body has been still for the whole window */
  update(t: number, y: number, torso: number): boolean {
    this.hist.push({ t, y });
    while (this.hist.length > 2 && t - this.hist[0].t > this.window) this.hist.shift();
    let lo = Infinity, hi = -Infinity;
    for (const h of this.hist) { lo = Math.min(lo, h.y); hi = Math.max(hi, h.y); }
    return hi - lo <= this.maxMove * torso;
  }
}
