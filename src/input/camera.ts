/**
 * Webcam + pose pipeline. Video never leaves the browser: frames are only
 * passed (as ImageBitmaps) to a local Web Worker running MediaPipe; only
 * landmark coordinates (and a person mask for the on-screen cut-out) come back.
 */
import type { FromWorker, Landmark, PoseOptions, PoseResult, ToWorker } from './pose/types';
import type { PoseEngine } from './pose/engine';

export interface CameraStatus {
  state: 'off' | 'starting' | 'running' | 'error';
  message: string;
  mode: 'worker' | 'main' | '-';
  delegate: string;
  segmentation: boolean;
}

const PROC_W = 640;

export class CameraTracker {
  video = document.createElement('video');
  /** mirrored person cut-out (or mirrored video if no mask) for display */
  readonly canvas = document.createElement('canvas');
  status: CameraStatus = { state: 'off', message: '', mode: '-', delegate: '-', segmentation: false };
  latest: PoseResult | null = null;
  /** called for every new pose result */
  onResult: ((r: PoseResult, now: number) => void) | null = null;
  // stats
  inferMs = 0;
  latencyMs = 0;
  fps = 0;
  frameVersion = 0;

  private worker: Worker | null = null;
  private engine: PoseEngine | null = null;
  private busy = false;
  private frameId = 0;
  private pendingFrames = new Map<number, ImageBitmap>();
  private ctx: CanvasRenderingContext2D;
  private maskCanvas = document.createElement('canvas');
  private maskCtx: CanvasRenderingContext2D;
  private maskImage: ImageData | null = null;
  private procH = 360;
  private fpsCount = 0;
  private fpsT = 0;
  private stopped = false;

  constructor(private opts: { modelUrl: string; wasmBase: string; segmentation: boolean; useWorker: boolean; delegate?: 'GPU' | 'CPU' }) {
    this.ctx = this.canvas.getContext('2d')!;
    this.maskCtx = this.maskCanvas.getContext('2d')!;
    this.video.playsInline = true;
    this.video.muted = true;
  }

  get aspect(): number {
    return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
  }

  async start(): Promise<void> {
    this.status = { ...this.status, state: 'starting', message: 'Kamera wird gestartet …' };
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Keine Kamera-Unterstützung (HTTPS nötig)');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    this.procH = Math.round(PROC_W / this.aspect);
    this.canvas.width = PROC_W;
    this.canvas.height = this.procH;

    const poseOpts: PoseOptions = {
      wasmBase: this.opts.wasmBase,
      modelUrl: this.opts.modelUrl,
      segmentation: this.opts.segmentation,
      delegate: this.opts.delegate,
    };
    this.status.message = 'Lade Bewegungserkennung …';
    let ok = false;
    if (this.opts.useWorker && typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined') {
      ok = await this.startWorker(poseOpts).catch((e) => {
        console.warn('[camera] worker failed, using main thread', e);
        return false;
      });
    }
    if (!ok) {
      const { PoseEngine } = await import('./pose/engine');
      this.engine = new PoseEngine();
      await this.engine.init(poseOpts, false);
      this.status.mode = 'main';
      this.status.delegate = this.engine.delegate;
    }
    this.status.segmentation = this.opts.segmentation;
    this.status.state = 'running';
    this.status.message = 'Kamera läuft';
    this.loop();
  }

  private startWorker(opts: PoseOptions): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./pose/pose.worker.ts', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => { w.terminate(); reject(new Error('worker init timeout')); }, 45000);
      w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || 'worker error')); };
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          this.worker = w;
          this.status.mode = 'worker';
          this.status.delegate = m.delegate;
          w.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorkerMessage(ev.data);
          resolve(true);
        } else if (m.type === 'error') {
          clearTimeout(timer);
          w.terminate();
          reject(new Error(m.message));
        }
      };
      w.postMessage({ type: 'init', opts } satisfies ToWorker);
    });
  }

  private onWorkerMessage(m: FromWorker): void {
    if (m.type === 'result') {
      this.busy = false;
      const frame = this.pendingFrames.get(m.id) ?? null;
      this.pendingFrames.delete(m.id);
      this.handleResult(m, frame);
      frame?.close();
    } else if (m.type === 'error') {
      this.busy = false;
      console.warn('[pose worker]', m.message);
    }
  }

  private handleResult(r: PoseResult, frame: ImageBitmap | HTMLVideoElement | null): void {
    const now = performance.now();
    this.inferMs = r.inferMs;
    this.latencyMs = now - r.captureT;
    this.latest = r;
    this.fpsCount++;
    if (now - this.fpsT > 1000) { this.fps = (this.fpsCount * 1000) / (now - this.fpsT); this.fpsCount = 0; this.fpsT = now; }
    if (frame) this.composite(frame, r);
    this.onResult?.(r, now);
  }

  /** Draws the mirrored frame; if a mask exists, keeps only the person pixels. */
  private composite(frame: ImageBitmap | HTMLVideoElement, r: PoseResult): void {
    const w = this.canvas.width, h = this.canvas.height;
    const c = this.ctx;
    c.save();
    c.clearRect(0, 0, w, h);
    c.setTransform(-1, 0, 0, 1, w, 0);
    c.drawImage(frame, 0, 0, w, h);
    if (r.mask && r.maskW && r.maskH) {
      if (this.maskCanvas.width !== r.maskW || this.maskCanvas.height !== r.maskH || !this.maskImage) {
        this.maskCanvas.width = r.maskW;
        this.maskCanvas.height = r.maskH;
        this.maskImage = this.maskCtx.createImageData(r.maskW, r.maskH);
      }
      const d = this.maskImage.data;
      const m = r.mask;
      for (let i = 0, j = 0; i < m.length; i++, j += 4) { d[j] = 255; d[j + 1] = 255; d[j + 2] = 255; d[j + 3] = m[i]; }
      this.maskCtx.putImageData(this.maskImage, 0, 0);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(this.maskCanvas, 0, 0, w, h);
    }
    c.restore();
    this.frameVersion++;
  }

  private loop = (): void => {
    if (this.stopped) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(this.loop) : requestAnimationFrame(this.loop));
    if (this.busy || this.video.readyState < 2) { next(); return; }
    const captureT = performance.now();
    if (this.worker) {
      this.busy = true;
      const id = ++this.frameId;
      const size = { resizeWidth: PROC_W, resizeHeight: this.procH, resizeQuality: 'low' as ResizeQuality };
      Promise.all([createImageBitmap(this.video, size), createImageBitmap(this.video, size)])
        .then(([forWorker, forDisplay]) => {
          this.pendingFrames.set(id, forDisplay);
          this.worker!.postMessage({ type: 'frame', id, captureT, bitmap: forWorker } satisfies ToWorker, [forWorker]);
        })
        .catch(() => { this.busy = false; });
    } else if (this.engine) {
      const t0 = performance.now();
      const r = this.engine.detect(this.video, t0);
      this.handleResult({ id: ++this.frameId, captureT, ...r, inferMs: performance.now() - t0 }, this.video);
    }
    next();
  };

  stop(): void {
    this.stopped = true;
    this.worker?.terminate();
    (this.video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    this.status.state = 'off';
  }
}

/** Landmark indices (MediaPipe BlazePose 33-point topology) */
export const LM = { L_SHOULDER: 11, R_SHOULDER: 12, L_HIP: 23, R_HIP: 24, L_ANKLE: 27, R_ANKLE: 28 } as const;
export const POSE_EDGES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12],
];
export type { Landmark };
