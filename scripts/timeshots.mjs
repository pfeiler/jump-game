// Screenshots + checks: short TNT smoke and the time-block (+5 s) animation (keyboard mode, ?nocam=1).
// Usage: node scripts/timeshots.mjs  (needs `npm run build && npx vite preview --port 4173`)
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/jump-game/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__jump.scene.game.state);
await page.goto(URL + '?nocam=1&time=120');
await wait(1200);
await page.keyboard.press('Enter'); await wait(1000);
await page.keyboard.press('Enter'); await wait(800);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__jump.scene?.name === 'game' && window.__jump.scene.game.state, null, { timeout: 15000 });
await wait(1800);
const place = (kind, col) => page.evaluate(([kind, col]) => {
  const g = window.__jump.scene.game, grid = g.grid;
  const r = grid.topRow(col);
  grid.cells[r][col] = { kind, hp: 1, maxHp: 1 };
  g.buildCells(false);
  return r;
}, [kind, col]);
// sample the number of live vfx objects (smoke puffs etc.) in-page, in real time
const sampleVfx = (ms) => page.evaluate((ms) => new Promise((res) => {
  const t0 = performance.now(), out = [];
  const f = () => { const t = performance.now() - t0; const g = window.__jump.scene.game; out.push([Math.round(t), g.state.vfx.active, g.t]); if (t < ms) requestAnimationFrame(f); else res(out); };
  f();
}), ms);
const shot = (ms, path) => wait(ms).then(() => page.screenshot({ path }));

{
  // ---- TNT ----
  const col = (await state()).col;
  await place('bomb', col);
  const samp = sampleVfx(2200);
  await page.keyboard.press('Space');
  await shot(150, '/tmp/smoke-a.png');
  await shot(200, 'shots/21-tnt-smoke-short.png');
  await shot(250, '/tmp/smoke-c.png');
  await shot(350, '/tmp/smoke-d.png');
  const s = await samp;
  const g0 = s[0][2];
  const firstActive = s.find(([, a]) => a > 0), lastActive = s.filter(([, a]) => a > 0).pop();
  console.log('TNT vfx active (game time s:count):', s.filter((_, i) => i % 4 === 0).map(([, a, gt]) => `${(gt - g0).toFixed(2)}:${a}`).join(' '));
  console.log(`TNT effects all gone ${(lastActive[2] - firstActive[2]).toFixed(2)} s game time after the blast (${lastActive[0] - firstActive[0]} ms real, headless fps ${(s.length / (s[s.length - 1][0] / 1000)).toFixed(0)})`);
  await wait(800);
}

// ---- time block ----
const col = (await state()).col;
const before = await state();
await place('clock', col);
const t0 = (await state()).timeLeft;
await page.keyboard.press('Space');
await shot(230, '/tmp/time-a.png');
await shot(260, 'shots/22-time-block.png');
await shot(200, '/tmp/time-c.png');
const st = await state();
console.log(`time: before ${t0.toFixed(2)} after ${st.timeLeft.toFixed(2)} (Δ ${(st.timeLeft - t0).toFixed(2)} incl. ~0.7 s elapsed), clocks ${st.clocks}, timeBonus ${st.timeBonus}`);
await wait(800);
// ---- pause: clock + exit in the same moment → timer frozen with the bonus included ----
await page.evaluate(() => { const g = window.__jump.scene.game; const c = g.state.col; const r = g.grid.topRow(c); g.grid.cells[r][c] = { kind: 'clock', hp: 1, maxHp: 1 }; g.buildCells(false); });
const sA = await state(), tA = sA.timeLeft;
await page.keyboard.press('Space');
await page.waitForFunction((n) => window.__jump.scene.game.state.clocks > n, sA.clocks, { timeout: 3000 });
await page.evaluate(() => { const g = window.__jump.scene.game; g.onExit(g.grid.exitCol, 3); });
await page.waitForFunction(() => window.__jump.scene.game.state.paused, null, { timeout: 5000 });
const p1 = await state();
await wait(1500);
const p2 = await state();
console.log(`pause: timer frozen ${Math.abs(p2.timeLeft - p1.timeLeft) < 0.01} (${p1.timeLeft.toFixed(2)} → ${p2.timeLeft.toFixed(2)}), bonus credited: ${(p1.timeLeft - tA).toFixed(2)} s, clocks ${p2.clocks}`);
await page.keyboard.press('Space');
await wait(1500);
console.log('after pause', JSON.stringify(await state()));
console.log('before', before.timeLeft.toFixed(1));
await browser.close();
