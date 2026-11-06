import { Container, Graphics, Text } from 'pixi.js';
import type { Scene } from './types';
import { label } from '../core/fx';
import { W, H } from '../games/types';
import type { InputManager } from '../input/inputManager';
import type { Sfx } from '../core/audio';
import {
  HOP_GOAL, MEASURE_SENS, calibrateFromHops, saveJumpCalib,
  type HopSample, type JumpTuning,
} from '../core/jumpCalib';

const de = (n: number, digits = 1): string =>
  n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

type Phase = 'measure' | 'done' | 'keyboard';

/**
 * Ten normal hops → sensitivity (and, if needed, a slightly higher high-jump bar).
 * Enter skips without saving. The measured value is stored by the caller via onDone.
 */
export class JumpCalibScene implements Scene {
  readonly name = 'jumpcalib';
  container = new Container();
  cameraAlpha = 1;
  private title: Text;
  private msg: Text;
  private detail: Text;
  private ring = new Graphics();
  private count: Text;
  private hint: Text;
  private hops: HopSample[] = [];
  private phase: Phase = 'measure';
  private phaseT = 0;
  private finished = false;
  private saved = false;
  private weak = false;
  private tuning: JumpTuning;

  constructor(
    private input: InputManager,
    private sfx: Sfx,
    private previous: JumpTuning,
    private onDone: (saved: JumpTuning | null) => void,
  ) {
    this.tuning = previous;
    this.title = label('Sprünge messen', 72, 0xffe66b);
    this.title.position.set(W / 2, 86);
    this.msg = label('', 32, 0xffffff, { wordWrap: true, wordWrapWidth: 1000 });
    this.msg.position.set(W / 2, 188);
    this.detail = label('', 28, 0xb6ffcf, { wordWrap: true, wordWrapWidth: 980 });
    this.detail.position.set(W / 2, 620);
    this.ring.position.set(W / 2, 400);
    this.count = label('0', 96, 0xffffff);
    this.count.position.set(W / 2, 400);
    this.hint = label('Enter = überspringen', 22, 0xc8c0e0, { fontWeight: '600' });
    this.hint.position.set(W / 2, H - 36);
    this.container.addChild(this.title, this.msg, this.ring, this.count, this.detail, this.hint);
    // listen wide so small trampoline hops still register, then scale back to what we measured
    this.input.applyJumpTuning(MEASURE_SENS, previous.high);
    this.input.flush();
    input.keyListeners.add(this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Enter' || e.repeat) return;
    if (this.phase === 'done') this.finish(true);
    else this.finish(false);
  };

  private finish(keepSaved: boolean): void {
    if (this.finished) return;
    this.finished = true;
    if (!keepSaved) this.input.applyJumpTuning(this.previous.sens, this.previous.high);
    this.input.flush();
    this.sfx.confirm();
    this.onDone(keepSaved ? this.tuning : null);
  }

  private accept(sample: HopSample): void {
    if (this.phase !== 'measure') return;
    if (sample.peak < 0.05 || sample.flightTime < 0.12) return;
    this.weak = false;
    this.hops.push(sample);
    this.sfx.tick();
    if (this.hops.length < HOP_GOAL) return;
    const result = calibrateFromHops(this.hops, this.previous);
    if (!result.ok) {
      this.hops = [];
      this.weak = true;
      return;
    }
    this.tuning = { sens: result.sens, high: result.high };
    this.input.applyJumpTuning(result.sens, result.high);
    saveJumpCalib({ sens: result.sens, high: result.high, peak: result.peak, flight: result.flight, at: result.at });
    this.saved = true;
    this.phase = 'done';
    this.phaseT = 0;
    this.sfx.confirm();
  }

  update(dt: number): void {
    this.phaseT += dt;
    const cam = this.input.cameraRunning;
    if (!cam && !this.input.camera && this.phase === 'measure') {
      this.phase = 'keyboard';
      this.phaseT = 0;
    }
    if (this.phase === 'measure' && cam) {
      for (const e of this.input.takeCameraLandings()) this.accept(e);
    }

    const n = Math.min(this.hops.length, HOP_GOAL);
    const p = this.phase === 'done' ? 1 : this.phase === 'keyboard' ? 0 : n / HOP_GOAL;
    this.drawRing(p);
    this.count.text = this.phase === 'done' ? '✓' : this.phase === 'keyboard' ? '⌨' : `${n}`;

    if (this.phase === 'keyboard') {
      this.msg.text = 'Mit der Tastatur brauchst du das nicht – Leertaste springt immer.';
      this.detail.text = '';
      this.hint.text = 'Enter = weiter';
      if (this.phaseT > 2.2) this.finish(false);
      return;
    }
    if (this.phase === 'done') {
      this.msg.text = 'Geschafft! Deine Sprünge sind gespeichert.';
      this.detail.text = `Empfindlichkeit ${de(this.tuning.sens, 2)} · Hochsprung ab ${de(this.tuning.high, 2)} s`;
      this.hint.text = 'Enter = weiter';
      if (this.phaseT > 1.6) this.finish(true);
      return;
    }
    this.msg.text = cam
      ? `Hüpf ${HOP_GOAL} Mal normal – so wie nachher im Spiel, nicht extra hoch.`
      : 'Kamera wird gestartet … gleich kannst du hüpfen.';
    this.detail.text = !cam
      ? ''
      : this.weak
        ? 'Das war zu flach. Hüpf etwas höher – wir zählen nochmal von vorn.'
        : n === 0
          ? 'Wir merken uns, wie hoch du normal hüpfst.'
          : `${n} von ${HOP_GOAL}`;
    this.hint.text = 'Enter = überspringen';
  }

  private drawRing(p: number): void {
    const g = this.ring;
    g.clear();
    g.circle(0, 0, 120).fill({ color: 0x140a24, alpha: 0.55 }).stroke({ width: 16, color: 0x3a2a5a });
    if (p > 0) g.arc(0, 0, 120, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p)).stroke({ width: 16, color: 0x7dff8a, cap: 'round' });
  }

  destroy(): void {
    this.input.keyListeners.delete(this.onKey);
    if (!this.finished && !this.saved) this.input.applyJumpTuning(this.previous.sens, this.previous.high);
    this.container.destroy({ children: true });
  }
}
