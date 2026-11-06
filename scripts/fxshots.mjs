// Screenshots of the big power-up effects + the level pause (keyboard mode, ?nocam=1).
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/jump-game/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(URL + '?nocam=1&time=120');
await wait(1200);
await page.keyboard.press('Enter'); // start → menu
await wait(1000);
await page.keyboard.press('Enter'); // Mine Time
await wait(800);
await page.keyboard.press('Enter'); // skip calibration
await page.waitForFunction(() => window.__jump.scene?.name === 'game' && window.__jump.scene.game.state, null, { timeout: 15000 });
await wait(1500);
// place blocks at the top of a column through the (test-only) runtime objects
const place = (kind, col, extraBombs = false) => page.evaluate(([kind, col, extraBombs]) => {
  const g = window.__jump.scene.game;
  const grid = g.grid;
  const r = grid.topRow(col);
  const mk = (k) => ({ kind: k, hp: 1, maxHp: 1 });
  grid.cells[r][col] = mk(kind);
  if (extraBombs) { if (grid.cells[r + 1]) grid.cells[r + 1][col] = mk('bomb'); if (col + 1 < 6) grid.cells[r + 1][col + 1] = mk('bomb'); }
  g.buildCells(false);
  return r;
}, [kind, col, extraBombs]);
const col = await page.evaluate(() => window.__jump.scene.game.state.col);
await place('bomb', col, true);
await page.keyboard.press('Space');
for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) { await wait(60); await page.screenshot({ path: `/tmp/fx-tnt-${n}.png` }); }
console.log('after TNT', JSON.stringify(await page.evaluate(() => window.__jump.scene.game.state)));
await wait(2500);
const col2 = await page.evaluate(() => window.__jump.scene.game.state.col);
await place('drill', col2);
await page.keyboard.press('Space');
for (const [ms, n] of [[40, 'a'], [120, 'b'], [220, 'c'], [330, 'd']]) { await wait(40); await page.screenshot({ path: `/tmp/fx-drill-${n}.png` }); }
console.log('after drill', JSON.stringify(await page.evaluate(() => window.__jump.scene.game.state)));
await wait(2000);
// level pause via the exit
// if a real exit was already reached by the blasts, continue that pause first
if (await page.evaluate(() => window.__jump.scene.game.state.paused)) { await wait(800); await page.keyboard.press('Enter'); await wait(1500); }
await page.evaluate(() => { const g = window.__jump.scene.game; g.onExit(g.grid.exitCol, 3); });
await page.waitForFunction(() => window.__jump.scene.game.state.paused, null, { timeout: 5000 });
await page.keyboard.press('Enter'); // too early → must be ignored
await wait(900);
const st1 = await page.evaluate(() => window.__jump.scene.game.state);
console.log('pause shown, early Enter ignored:', st1.paused, 'level', st1.level, 'timeLeft', st1.timeLeft.toFixed(2));
await page.screenshot({ path: 'shots/20-level-pause.png' });
await wait(1500);
const tl = await page.evaluate(() => window.__jump.scene.game.state.timeLeft);
console.log('timer frozen during pause:', Math.abs(tl - st1.timeLeft) < 0.01);
await page.keyboard.press('Space');
await wait(1200);
const st2 = await page.evaluate(() => window.__jump.scene.game.state);
console.log('after Space: paused', st2.paused, 'level', st2.level);
await page.screenshot({ path: '/tmp/fx-after-pause.png' });
await browser.close();
