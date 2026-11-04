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
  /** peak of the normalised rise (torso lengths) */
  peak: number;
  t: number;
}
export interface TakeoffEvent { type: 'takeoff'; t: number }
export type JumpEvent = LandingEvent | TakeoffEvent;

export interface JumpConfig {
  /** rise (torso lengths) where a takeoff candidate starts / where the landing is timed */
  edge: number;
  /** peak rise (torso lengths) a hop must reach to count (filters tiny bounces / jitter) */
  airborne: number;
  /** min upward speed (torso lengths / s, frame-to-frame on the filtered signal) to start a takeoff */
  minUpVelocity: number;
  /** a takeoff candidate must reach `airborne` within this time (rejects tiptoe / slow standing up) */
  maxRiseTime: number;
  /** flight time (s) at or above which a jump counts as a high jump */
  highFlightTime: number;
  minFlightTime: number;
  maxFlightTime: number;
  /** after a landing, ignore new takeoffs for this long (s); 0 = immediately ready */
  refractory: number;
  /** seconds without a visible pose before the machine resets */
  lostTimeout: number;
  /** One-Euro filter on the rise signal */
  filterMinCutoff: number;
  filterBeta: number;
  /** baseline only re-centres after this long without any hop activity (s) */
  baselineQuiet: number;
  /**
   * thresholds are raised to the measured signal noise: edge ≥ 2.5·σ·f, airborne ≥ 4·σ·f
   * (σ = noise std in torso lengths, measured during calibration and while standing). 0 = off.
   */
  noiseFactor: number;
}

export const DEFAULT_JUMP_CONFIG: JumpConfig = {
  edge: 0.045,
  airborne: 0.07,
  minUpVelocity: 0.5,
  maxRiseTime: 0.4,
  highFlightTime: 0.5,
  minFlightTime: 0.1,
  maxFlightTime: 1.5,
  refractory: 0,
  lostTimeout: 0.4,
  filterMinCutoff: 8,
  filterBeta: 2,
  baselineQuiet: 0.8,
  noiseFactor: 1,
};

/**
 * Sensitivity preset (URL `?sens=`): 1 = default, > 1 = more sensitive (smaller hops count),
 * < 1 = less sensitive. Scales the amplitude and speed thresholds.
 */
export function sensitivityConfig(sens: number): Partial<JumpConfig> {
  const s = Math.min(3, Math.max(0.3, sens || 1));
  const d = DEFAULT_JUMP_CONFIG;
  return { edge: d.edge / s, airborne: d.airborne / s, minUpVelocity: d.minUpVelocity / s, noiseFactor: d.noiseFactor / s };
}

export const G = 9.81;
export const heightFromFlightTime = (T: number): number => (G * T * T) / 8;
/** max factor of the parabola correction (avoids blowing up flight times when the peak was undersampled) */
const MAX_CORRECTION = 1 / Math.sqrt(1 - 0.6);
/** upper bound of a torso length in metres (for the ballistic plausibility check) */
const TORSO_M_MAX = 0.5;

/**
 * Jump state machine on the (smoothed) body height.
 *
 * Input is a vertical body coordinate in normalised image coordinates (0 = top, 1 = bottom,
 * the hip/shoulder fusion from players.ts) and the current body scale (torso length, same units).
 * Everything is converted to "rise above the standing baseline in torso lengths", so thresholds
 * are independent of the camera distance (2–3 m laptop setup, kids vs adults).
 *
 * Built to work at low pose frame rates (10 fps and less): a hop may only have one or two
 * frames in the air, so the decision uses the peak seen between frames rather than requiring
 * every intermediate state, and the landing is emitted on the first frame below `edge`.
 */
