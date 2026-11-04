/**
 * Thin wrapper around the MediaPipe Pose Landmarker that works both inside a
 * Web Worker (ImageBitmap input) and on the main thread (video element input).
 */
import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Landmark, PoseOptions } from './types';

export class PoseEngine {
  landmarker!: PoseLandmarker;
  delegate = 'GPU';
  private lastTs = 0;

  async init(opts: PoseOptions, inWorker: boolean): Promise<void> {
    // In a module worker importScripts() is unavailable, so use the ES-module flavour of the wasm loader.
    const fileset = await FilesetResolver.forVisionTasks(opts.wasmBase, inWorker);
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: opts.modelUrl, delegate },
        runningMode: 'VIDEO',
        numPoses: opts.numPoses,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: opts.segmentation,
        ...(inWorker && typeof OffscreenCanvas !== 'undefined' ? { canvas: new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement } : {}),
      });
    if (opts.delegate === 'CPU') {
      this.landmarker = await make('CPU');
      this.delegate = 'CPU';
      return;
    }
    try {
      this.landmarker = await make('GPU');
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('[pose] GPU delegate failed, falling back to CPU', e);
      this.landmarker = await make('CPU');
      this.delegate = 'CPU';
    }
  }

  setNumPoses(n: number): void {
    void this.landmarker.setOptions({ numPoses: n });
  }

  detect(
    image: ImageBitmap | HTMLVideoElement,
    tsMs: number,
  ): { poses: Landmark[][]; mask: Uint8Array | null; maskW: number; maskH: number } {
    const ts = Math.max(tsMs, this.lastTs + 1);
    this.lastTs = ts;
    const res: PoseLandmarkerResult = this.landmarker.detectForVideo(image, ts);
    const poses = res.landmarks.map((lms) =>
      lms.map((l) => ({ x: l.x, y: l.y, z: l.z, v: l.visibility ?? 1 })),
    );
    let mask: Uint8Array | null = null;
    let maskW = 0, maskH = 0;
    if (res.segmentationMasks && res.segmentationMasks.length) {
      for (const m of res.segmentationMasks) {
        const f = m.getAsFloat32Array();
        if (!mask) { maskW = m.width; maskH = m.height; mask = new Uint8Array(f.length); }
        for (let i = 0; i < f.length; i++) {
          const v = f[i] * 255;
          if (v > mask[i]) mask[i] = v;
        }
        m.close();
      }
    }
    return { poses, mask, maskW, maskH };
  }
}
