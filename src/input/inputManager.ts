import { CameraTracker } from './camera';
import { TrackedPlayer, assignPoses, hipFromPose, type HipSample } from './players';
import { heightFromFlightTime, sensitivityConfig, type JumpConfig, type LandingEvent } from './jumpDetector';
import { idleCrowd, stepCrowd, visiblePeople, type CrowdClock } from './crowd';

export interface PlayerInput {
  id: number;
  /** horizontal position 0..1 across the screen (mirrored, like a mirror) */
  x: number;
  active: boolean;
  source: 'camera' | 'keyboard';
  /** landings since the last poll */
  landings: LandingEvent[];
  state: string;
  rise: number;
}

/**
 * Merges camera tracking and the keyboard/mouse fallback into one input stream.
 * Games only ever see an x position and landing events.
 */
export class InputManager {
  camera: CameraTracker | null = null;
  tracked: TrackedPlayer;
  /** camera x range [0.5-range/2, 0.5+range/2] is stretched to the whole screen */
  range = 0.7;
  /** keyboard step for arrow keys */
  kbStep = 1 / 6;
  private kbX = 0.5;
  private kbEvents: LandingEvent[] = [];
  private lastKbT = -99;
  private prevX: number | null = null;
  keyListeners = new Set<(e: KeyboardEvent) => void>();
  /** when true, game keys (space/arrows) are not interpreted as jumps (name entry) */
  textMode = false;
  /**
   * While a round is running, keyboard and mouse must not dig, jump, or move the column.
   * Menu, calibration and name entry leave this false.
   */
  gameplay = false;
  /** bodies currently visible (0–2). Not a player count. */
  peopleInFrame = 0;
  private crowdState: CrowdClock = idleCrowd();

  constructor(cfg: Partial<JumpConfig>) {
    this.tracked = new TrackedPlayer(cfg);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('mousemove', (e) => {
      if (this.gameplay) return;
      const r = (e.target as HTMLElement)?.closest?.('canvas')?.getBoundingClientRect();
      if (!r) return;
      this.kbX = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.lastKbT = performance.now() / 1000;
    });
  }

  get cameraRunning(): boolean {
    return this.camera?.status.state === 'running';
  }

  /** A second person has been in frame long enough that play should wait. */
  get crowd(): boolean {
    return this.crowdState.crowd;
  }

  private lastResultT = -1;

  attachCamera(cam: CameraTracker): void {
    this.camera = cam;
    cam.onResult = (r, nowMs) => {
      // use the frame's capture time, not the arrival time: inference latency jitters and would
      // distort the measured vertical speed and flight time (kept strictly increasing)
      const cap = Number.isFinite(r.captureT) && r.captureT <= nowMs ? r.captureT : nowMs;
      const t = Math.max(cap / 1000, this.lastResultT + 0.001);
      this.lastResultT = t;
      const hips: HipSample[] = r.poses.map((p) => hipFromPose(p, cam.aspect));
      this.notePeople(visiblePeople(hips), t);
      const prev = this.prevX !== null && this.tracked.visible ? this.tracked.rawX : null;
      const k = assignPoses(hips, prev);
      this.tracked.feed(t, k !== null ? hips[k] : null, k !== null ? r.poses[k] : null);
      this.prevX = k !== null ? hips[k].x : null;
    };
  }

  /** Update the second-person pause from how many bodies are visible. */
  notePeople(count: number, t: number): void {
    this.peopleInFrame = count;
    this.crowdState = stepCrowd(this.crowdState, count, t);
  }

  private synth(high: boolean): void {
    const T = high ? 0.62 : 0.4;
    const t = performance.now() / 1000;
    this.kbEvents.push({ type: 'landing', flightTime: T, height: heightFromFlightTime(T), high, peak: 0, t });
    this.lastKbT = t;
  }

  private move(dir: number): void {
    const cells = Math.round(1 / this.kbStep);
    let cell = Math.floor(this.kbX * cells);
    cell = Math.max(0, Math.min(cells - 1, cell + dir));
    this.kbX = (cell + 0.5) / cells;
    this.lastKbT = performance.now() / 1000;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    for (const l of [...this.keyListeners]) l(e);
    if (this.textMode || e.repeat) return;
    // in a round, these keys must not remove blocks or steer the column
    if (this.gameplay) {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'KeyA': case 'ArrowLeft': this.move(-1); e.preventDefault(); break;
      case 'KeyD': case 'ArrowRight': this.move(1); e.preventDefault(); break;
      case 'Space': case 'KeyW': case 'ArrowUp': this.synth(e.shiftKey); e.preventDefault(); break;
      case 'KeyE': case 'KeyS': case 'ArrowDown': this.synth(true); e.preventDefault(); break;
    }
  };

  /** put the keyboard cursor at x (0..1) */
  setKbX(x: number): void {
    this.kbX = x;
  }

  /** camera x (0..1) → screen x with sensitivity stretch */
  mapX(x: number): number {
    return Math.min(1, Math.max(0, (x - 0.5) / this.range + 0.5));
  }

  poll(): PlayerInput[] {
    const now = performance.now() / 1000;
    const tp = this.tracked;
    const camActive = this.cameraRunning && tp.visible;
    const kbRecent = now - this.lastKbT < 3;
    const useCam = this.gameplay ? camActive : camActive && !kbRecent;
    // a second person must not land a camera jump; keyboard jumps are only for menus
    const camLandings = this.cameraRunning && !this.crowd ? tp.pending : [];
    const landings = [...(this.gameplay ? [] : this.kbEvents), ...camLandings];
    this.kbEvents = [];
    tp.pending = [];
    return [{
      id: 0,
      x: useCam ? this.mapX(tp.x) : this.kbX,
      active: useCam || !this.cameraRunning || kbRecent,
      source: useCam ? 'camera' : 'keyboard',
      landings,
      state: useCam ? tp.detector.state : 'TASTATUR',
      rise: tp.detector.rise,
    }];
  }

  /** Drop any queued landings (e.g. when switching scenes). */
  flush(): void {
    this.kbEvents = [];
    this.tracked.pending = [];
  }

  /** Camera landings only; keyboard jumps are discarded. */
  takeCameraLandings(): LandingEvent[] {
    const ev = this.crowd ? [] : [...this.tracked.pending];
    this.tracked.pending = [];
    this.kbEvents = [];
    return ev;
  }

  /**
   * Apply a sensitivity factor (`?sens=`) and high-jump flight time.
   * Resets the in-flight state so a half-seen hop doesn't keep the old thresholds.
   */
  applyJumpTuning(sens: number, highFlightTime: number): void {
    const partial: Partial<JumpConfig> = { ...sensitivityConfig(sens), highFlightTime };
    this.tracked.detector.applyConfig(partial);
    this.tracked.detector.reset();
    this.tracked.pending = [];
    this.kbEvents = [];
  }
}
