import { OneEuroFilter } from './oneEuro';

export type JumpState = 'GROUNDED' | 'TAKEOFF' | 'AIRBORNE' | 'APEX' | 'LANDING';

export interface LandingEvent {
  type: 'landing';
  /** estimated flight time in seconds */
  flightTime: number;
  /** jump height in metres from h = g·T²/8 */
  height: number;
  /** flight time above the high-jump threshold => double hit */
  high: boolean;
  /** peak of the normalised hip rise (torso lengths) */
  peak: number;
  t: number;
}
export interface TakeoffEvent { type: 'takeoff'; t: number }
export type JumpEvent = LandingEvent | TakeoffEvent;

export interface JumpConfig {
  /** rise (in torso lengths) where a takeoff candidate starts / where landing is detected */
  edge: number;
  /** rise (torso lengths) the hip must exceed to count as a real jump (filters small bounces) */
  airborne: number;
  /** min upward velocity (torso lengths / s) at takeoff */
  minUpVelocity: number;
  /** flight time (s) at or above which a jump counts as a high jump */
  highFlightTime: number;
  minFlightTime: number;
  maxFlightTime: number;
  /** after landing, ignore new takeoffs for this long (s) */
  refractory: number;
  /** seconds without a visible pose before the machine resets */
  lostTimeout: number;
}

export const DEFAULT_JUMP_CONFIG: JumpConfig = {
  edge: 0.1,
  airborne: 0.22,
  minUpVelocity: 0.6,
  highFlightTime: 0.5,
  minFlightTime: 0.15,
  maxFlightTime: 2.0,
  refractory: 0.12,
  lostTimeout: 0.4,
};

export const G = 9.81;
export const heightFromFlightTime = (T: number): number => (G * T * T) / 8;

/**
 * Jump state machine on the (smoothed) hip-centre height.
 *
 * Input is the hip centre y in normalised image coordinates (0 = top, 1 = bottom)
 * and the current body scale (torso length, same units). Everything is
 * converted to "rise above baseline in torso lengths" so thresholds are
 * independent of the camera distance (2–3 m laptop setup, kids vs adults).
 */
export class JumpDetector {
  state: JumpState = 'GROUNDED';
  baselineY = 0.6;
  scale = 0.2;
  /** last filtered rise value (torso lengths) – for the debug overlay */
  rise = 0;
  velocity = 0;
  private filter = new OneEuroFilter(1.7, 0.6, 1.2);
  private prevT = 0;
  private prevRise = 0;
  private edgeUpT = 0;
  private peak = 0;
  private landT = -10;
  private lastSeenT = 0;
  private calibrated = false;
  readonly cfg: JumpConfig;

  constructor(cfg: Partial<JumpConfig> = {}) {
    this.cfg = { ...DEFAULT_JUMP_CONFIG, ...cfg };
  }

  calibrate(baselineY: number, scale: number): void {
    this.baselineY = baselineY;
    this.scale = Math.max(0.02, scale);
    this.calibrated = true;
    this.reset();
  }

  get isCalibrated(): boolean {
    return this.calibrated;
  }

  reset(): void {
    this.state = 'GROUNDED';
    this.filter.reset();
    this.rise = 0;
    this.velocity = 0;
    this.prevRise = 0;
    this.peak = 0;
  }

  /** Feed one frame. Returns events (takeoff / landing) produced by this frame. */
  update(t: number, hipY: number | null, scale?: number): JumpEvent[] {
    const out: JumpEvent[] = [];
    const c = this.cfg;
    if (hipY === null) {
      if (t - this.lastSeenT > c.lostTimeout && this.state !== 'GROUNDED') this.reset();
      return out;
    }
    if (t - this.lastSeenT > c.lostTimeout) this.filter.reset();
    this.lastSeenT = t;

    // slowly adapt the body scale (person may step closer / further)
    if (scale && scale > 0.02 && this.state === 'GROUNDED') {
      this.scale += (scale - this.scale) * 0.02;
    }

    const rawRise = (this.baselineY - hipY) / this.scale;
    const rise = this.filter.filter(rawRise, t);
    const v = this.filter.derivative;
    const dt = Math.max(1e-3, t - this.prevT);
    this.rise = rise;
    this.velocity = v;

    // linear interpolation of the time where `rise` crossed `level` in this frame
    const crossT = (level: number) => {
      const a = this.prevRise;
      const b = rise;
      if (a === b) return t;
      const f = Math.min(1, Math.max(0, (level - a) / (b - a)));
      return this.prevT + f * (t - this.prevT);
    };

    switch (this.state) {
      case 'GROUNDED': {
        // drift compensation: slowly re-centre baseline while standing still
        if (Math.abs(v) < 0.4) {
          const k = Math.min(1, dt / 3);
          this.baselineY += (hipY - this.baselineY) * k;
        }
        if (rise > c.edge && v > c.minUpVelocity * 0.5 && t - this.landT > c.refractory) {
          this.edgeUpT = this.prevRise <= c.edge ? crossT(c.edge) : t - dt;
          this.peak = rise;
          this.state = 'TAKEOFF';
        }
        break;
      }
      case 'TAKEOFF': {
        this.peak = Math.max(this.peak, rise);
        if (rise > c.airborne && v > c.minUpVelocity * 0.5) {
          this.state = 'AIRBORNE';
          out.push({ type: 'takeoff', t: this.edgeUpT });
        } else if (rise < c.edge || v < -c.minUpVelocity) {
          // small bounce / sway – not a jump
          this.state = 'GROUNDED';
        } else if (t - this.edgeUpT > 0.5) {
          this.state = 'GROUNDED'; // slow rise (standing up / tiptoe)
        }
        break;
      }
      case 'AIRBORNE':
      case 'APEX': {
        this.peak = Math.max(this.peak, rise);
        if (this.state === 'AIRBORNE' && v < 0) this.state = 'APEX';
        if (rise < c.edge && this.prevRise >= c.edge) {
          const downT = crossT(c.edge);
          const measured = downT - this.edgeUpT;
          // parabola correction: time spent above `edge` is shorter than full flight
          const ratio = Math.min(0.9, c.edge / Math.max(this.peak, 1e-3));
          const flightTime = measured / Math.sqrt(1 - ratio);
          this.state = 'LANDING';
          this.landT = t;
          if (flightTime >= c.minFlightTime && flightTime <= c.maxFlightTime) {
            out.push({
              type: 'landing',
              flightTime,
              height: heightFromFlightTime(flightTime),
              high: flightTime >= c.highFlightTime,
              peak: this.peak,
              t,
            });
          }
        } else if (t - this.edgeUpT > c.maxFlightTime) {
          this.state = 'GROUNDED';
        }
        break;
      }
      case 'LANDING': {
        if (t - this.landT > c.refractory) this.state = 'GROUNDED';
        break;
      }
    }
    this.prevRise = rise;
    this.prevT = t;
    return out;
  }
}
