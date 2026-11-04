/// <reference lib="webworker" />
import { PoseEngine } from './engine';
import type { FromWorker, ToWorker } from './types';

const engine = new PoseEngine();
let ready = false;
const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await engine.init(msg.opts, true);
      ready = true;
      post({ type: 'ready', delegate: engine.delegate });
    } catch (err) {
      post({ type: 'error', message: String((err as Error)?.message ?? err) });
    }
  } else if (msg.type === 'config') {
    if (ready) engine.setNumPoses(msg.numPoses);
  } else if (msg.type === 'frame') {
    if (!ready) { msg.bitmap.close(); return; }
    const t0 = performance.now();
    try {
      const r = engine.detect(msg.bitmap, t0);
      const inferMs = performance.now() - t0;
      post(
        { type: 'result', id: msg.id, captureT: msg.captureT, poses: r.poses, mask: r.mask, maskW: r.maskW, maskH: r.maskH, inferMs },
        r.mask ? [r.mask.buffer] : [],
      );
    } catch (err) {
      post({ type: 'error', message: String((err as Error)?.message ?? err) });
    } finally {
      msg.bitmap.close();
    }
  }
};
