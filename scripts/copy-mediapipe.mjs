// Copies the MediaPipe Tasks Vision wasm runtime from node_modules into public/
// so the app self-hosts everything (no third-party CDN at runtime).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const src = resolve('node_modules/@mediapipe/tasks-vision/wasm');
const dst = resolve('public/mediapipe/wasm');
if (!existsSync(src)) { console.error('tasks-vision not installed'); process.exit(1); }
mkdirSync(dst, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
  cpSync(`${src}/${f}`, `${dst}/${f}`);
}
console.log('MediaPipe wasm copied to public/mediapipe/wasm');