export class JumpDetector {
  state: JumpState = 'GROUNDED';
  baselineY = 0.6;
  scale = 0.2;
  /** last filtered rise value (torso lengths) – for the debug overlay */
  rise = 0;
  velocity = 0;
  private filter: OneEuroFilter;
  private prevT = 0;
  private prevRise = 0;
  private edgeUpT = 0;
  private peak = 0;
  private valley = 0;
  private valleyT = 0;
  /** last time the rise crossed `edge` upwards */
  private upCrossT = -10;
  private prevRaw = 0;
  /** running estimate of the signal noise (torso lengths, std) while standing still */
  noise = 0.01;
  /** thresholds actually used (config raised to the measured noise level) */
  edgeEff = 0;
  airborneEff = 0;
  /** short history of the filtered rise for a ~0.1 s velocity window */
  private hist: { t: number; r: number }[] = [];
  private landT = -10;
  private lastSeenT = -10;
  private lastActiveT = -10;
  private offsetSince: number | null = null;
  private calibrated = false;
  private hasBaseline = false;
  /** counters for the debug overlay / tests */
  stats = { takeoffs: 0, landings: 0, rejectedBounces: 0, rejectedSlow: 0 };
  readonly cfg: JumpConfig;

  constructor(cfg: Partial<JumpConfig> = {}) {
    this.cfg = { ...DEFAULT_JUMP_CONFIG, ...cfg };
    this.updateThresholds();
    this.filter = new OneEuroFilter(this.cfg.filterMinCutoff, this.cfg.filterBeta, 4);
  }

  /** noise-adapted thresholds: a noisy camera raises them so jitter can't look like hops */
  private updateThresholds(): void {
    const c = this.cfg;
    const n = this.noise * c.noiseFactor;
    this.edgeEff = Math.max(c.edge, 2.5 * n);
    this.airborneEff = Math.max(c.airborne, this.edgeEff + 0.02 * c.noiseFactor, 4 * n);
  }

  /** @param noiseSd optional measured standard deviation of y while standing (image units) */
  calibrate(baselineY: number, scale: number, noiseSd?: number): void {
    this.baselineY = baselineY;
    this.scale = Math.max(0.02, scale);
    if (noiseSd !== undefined && noiseSd >= 0) {
      this.noise = Math.min(0.06, Math.max(0.004, noiseSd / this.scale));
      this.updateThresholds();
    }
    this.calibrated = true;
    this.hasBaseline = true;
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
    this.offsetSince = null;
  }

