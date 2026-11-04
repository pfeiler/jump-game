/**
 * Synthetic vertical body signal for jump-detector tests.
 * Units: image y (0 = top, grows downwards); `scale` = torso length in image units.
 * Heights are given in torso lengths so scenarios are camera-distance independent.
 */
import { mulberry32 } from '../../src/core/rng';

export const BASE = 0.6;
export const SCALE = 0.15;

export interface Sample { t: number; y: number }

export interface HopSeries {
  /** peak rise in torso lengths */
  peak: number;
  /** flight time (s) */
  flight: number;
  /** ground contact between hops (s) */
  contact: number;
  /** dip of the hip into the mat / knees during contact (torso lengths) */
  dip?: number;
  count: number;
  start?: number;
}

/** rise (torso lengths) of a rhythmic hop series at time t */
export function hopRise(s: HopSeries, t: number): number {
  const start = s.start ?? 1;
  const period = s.flight + s.contact;
  if (t < start) return 0;
  const k = Math.floor((t - start) / period);
  if (k >= s.count) return 0;
  const p = t - start - k * period;
  if (p < s.flight) { const u = p / s.flight; return 4 * s.peak * u * (1 - u); }
  const u = (p - s.flight) / s.contact;
  return -(s.dip ?? 0) * Math.sin(Math.PI * u);
}

/** gaussian via Box-Muller */
function gauss(rnd: () => number): number {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SampleOpts {
  fps: number;
  duration: number;
  /** gaussian noise sigma in torso lengths */
  noise?: number;
  /** random timestamp jitter (s, ±) */
  jitter?: number;
  /** phase offset of the first frame (0..1 of a frame) */
  phase?: number;
  seed?: number;
  /** probability that a frame is dropped (pose not visible / skipped) */
  drop?: number;
}

/** sample a rise function (torso lengths) like a camera would */
export function sample(rise: (t: number) => number, o: SampleOpts): Sample[] {
  const rnd = mulberry32(o.seed ?? 1);
  const out: Sample[] = [];
  const dt = 1 / o.fps;
  for (let t = (o.phase ?? 0) * dt; t < o.duration; t += dt) {
    if (o.drop && rnd() < o.drop) continue;
    const tj = t + (o.jitter ? (rnd() - 0.5) * 2 * o.jitter : 0);
    const r = rise(t) + (o.noise ? gauss(rnd) * o.noise : 0);
    out.push({ t: tj, y: BASE - r * SCALE });
  }
  return out;
}
