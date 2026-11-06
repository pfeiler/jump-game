import { Application, Container, Graphics, Sprite, Texture, FillGradient } from 'pixi.js';
import './style.css';
import './games';
import { W, H, type GameDefinition, type GameResult } from './games/types';
import { InputManager } from './input/inputManager';
import { sensitivityConfig } from './input/jumpDetector';
import { hasJumpCalib, loadJumpCalib, resolveJumpTuning, type JumpTuning } from './core/jumpCalib';
import { CameraTracker } from './input/camera';
import { Sfx } from './core/audio';
import { initPhysics } from './core/particles';
import { DebugOverlay } from './debug';
import type { Scene } from './scenes/types';
import { StartScene } from './scenes/StartScene';
import { MenuScene } from './scenes/MenuScene';
import { CalibrationScene } from './scenes/CalibrationScene';
import { JumpCalibScene } from './scenes/JumpCalibScene';
import { GameScene } from './scenes/GameScene';
import { EndScene } from './scenes/EndScene';

const params = new URLSearchParams(location.search);
const initialTuning = resolveJumpTuning(params, loadJumpCalib());
const BASE = import.meta.env.BASE_URL;
const abs = (p: string) => new URL(BASE + p, location.href).href;

class App {
  pixi = new Application();
  stage = new Container();
  camSprite: Sprite | null = null;
  sceneLayer = new Container();
  scene: Scene | null = null;
  input = new InputManager({ ...sensitivityConfig(initialTuning.sens), highFlightTime: initialTuning.high });
  jumpTuning: JumpTuning = initialTuning;
  sfx = new Sfx();
  camera: CameraTracker | null = null;
  players: 1 | 2 = params.get('players') === '2' ? 2 : 1;
  debug!: DebugOverlay;
  private shakeAmt = 0;
  private camVersion = -1;
  private fps = 60;
  private cameraMsg = '';
  cameraFailed = false;