  /** Feed one frame. Returns events (takeoff / landing) produced by this frame. */
  update(t: number, y: number | null, scale?: number): JumpEvent[] {
    const out: JumpEvent[] = [];
    const c = this.cfg;
    if (y === null) {
      if (t - this.lastSeenT > c.lostTimeout && this.state !== 'GROUNDED') this.reset();
      return out;
    }
    if (!this.hasBaseline) {
      // never calibrated (calibration skipped): start from the first observation
      this.baselineY = y;
      if (scale && scale > 0.02) this.scale = scale;
      this.hasBaseline = true;
    }
    const firstAfterGap = t - this.lastSeenT > c.lostTimeout;
    if (firstAfterGap) { this.filter.reset(); this.prevT = t; }
    this.lastSeenT = t;
    const dt = Math.max(1e-3, t - this.prevT);

    const rawRise = (this.baselineY - y) / this.scale;
    // noise estimate from frame-to-frame differences while nothing happens (white noise: var(diff) = 2σ²)
    const band = 1.5 * this.edgeEff;
    // only while really standing: no hop, no takeoff candidate and no upward edge crossing for a while
    // (otherwise hops that were missed at low fps would inflate the estimate and block detection)
    const quietFor = t - Math.max(this.lastActiveT, this.upCrossT);
    if (!firstAfterGap && this.state === 'GROUNDED' && quietFor > c.baselineQuiet &&
        Math.abs(rawRise) < band && Math.abs(this.prevRaw) < band) {
      // winsorised so a takeoff frame barely moves the estimate, while real extra noise still raises it
      const lim = 3 * this.noise;
      const d = Math.max(-lim, Math.min(lim, rawRise - this.prevRaw));
      const k = Math.min(1, dt / 3);
      this.noise = Math.min(0.06, Math.max(0.004, Math.sqrt((1 - k) * this.noise * this.noise + (k * d * d) / 2)));
      this.updateThresholds();
    }
    this.prevRaw = rawRise;
    const rise = this.filter.filter(rawRise, t);
    // peak estimate: halfway back towards the raw value (the filter shaves 10–20 % off a 2-frame hop)
    const peakRise = Math.max(rise, (rise + rawRise) / 2);
    // frame-to-frame speed of the filtered signal: no extra lag, meaningful even at 5–10 fps
    const v = firstAfterGap ? 0 : (rise - this.prevRise) / dt;
    // upward speed over ≥ 0.085 s (one frame at ≤ 10 fps): robust against single-frame jitter at 30 fps
    if (firstAfterGap) this.hist = [];
    let ref = this.hist.length ? this.hist[this.hist.length - 1] : null;
    for (let i = this.hist.length - 1; i >= 0; i--) { ref = this.hist[i]; if (t - ref.t >= 0.085) break; }
    const vWin = ref ? (rise - ref.r) / Math.max(1e-3, t - ref.t) : 0;
    // takeoff speed: steepest rise from any sample 0.06–0.3 s back (a hop's first frame above the
    // edge may sit right after a frame that was already slightly up, especially at low fps)
    // (the climb must also clearly exceed the measured noise, so jitter between two close frames can't fake it)
    const minClimb = 3 * this.noise * c.noiseFactor;
    let vTake = vWin;
    for (const h of this.hist) {
      const age = t - h.t;
      if (age >= 0.06 && age <= 0.3 && rise - h.r > minClimb) vTake = Math.max(vTake, (rise - h.r) / age);
    }
    this.hist.push({ t, r: rise });
    while (this.hist.length > 2 && t - this.hist[1].t >= 0.3) this.hist.shift();
    this.rise = rise;
    this.velocity = v;

    // time where `rise` crossed `level` between the previous and this frame (linear interpolation)
    const crossT = (level: number) => {
      const a = this.prevRise, b = rise;
      if (a === b) return t;
      const f = Math.min(1, Math.max(0, (level - a) / (b - a)));
      return this.prevT + f * (t - this.prevT);
    };

    const E = this.edgeEff, A = this.airborneEff;
    if (this.prevRise <= E && rise > E) this.upCrossT = crossT(E);
    if (this.state === 'LANDING' && t - this.landT >= c.refractory) this.state = 'GROUNDED';

    if (this.state === 'GROUNDED') {
      this.trackBaseline(t, dt, y, rise, v, scale);
      // must have crossed `edge` from below just now (≤ 0.2 s ago) and be moving up fast enough
      if (rise > E && t - this.upCrossT <= 0.2 && vTake > c.minUpVelocity && t - this.landT >= c.refractory) {
        this.edgeUpT = this.upCrossT;
        this.peak = peakRise;
        this.state = 'TAKEOFF';
      }
    } else {
      this.lastActiveT = t;
    }

    if (this.state === 'TAKEOFF') {
      this.peak = Math.max(this.peak, peakRise);
      if (this.peak >= A) {
        // may happen in the very same frame as the takeoff at low frame rates
        this.state = v < 0 ? 'APEX' : 'AIRBORNE';
        this.stats.takeoffs++;
        out.push({ type: 'takeoff', t: this.edgeUpT });
      } else if (rise < E) {
        this.state = 'GROUNDED'; // tiny bounce / jitter – not a jump
        this.stats.rejectedBounces++;
      } else if (t - this.edgeUpT > c.maxRiseTime) {
        this.state = 'GROUNDED'; // slow rise (tiptoe, standing up)
        this.stats.rejectedSlow++;
      }
    } else if (this.state === 'AIRBORNE' || this.state === 'APEX') {
      this.peak = Math.max(this.peak, peakRise);
      if (this.state === 'AIRBORNE' && v < 0) { this.state = 'APEX'; this.valley = rise; this.valleyT = t; }
      if (this.state === 'APEX' && rise < this.valley) { this.valley = rise; this.valleyT = t; }
      // fast rhythmic hopping at low fps (or filter lag): the ground contact between two hops may never
      // dip below `edge`. A clear valley followed by a clear rise = landing + new takeoff.
      const dipNeeded = Math.max(0.04, 0.35 * this.peak, 4 * this.noise * c.noiseFactor);
      if (this.state === 'APEX' && rise >= E && this.valley <= 1.5 * E && this.peak - this.valley >= dipNeeded &&
          rise - this.valley >= dipNeeded && vWin > c.minUpVelocity) {
        const flightTime = this.flightFrom(this.valleyT - this.edgeUpT);
        this.landT = this.valleyT;
        this.emitLanding(out, flightTime, t);
        this.edgeUpT = this.valleyT;
        this.peak = peakRise;
        this.state = 'AIRBORNE';
        this.stats.takeoffs++;
        out.push({ type: 'takeoff', t: this.valleyT });
      } else if (rise < E) {
        const downT = this.prevRise >= E ? crossT(E) : t - dt / 2;
        const flightTime = this.flightFrom(Math.max(0, downT - this.edgeUpT));
        this.state = 'LANDING';
        this.landT = t;
        this.emitLanding(out, flightTime, t);
      } else if (t - this.edgeUpT > c.maxFlightTime) {
        this.state = 'GROUNDED'; // stayed up: stepped closer / stood up – re-baseline below
        this.offsetSince = t - 10;
      }
    }
    this.prevRise = rise;
    this.prevT = t;
    return out;
  }

