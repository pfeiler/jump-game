/**
 * Detection-rate report (not a pass/fail test). Run with:
 *   JUMP_RATES=1 [NZ=0.012] [CAL=1] [CFG='{"airborne":0.08}'] npx vitest run tests/jumpRates.test.ts
 * Prints the share of detected hops per pose rate and hop height, and false jumps per scenario.
 */
import { it } from 'vitest';

declare const process: { env: Record<string, string | undefined>; stderr: { write(s: string): boolean } };
import { JumpDetector, type JumpConfig } from '../src/input/jumpDetector';
import { BASE, SCALE, hopRise, sample } from './helpers/jumpSim';
const P = (s: string) => process.stderr.write(s + '\n');
const cfg: Partial<JumpConfig> = JSON.parse(process.env.CFG ?? '{}');
const NZ = +(process.env.NZ ?? 0.012);
const count = (rise: (t: number) => number, fps: number, dur: number, seed: number, noise = NZ) => {
  const det = new JumpDetector(cfg); det.calibrate(BASE, SCALE, process.env.CAL ? noise * SCALE : undefined);
  let n = 0, high = 0;
  for (const x of sample(rise, { fps, duration: dur, noise, jitter: 0.004, phase: (seed % 10) / 10, seed })) for (const e of det.update(x.t, x.y, SCALE)) if (e.type === 'landing') { n++; if (e.high) high++; }
  return { n, high };
};
it.skipIf(!process.env.JUMP_RATES)('detection-rate report', () => {
  for (const fps of [8, 10, 15, 30]) {
    const row: string[] = [];
    for (const peak of [0.1, 0.12, 0.16, 0.2, 0.3]) {
      let found = 0, total = 0, extra = 0, hi = 0;
      for (let seed = 1; seed <= 20; seed++) for (const flight of [0.2, 0.25, 0.3]) {
        const s = { peak, flight, contact: 0.15 + (seed % 3) * 0.05, dip: 0.04, count: 10 };
        const r = count((t) => hopRise(s, t), fps, 1 + 10 * 0.6 + 1, seed);
        found += Math.min(10, r.n); extra += Math.max(0, r.n - 10); hi += r.high; total += 10;
      }
      row.push(`p${peak}: ${Math.round((100 * found) / total)}%${extra ? ' +' + extra : ''}${hi ? ' H' + hi : ''}`);
    }
    P(`#fps ${fps}: ${row.join(' | ')}`);
  }
  // false positives
  const fp: Record<string, (t: number) => number> = {
    still: () => 0,
    sway: (t) => 0.03 * Math.sin(t * 2 * Math.PI * 0.6),
    swayFast: (t) => 0.04 * Math.sin(t * 2 * Math.PI * 1.5),
    armsUp: (t) => { const p = t % 3; return 0.35 * (p > 1 && p < 2 ? Math.min(1, (p - 1) * 4) * 0.12 : 0); }, // shoulders +0.12 torso, weight 0.35
    tiptoe: (t) => { const p = t % 4; return p < 1 ? 0 : p < 1.6 ? 0.12 * (p - 1) / 0.6 : p < 2.6 ? 0.12 : p < 3.2 ? 0.12 * (3.2 - p) / 0.6 : 0; },
    squat: (t) => { const p = t % 4; return p < 1 ? 0 : p < 1.7 ? -0.5 * (p - 1) / 0.7 : p < 2.5 ? -0.5 : p < 3.0 ? -0.5 * (3.0 - p) / 0.5 : 0; },
    bigNoise: () => 0,
  };
  for (const [name, f] of Object.entries(fp)) {
    const row: string[] = [];
    for (const fps of [8, 10, 15, 30]) {
      let n = 0;
      for (let seed = 1; seed <= 10; seed++) n += count(f, fps, 20, seed, name === 'bigNoise' ? 2 * NZ : NZ).n;
      row.push(`${fps}fps:${n}`);
    }
    P(`#FP ${name} (10×20 s): ${row.join(' ')}`);
  }
});
