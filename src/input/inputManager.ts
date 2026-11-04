import { CameraTracker } from './camera';
import { TrackedPlayer, assignPoses, hipFromPose, type HipSample } from './players';
import { heightFromFlightTime, type JumpConfig, type LandingEvent } from './jumpDetector';

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
 * Merges camera tracking and the keyboard/mouse fallback into one per-player
 * input stream. Games only ever see x positions and landing events.
 */
export class InputManager {
  players: 1 | 2 = 1;
  camera: CameraTracker | null = null;
  tracked: TrackedPlayer[];
  /** camera x range [0.5-range/2, 0.5+range/2] is stretched to the whole screen */
  range = 0.7;
  /** keyboard step for arrow keys */
  kbStep = 1 / 6;
  private kbX = [0.5, 0.75];
  private kbEvents: LandingEvent[][] = [[], []];
  private lastKbT = [-99, -99];
  private prevAssign: (number | null)[] = [null, null];
  keyListeners = new Set<(e: KeyboardEvent) => void>();
  /** when true, game keys (space/arrows) are not interpreted as jumps (name entry) */
  textMode = false;

  constructor(cfg: Partial<JumpConfig>) {
    this.tracked = [new TrackedPlayer(cfg), new TrackedPlayer(cfg)];
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('mousemove', (e) => {
      if (this.players !== 1) return;
      const r = (e.target as HTMLElement)?.closest?.('canvas')?.getBoundingClientRect();
      if (!r) return;
      this.kbX[0] = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.lastKbT[0] = performance.now() / 1000;
    });
  }

  setPlayers(n: 1 | 2): void {
    this.players = n;
    this.camera?.setNumPoses(n);
    this.kbX = n === 1 ? [0.5, 0.75] : [0.25, 0.75];
    this.prevAssign = [null, null];
  }

  get cameraRunning(): boolean {
    return this.camera?.status.state === 'running';
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
      const prev = this.tracked.slice(0, this.players).map((p, i) => (this.prevAssign[i] !== null && p.visible ? p.rawX : null));
      const a = assignPoses(hips, prev, this.players);
      for (let i = 0; i < 2; i++) {
        const k = a[i] ?? null;
        this.tracked[i].feed(t, k !== null ? hips[k] : null, k !== null ? r.poses[k] : null);
        this.prevAssign[i] = k;
      }
    };
  }

  private synth(i: number, high: boolean): void {
    const T = high ? 0.62 : 0.4;
    const t = performance.now() / 1000;
    this.kbEvents[i].push({ type: 'landing', flightTime: T, height: heightFromFlightTime(T), high, peak: 0, t });
    this.lastKbT[i] = t;
  }

  private move(i: number, dir: number): void {
    const lo = this.players === 2 && i === 1 ? 0.5 : 0;
    const hi = this.players === 2 && i === 0 ? 0.5 : 1;
    const step = this.players === 2 ? this.kbStep * 2 * 0.5 : this.kbStep;
    const cur = this.kbX[i];
    // snap to the centre of the next cell
    const cells = Math.round((hi - lo) / step);
    let cell = Math.floor(((cur - lo) / (hi - lo)) * cells);
    cell = Math.max(0, Math.min(cells - 1, cell + dir));
    this.kbX[i] = lo + ((cell + 0.5) / cells) * (hi - lo);
    this.lastKbT[i] = performance.now() / 1000;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    for (const l of [...this.keyListeners]) l(e);
    if (this.textMode || e.repeat) return;
    const two = this.players === 2;
    const k = e.code;
    const p2 = two ? 1 : 0;
    switch (k) {
      case 'KeyA': this.move(0, -1); break;
      case 'KeyD': this.move(0, 1); break;
      case 'ArrowLeft': this.move(p2, -1); e.preventDefault(); break;
      case 'ArrowRight': this.move(p2, 1); e.preventDefault(); break;
      case 'Space': this.synth(0, e.shiftKey); e.preventDefault(); break;
      case 'KeyW': this.synth(0, e.shiftKey); break;
      case 'KeyE': case 'KeyS': this.synth(0, true); break;
      case 'ArrowUp': this.synth(p2, e.shiftKey); e.preventDefault(); break;
      case 'ArrowDown': this.synth(p2, true); e.preventDefault(); break;
    }
  };

  /** put the keyboard cursor of player i at x (0..1) */
  setKbX(i: number, x: number): void {
    this.kbX[i] = x;
  }

  /** camera x (0..1) → screen x with sensitivity stretch */
  mapX(x: number): number {
    return Math.min(1, Math.max(0, (x - 0.5) / this.range + 0.5));
  }

  poll(): PlayerInput[] {
    const out: PlayerInput[] = [];
    const now = performance.now() / 1000;
    for (let i = 0; i < this.players; i++) {
      const tp = this.tracked[i];
      const camActive = this.cameraRunning && tp.visible;
      const kbRecent = now - this.lastKbT[i] < 3;
      const useCam = camActive && !kbRecent;
      const landings = [...this.kbEvents[i], ...(this.cameraRunning ? tp.pending : [])];
      this.kbEvents[i] = [];
      tp.pending = [];
      let x = useCam ? this.mapX(tp.x) : this.kbX[i];
      if (this.players === 2 && !useCam) x = i === 0 ? Math.min(0.499, x) : Math.max(0.5, x);
      out.push({
        id: i,
        x,
        active: useCam || !this.cameraRunning || kbRecent,
        source: useCam ? 'camera' : 'keyboard',
        landings,
        state: useCam ? tp.detector.state : 'TASTATUR',
        rise: tp.detector.rise,
      });
    }
    return out;
  }

  /** Drop any queued landings (e.g. when switching scenes). */
  flush(): void {
    this.kbEvents = [[], []];
    for (const t of this.tracked) t.pending = [];
  }
}
