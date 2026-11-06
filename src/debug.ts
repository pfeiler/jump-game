/** Optional debug overlay (toggle with B / F2 or ?debug=1): landmarks, hip curve, state, timings. */
import { POSE_EDGES } from './input/camera';
import type { InputManager } from './input/inputManager';

export class DebugOverlay {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  enabled = false;
  extra: () => string[] = () => [];

  constructor(private input: InputManager, private rect: () => { x: number; y: number; w: number; h: number; camW: number; camH: number; camX: number; camY: number }) {
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '10' });
    document.body.appendChild(this.canvas);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(fps: number): void {
    if (!this.enabled) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(window.innerWidth * dpr), ch = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const r = this.rect();
    const cam = this.input.camera;
    // landmarks (mirrored) on top of the camera layer
    if (cam && cam.latest) {
      const lm = this.input.tracked.landmarks;
      if (lm) {
        const P = (k: number) => [r.camX + (1 - lm[k].x) * r.camW, r.camY + lm[k].y * r.camH];
        c.strokeStyle = '#3fd0ff';
        c.lineWidth = 3;
        for (const [a, b] of POSE_EDGES) {
          const [x1, y1] = P(a), [x2, y2] = P(b);
          c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        }
        c.fillStyle = '#fff';
        for (let k = 0; k < lm.length; k++) { const [x, y] = P(k); c.fillRect(x - 2, y - 2, 4, 4); }
        // hip centre + baseline
        const det = this.input.tracked.detector;
        const hx = r.camX + (1 - (lm[23].x + lm[24].x) / 2) * r.camW;
        const hy = r.camY + ((lm[23].y + lm[24].y) / 2) * r.camH;
        c.fillStyle = '#ff3b5c';
        c.beginPath(); c.arc(hx, hy, 8, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#7dffa8';
        c.setLineDash([8, 6]);
        const by = r.camY + det.baselineY * r.camH;
        c.beginPath(); c.moveTo(hx - 80, by); c.lineTo(hx + 80, by); c.stroke();
        const ey = r.camY + (det.baselineY - det.airborneEff * det.scale) * r.camH;
        c.strokeStyle = '#ffe66b';
        c.beginPath(); c.moveTo(hx - 80, ey); c.lineTo(hx + 80, ey); c.stroke();
        c.setLineDash([]);
      }
    }

    // hip curve graph
    const gx = 10, gw = 420, gh = 140;
    const gy = window.innerHeight - 10 - gh;
    {
      const tp = this.input.tracked;
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(gx, gy, gw, gh);
      const det = tp.detector;
      const Y = (v: number) => gy + gh - 20 - (v + 0.3) * ((gh - 30) / 1.8);
      for (const [v, col] of [[0, '#888'], [det.edgeEff, '#7dffa8'], [det.airborneEff, '#ffe66b']] as [number, string][]) {
        c.strokeStyle = col; c.beginPath(); c.moveTo(gx, Y(v)); c.lineTo(gx + gw, Y(v)); c.stroke();
      }
      const h = tp.history;
      if (h.length > 1) {
        const t1 = h[h.length - 1].t;
        c.strokeStyle = '#3fd0ff'; c.lineWidth = 2; c.beginPath();
        h.forEach((s, k) => { const x = gx + gw - (t1 - s.t) * (gw / 6); const y = Y(Math.max(-0.3, Math.min(1.5, s.rise))); if (k) c.lineTo(x, y); else c.moveTo(x, y); });
        c.stroke();
      }
      c.fillStyle = '#fff'; c.font = '13px monospace';
      c.fillText(`${det.state}  rise=${det.rise.toFixed(2)} v=${det.velocity.toFixed(2)} scale=${det.scale.toFixed(3)} x=${tp.x.toFixed(2)} σ=${det.noise.toFixed(3)} n=${det.stats.landings} ${tp.visible ? '' : '(nicht sichtbar)'}`, gx + 6, gy + 14);
    }

    // stats
    const lines = [
      `FPS ${fps.toFixed(0)}`,
      cam ? `Kamera: ${cam.status.state} · ${cam.status.mode} · ${cam.status.delegate} · Segmentierung ${cam.status.segmentation ? 'an' : 'aus'}` : 'Kamera: aus (Tastatur)',
      cam ? `Pose ${cam.fps.toFixed(0)} Hz · Inferenz ${cam.inferMs.toFixed(1)} ms · Latenz Frame→Ergebnis ${cam.latencyMs.toFixed(0)} ms` : '',
      ...this.extra(),
    ].filter(Boolean);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(window.innerWidth - 560, 10, 550, 18 * lines.length + 10);
    c.fillStyle = '#7dffa8'; c.font = '14px monospace';
    lines.forEach((l, k) => c.fillText(l, window.innerWidth - 552, 28 + k * 18));
  }
}
