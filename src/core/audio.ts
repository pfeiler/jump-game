/** Synthesised WebAudio sound effects – no audio files needed. */
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;

  /** Must be called from a user gesture (click / key). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get ok(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.2, delay = 0, slideTo?: number): void {
    if (!this.ok) return;
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.3, filterFreq = 1200, delay = 0, type: BiquadFilterType = 'lowpass'): void {
    if (!this.ok) return;
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, filterFreq / 6), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  hit(): void { this.noise(0.12, 0.35, 900); this.tone(140, 0.1, 'sine', 0.3, 0, 60); }
  crack(): void { this.noise(0.08, 0.3, 3000, 0, 'highpass'); }
  breakBlock(hard = false): void {
    this.noise(hard ? 0.35 : 0.22, 0.45, hard ? 1800 : 1200);
    this.tone(hard ? 90 : 120, 0.2, 'triangle', 0.25, 0, 40);
  }
  gem(type = 0): void {
    const base = [880, 988, 1175, 1319][type] ?? 880;
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone(base * m, 0.18, 'sine', 0.16, i * 0.05));
  }
  bomb(): void { this.noise(0.9, 0.8, 700); this.tone(70, 0.6, 'sine', 0.5, 0, 30); }
  power(): void { this.tone(300, 0.35, 'sawtooth', 0.15, 0, 1200); this.tone(600, 0.3, 'square', 0.08, 0.1, 1800); }
  combo(n: number): void { this.tone(400 + Math.min(n, 20) * 40, 0.08, 'square', 0.08); }
  select(): void { this.tone(660, 0.07, 'square', 0.12); }
  confirm(): void { this.tone(523, 0.1, 'square', 0.15); this.tone(784, 0.15, 'square', 0.15, 0.08); }
  tick(): void { this.tone(1000, 0.05, 'square', 0.1); }
  empty(): void { this.tone(200, 0.12, 'triangle', 0.15, 0, 150); }
  level(): void { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, 'square', 0.13, i * 0.09)); }
  start(): void { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.15, 'square', 0.13, i * 0.1)); }
  end(): void { [784, 659, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.18, i * 0.13)); }
}
