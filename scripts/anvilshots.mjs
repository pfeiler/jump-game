// Screenshots + checks: Wucht-Amboss, Feder-Block (Boing-Turbo) and the new gem art (keyboard mode, ?nocam=1).
// Usage: node scripts/anvilshots.mjs  (needs `npm run build && npx vite preview --port 4173`)
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/jump-game/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(scale = 1) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  await page.goto(URL + '?nocam=1&time=120');
  await page.waitForTimeout(1200);
  for (const ms of [1000, 800, 0]) { await page.keyboard.press('Enter'); await page.waitForTimeout(ms); }
  await page.waitForFunction(() => window.__jump.scene?.name === 'game' && window.__jump.scene.game.state, null, { timeout: 15000 });
  await page.waitForTimeout(1800);
  return page;
}
const page = await open();
const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__jump.scene.game.state);
const texts = () => page.evaluate(() => [...window.__jump.scene.game.fxLayer.children, ...window.__jump.scene.game.hud.children].map((c) => c.text).filter(Boolean));
const place = (kind) => page.evaluate((kind) => {
  const g = window.__jump.scene.game, grid = g.grid, col = g.state.col;
  let r = grid.topRow(col);
  while (r < grid.viewTop + 2) { grid.cells[r][col] = null; r++; }
  grid.cells[r][col] = { kind, hp: kind === 'anvil' ? 1 : 1, maxHp: 1 };
  for (let k = 1; k <= 4; k++) if (grid.cells[r + k] && grid.cells[r + k][col]?.kind !== 'exit') grid.cells[r + k][col] = { kind: 'dirt', hp: 1, maxHp: 1 };
  g.buildCells(false);
  return { col, row: r };
}, kind);

// ---- anvil: normal landing bounces off, high jump smashes it ----
const a = await place('anvil');
await page.keyboard.press('Space');
await wait(150);
const afterClank = await page.evaluate(({ col, row }) => window.__jump.scene.game.grid.cells[row][col]?.kind, a);
console.log('normal landing on anvil →', afterClank, '| texts:', JSON.stringify(await texts()));
await page.screenshot({ path: '/tmp/anvil-clank.png' });
await wait(700);
await page.keyboard.down('Shift'); await page.keyboard.press('Space'); await page.keyboard.up('Shift');
await wait(200);
await page.screenshot({ path: '/tmp/anvil-fall.png' });
await wait(120);
await page.screenshot({ path: 'shots/25-anvil.png' });
const afterSmash = await page.evaluate(({ col, row }) => { const gr = window.__jump.scene.game.grid; return [0, 1, 2, 3, 4, 5].map((k) => gr.cells[row + k]?.[col]?.kind ?? null); }, a);
console.log('after high jump, column from anvil row:', JSON.stringify(afterSmash));
await wait(1200);

// ---- spring: turbo ----
const s = await place('spring');
await page.keyboard.press('Space');
await wait(250);
await page.screenshot({ path: '/tmp/spring-banner.png' });
let st = await state();
console.log('turbo left:', st.turboLeft.toFixed(2));
await wait(500);
const top0 = await page.evaluate(() => { const g = window.__jump.scene.game; return g.grid.topRow(g.state.col); });
await page.keyboard.press('Space');
await wait(180);
await page.screenshot({ path: 'shots/26-spring-turbo.png' });
const top1 = await page.evaluate(() => { const g = window.__jump.scene.game; return g.grid.topRow(g.state.col); });
console.log(`turbo landing: top row ${top0} → ${top1} (expect +2 for dirt)`, JSON.stringify(await texts()));

// ---- turbo freezes during the level pause ----
st = await state();
await page.evaluate(() => { const g = window.__jump.scene.game; g.onExit(g.grid.exitCol, 3); });
await page.waitForFunction(() => window.__jump.scene.game.state.paused, null, { timeout: 5000 });
const p0 = (await state()).turboLeft;
await wait(2500);
const p1 = (await state()).turboLeft;
console.log(`pause: turbo left ${p0.toFixed(2)} → ${p1.toFixed(2)} after 2.5 s (frozen: ${Math.abs(p1 - p0) < 0.05})`);
await page.keyboard.press('Space');
await page.waitForFunction(() => !window.__jump.scene.game.state.paused, null, { timeout: 8000 }).catch(() => console.log('pause did not end'));
const after = (await state()).turboLeft;
console.log(`after pause: turbo left ${after.toFixed(2)} (≈ ${p1.toFixed(2)})`);
await wait(Math.max(0, after * 1000 + 600));
console.log('after expiry: turbo left', (await state()).turboLeft.toFixed(2));
await page.close();

// ---- gem art close-up (2× pixel ratio) ----
const pg = await open(2);
await pg.evaluate(() => {
  const g = window.__jump.scene.game, grid = g.grid, top = grid.viewTop;
  const vals = [10, 20, 35, 60];
  for (let r = top + 1; r <= top + 2; r++) for (let c = 0; c < 6; c++) {
    const t = (c + (r - top - 1) * 2) % 4;
    grid.cells[r][c] = { kind: 'gem', hp: 1, maxHp: 1, gemType: t, gemValue: vals[t] };
  }
  g.buildCells(false);
});
await pg.waitForTimeout(900);
const y = 122 + 74; // GY + 1 row
await pg.screenshot({ path: 'shots/27-gems.png', clip: { x: 310, y, width: 660, height: 148 } });
await pg.screenshot({ path: '/tmp/gems-full.png' });
await browser.close();
