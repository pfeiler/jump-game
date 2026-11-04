export interface Landmark { x: number; y: number; z: number; v: number }

export interface PoseOptions {
  /** absolute URL of the folder with vision_wasm_*.js/.wasm */
  wasmBase: string;
  /** absolute URL of the .task model */
  modelUrl: string;
  numPoses: number;
  segmentation: boolean;
  /** force a delegate; default tries GPU first, then CPU */
  delegate?: 'GPU' | 'CPU';
}

export interface PoseResult {
  /** id of the frame (monotonic) */
  id: number;
  /** performance.now() when the frame was captured (main-thread clock) */
  captureT: number;
  poses: Landmark[][];
  /** person mask, 0..255 per pixel (all poses merged), or null */
  mask: Uint8Array | null;
  maskW: number;
  maskH: number;
  inferMs: number;
}

export type ToWorker =
  | { type: 'init'; opts: PoseOptions }
  | { type: 'frame'; id: number; captureT: number; bitmap: ImageBitmap }
  | { type: 'config'; numPoses: number };

export type FromWorker =
  | { type: 'ready'; delegate: string }
  | { type: 'error'; message: string }
  | ({ type: 'result' } & PoseResult);