  async init(): Promise<void> {
    await this.pixi.init({
      resizeTo: window,
      background: 0x120a22,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      preference: 'webgl',
    });
    document.getElementById('app')!.appendChild(this.pixi.canvas);
    await initPhysics();

    const grad = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: 0x2b1b4f }, { offset: 1, color: 0x0d0618 }] });
    const bg = new Graphics().rect(0, 0, W, H).fill(grad);
    // a few "cave crystals" in the background
    for (let i = 0; i < 40; i++) bg.circle(Math.random() * W, Math.random() * H, 1 + Math.random() * 2.5).fill({ color: 0xffffff, alpha: 0.15 + Math.random() * 0.3 });
    this.stage.addChild(bg, this.sceneLayer);
    this.pixi.stage.addChild(this.stage);

    this.input.setPlayers(this.players);
    this.debug = new DebugOverlay(this.input, () => this.layoutRect());
    this.debug.extra = () => [`Szene: ${this.scene?.name ?? '-'} · Spieler: ${this.players}`];
    if (params.get('debug') === '1') this.debug.toggle();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F2' || (e.code === 'KeyB' && !this.input.textMode)) this.debug.toggle();
      if (e.code === 'KeyM' && !this.input.textMode) this.sfx.muted = !this.sfx.muted;
    });
    window.addEventListener('pointerdown', () => this.sfx.unlock());
    window.addEventListener('keydown', () => this.sfx.unlock());

    this.pixi.ticker.add((tk) => this.tick(tk.deltaMS / 1000));
    this.setScene(new StartScene(() => this.onStart(), () => this.onCalibrateFromStart(), this.input, () => this.startInfo()));
    (window as unknown as { __jump: unknown }).__jump = this;
    // getUserMedia needs no user gesture (only audio does) → start the camera right away,
    // so the start screen already shows the live image and tracking keeps running afterwards.
    void this.startCamera();
  }

  /** where the 1280×720 stage and the camera image are on screen (CSS px) */
  layoutRect() {
    const s = this.stage.scale.x;
    const x = this.stage.x, y = this.stage.y, w = W * s, h = H * s;
    const sp = this.camSprite;
    if (!sp) return { x, y, w, h, camX: x, camY: y, camW: w, camH: h };
    return { x, y, w, h, camX: x + sp.x * s, camY: y + sp.y * s, camW: sp.width * s, camH: sp.height * s };
  }

  private onStart(): void {
    this.sfx.unlock();
    if (this.shouldAutoJumpCalib()) this.goJumpCalib(() => this.goMenu());
    else this.goMenu();
  }

  /** First camera visit without a saved or URL sensitivity: measure hops before the menu. */
  private shouldAutoJumpCalib(): boolean {
    if (params.has('sens')) return false;
    if (params.get('nocam') === '1' || this.cameraFailed) return false;
    return !hasJumpCalib();
  }

  private onCalibrateFromStart(): void {
    this.sfx.unlock();
    this.goJumpCalib(() => this.goMenu());
  }

  goJumpCalib(after: () => void): void {
    this.setScene(new JumpCalibScene(this.input, this.sfx, this.players, this.jumpTuning, (saved) => {
      if (saved) this.jumpTuning = saved;
      after();
    }));
  }

  /** info for the start screen: camera state + where the camera image is on the stage */
  startInfo() {
    const c = this.camera;
    const state: 'off' | 'starting' | 'running' | 'error' = this.cameraFailed ? 'error' : this.camSprite && c ? 'running' : c ? 'starting' : 'off';
    return {
      state,
      message: state === 'starting' ? (c?.status.message || this.cameraMsg) : this.cameraMsg,
      players: this.players,
      cam: this.camSprite ? { x: this.camSprite.x, y: this.camSprite.y, w: this.camSprite.width, h: this.camSprite.height } : null,
    };
  }

  private async startCamera(): Promise<void> {
    if (params.get('nocam') === '1') { this.cameraMsg = 'Kamera aus (?nocam=1) – Tastatur-Modus'; return; }
    const model = params.get('model') === 'lite' ? 'lite' : 'full';
    const cam = new CameraTracker({
      modelUrl: abs(`models/pose_landmarker_${model}.task`),
      wasmBase: abs('mediapipe/wasm'),
      segmentation: params.get('seg') !== '0',
      useWorker: params.get('worker') !== '0',
      delegate: params.get('delegate')?.toLowerCase() === 'cpu' ? 'CPU' : undefined,
    });
    this.camera = cam;
    this.input.attachCamera(cam);
    this.cameraMsg = 'Kamera wird gestartet … (bitte Zugriff erlauben)';
    try {
      await cam.start(this.players);
      const tex = Texture.from(cam.canvas);
      const sp = new Sprite(tex);
      // cover-fit the 1280×720 stage
      const scale = Math.max(W / cam.canvas.width, H / cam.canvas.height);
      sp.scale.set(scale);
      sp.position.set((W - cam.canvas.width * scale) / 2, (H - cam.canvas.height * scale) / 2);
      sp.alpha = 0;
      this.camSprite = sp;
      this.stage.addChildAt(sp, 1);
      this.cameraMsg = '';
    } catch (e) {
      console.warn('[camera]', e);
      cam.stop();
      this.camera = null;
      this.input.camera = null;
      const err = e as Error;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      const none = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
      this.cameraMsg = denied ? 'Kamera nicht erlaubt – kein Problem, du kannst mit der Tastatur spielen!'
        : none ? 'Keine Kamera gefunden – kein Problem, du kannst mit der Tastatur spielen!'
        : `Kamera geht gerade nicht (${err?.message ?? e}) – spiel einfach mit der Tastatur!`;
      this.cameraFailed = true;
    }
  }

  cameraStatus(): string {
    if (this.cameraMsg) return this.cameraMsg;
    const c = this.camera;
    if (!c) return 'Tastatur-Modus';
    const s = c.status;
    const who = this.input.tracked.slice(0, this.players).map((p, i) => `Spieler ${i + 1}: ${p.visible ? 'erkannt ✓' : 'nicht im Bild'}`).join(' · ');
    return `Kamera aktiv (${s.mode === 'worker' ? 'Web Worker' : 'Hauptthread'}, ${s.delegate}${s.segmentation ? ', Ausschnitt' : ''}) · ${who}`;
  }

  setScene(s: Scene): void {
    this.scene?.destroy();
    this.scene = s;
    this.sceneLayer.addChild(s.container);
  }

  setPlayers(n: 1 | 2): void {
    this.players = n;
    this.input.setPlayers(n);
  }

  goMenu(): void {
    this.setScene(new MenuScene(this.input, this.sfx, () => this.players, (n) => this.setPlayers(n), (def) => this.calibrate(def), () => this.cameraStatus()));
  }

  calibrate(def: GameDefinition): void {
    this.setScene(new CalibrationScene(this.input, this.sfx, this.players, () => this.play(def), () => this.goJumpCalib(() => this.calibrate(def))));
  }

  play(def: GameDefinition): void {
    this.setScene(new GameScene(def, this.input, this.sfx, this.players, (a) => this.shake(a), (r) => this.endGame(def, r)));
  }

  endGame(def: GameDefinition, r: GameResult): void {
    this.setScene(new EndScene(def.id, r, this.players, this.input, this.sfx, () => this.goMenu()));
  }

  shake(a: number): void {
    this.shakeAmt = Math.min(30, Math.max(this.shakeAmt, a));
  }

  private tick(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    // fit 1280×720 into the window
    const sw = this.pixi.screen.width, sh = this.pixi.screen.height;
    const s = Math.min(sw / W, sh / H);
    this.stage.scale.set(s);
    const ox = (sw - W * s) / 2, oy = (sh - H * s) / 2;
    if (this.shakeAmt > 0.3) {
      this.stage.position.set(ox + (Math.random() - 0.5) * this.shakeAmt * s, oy + (Math.random() - 0.5) * this.shakeAmt * s);
      this.shakeAmt *= Math.pow(0.002, dt);
    } else {
      this.shakeAmt = 0;
      this.stage.position.set(ox, oy);
    }
    // camera layer
    if (this.camSprite && this.camera) {
      if (this.camera.frameVersion !== this.camVersion) {
        this.camVersion = this.camera.frameVersion;
        this.camSprite.texture.source.update();
      }
      let want = this.scene?.cameraAlpha ?? 0;
      if (!this.camera.status.segmentation) want = this.scene?.rawCameraAlpha ?? want * 0.4; // raw video: keep it subtle
      this.camSprite.alpha += (want - this.camSprite.alpha) * Math.min(1, dt * 4);
    }
    const sc = this.scene;
    try {
      sc?.update(dt, performance.now() / 1000);
    } catch (e) {
      if (sc === this.scene) console.error('[scene]', e);
    }
    this.debug.draw(this.fps);
  }
}

new App().init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#fff;padding:20px">Fehler beim Starten: ${String(e)}</pre>`);
});
