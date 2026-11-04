// Screenshots + checks: horizontal drill (Quer-Bohrer) and gem point pop-ups (keyboard mode, ?nocam=1).
// Usage: node scripts/drillshots.mjs  (needs `npm run build && npx vite preview --port 4173`)
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
const shot = (ms, path) => wait(ms).then(() => page.screenshot({ path }));

// ---- horizontal drill: put it on top of the player's column, with a gem and stones in the same row ----
const info = await page.evaluate(() => {
  const g = window.__jump.scene.game, grid = g.grid, col = g.state.cols[0];
  // dig the column down to row 3 first so the drilled row is in the middle of the view
  let r = grid.topRow(col);
  while (r < grid.viewTop + 3) { grid.cells[r][col] = null; r++; }
  grid.cells[r][col] = { kind: 'hdrill', hp: 1, maxHp: 1 };
  for (let c = 0; c < 6; c++) if (c !== col && grid.cells[r][c]) grid.cells[r][c] = c % 2 ? { kind: 'stone', hp: 2, maxHp: 2 } : { kind: 'gem', hp: 1, maxHp: 1, gemType: 3, gemValue: 60 };
  g.buildCells(false);
  return { col, row: r, before: grid.cells[r].filter(Boolean).length, bolts: g.state.vfx.bolts, score: grid.score };
});
await page.keyboard.press('Space');
await shot(120, '/tmp/hd-a.png');
await shot(120, 'shots/23-horizontal-drill.png');
await shot(250, '/tmp/hd-c.png');
const after = await page.evaluate((row) => { const g = window.__jump.scene.game; return { left: g.grid.cells[row].filter(Boolean).length, bolts: g.state.vfx.bolts, score: g.grid.score }; }, info.row);
console.log(`hdrill row ${info.row}: blocks before ${info.before} → after ${after.left}, bolts +${after.bolts - info.bolts}, score ${info.score} → ${after.score}`);
await wait(1500);

// ---- gem pop-ups: two gems stacked in the player's column, high jump (Shift+Space) = 2 hits ----
const col = (await state()).cols[0];
await page.evaluate((col) => {
  const g = window.__jump.scene.game, grid = g.grid;
  const r = grid.topRow(col);
  grid.cells[r][col] = { kind: 'gem', hp: 1, maxHp: 1, gemType: 3, gemValue: 60 };
  if (grid.cells[r + 1]) grid.cells[r + 1][col] = { kind: 'gem', hp: 1, maxHp: 1, gemType: 2, gemValue: 35 };
  g.buildCells(false);
}, col);
const countTexts = () => page.evaluate(() => window.__jump.scene.game.fxLayer.children.filter((c) => c.text?.startsWith?.('+')).map((c) => c.text));
await page.keyboard.down('Shift'); await page.keyboard.press('Space'); await page.keyboard.up('Shift');
await shot(180, 'shots/24-gem-points.png');
console.log('pop-ups visible:', JSON.stringify(await countTexts()));
await wait(1000);
console.log('pop-ups after 1.2 s (should be gone):', JSON.stringify(await countTexts()));
// ---- many gems at once (bomb next to 5 gems) → one combined pop-up ----
await page.evaluate(() => {
  const g = window.__jump.scene.game, grid = g.grid, col = g.state.cols[0];
  const r = grid.topRow(col);
  grid.cells[r][col] = { kind: 'bomb', hp: 1, maxHp: 1 };
  for (const [dc, dr] of [[-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) { const c = col + dc; if (c >= 0 && c < 6 && grid.cells[r + dr]) grid.cells[r + dr][c] = { kind: 'gem', hp: 1, maxHp: 1, gemType: 1, gemValue: 20 }; }
  g.buildCells(false);
});
await page.keyboard.press('Space');
await shot(150, '/tmp/gem-combined.png');
console.log('combined pop-ups:', JSON.stringify(await countTexts()));
await browser.close();