  private emitLanding(out: JumpEvent[], flightTime: number, t: number): void {
    const c = this.cfg;
    if (flightTime < c.minFlightTime || flightTime > c.maxFlightTime) return;
    // ballistic plausibility: a hop that reached only `peak` cannot stay up much longer than physics
    // allows (generous: torso up to 0.5 m, ×2.2) – rejects tiptoeing / slow lifting of the body
    const tMax = Math.max(0.35, 2.2 * Math.sqrt((8 * this.peak * TORSO_M_MAX) / G));
    if (flightTime > tMax) { this.stats.rejectedSlow++; return; }
    this.stats.landings++;
    out.push({ type: 'landing', flightTime, height: heightFromFlightTime(flightTime), high: flightTime >= c.highFlightTime, peak: this.peak, t });
  }

  /** parabola correction: the time spent above `edge` is shorter than the full flight */
  private flightFrom(measured: number): number {
    const ratio = Math.min(0.9, this.edgeEff / Math.max(this.peak, 1e-3));
    return measured * Math.min(MAX_CORRECTION, 1 / Math.sqrt(1 - ratio));
  }

  /**
   * Baseline = standing height. Only re-centred when nothing has happened for a while,
   * so rhythmic hopping can never "absorb" itself into the baseline. A persistent offset
   * (person moved closer/further, calibration skipped) is re-acquired quickly.
   */
  private trackBaseline(t: number, dt: number, y: number, rise: number, v: number, scale?: number): void {
    const c = this.cfg;
    const quiet = t - this.lastActiveT > c.baselineQuiet && Math.abs(v) < c.minUpVelocity;
    if (Math.abs(rise) > this.edgeEff) {
      if (Math.abs(v) < c.minUpVelocity) this.offsetSince ??= t;
      else this.offsetSince = null;
    } else this.offsetSince = null;
    let k = 0;
    if (this.offsetSince !== null && t - this.offsetSince > 1.2) k = Math.min(1, dt / 0.3);
    else if (quiet && Math.abs(rise) <= this.edgeEff) k = Math.min(1, dt / 1.5);
    if (k > 0) {
      this.baselineY += (y - this.baselineY) * k;
      if (scale && scale > 0.02) this.scale += (scale - this.scale) * k * 0.5;
      // keep the filter consistent with the moved baseline
      if (k === 1 || this.offsetSince !== null) this.filter.reset();
    }
  }
}
