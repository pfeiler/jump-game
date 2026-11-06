// Arms-up continue with a real pose model on a fake camera video (test-only; video not in repo).
// Y4M = looping test video (A: arms out, B: arms up while hopping, C: arms up standing). MAXT = seconds to watch the pause.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/jump-game/';
const Y4M = process.env.Y4M ?? '/tmp/fake/armsup.y4m';
const QS = process.env.QS ?? 'model=lite&delegate=cpu&time=180';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(URL + '?' + QS);
await page.waitForFunction(() => window.__jump?.camSprite && window.__jump.camera?.status?.state === 'running', null, { timeout: 90000 });
const tCam = Date.now();
const vt = () => ((Date.now() - tCam) / 1000).toFixed(1);
await page.waitForTimeout(800);
for (let i = 0; i < 12; i++) {
  const sc = await page.evaluate(() => window.__jump.scene?.name);
  if (sc === 'game' && await page.evaluate(() => !!window.__jump.scene.game?.state)) break;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  console.log('scene', sc);
}
await page.waitForFunction(() => window.__jump.scene?.name === 'game' && window.__jump.scene.game?.state, null, { timeout: 30000 });
await page.waitForTimeout(1000);
await page.evaluate(() => { const g = window.__jump.scene.game; g.onExit(g.grid.exitCol, 3); });
await page.waitForFunction(() => window.__jump.scene.game.state.paused, null, { timeout: 8000 });
console.log(`pause shown at video t≈${vt()} s, camera mode:`, await page.evaluate(() => window.__jump.scene.game.pause?.camera));
let shot = false, last = '';
const MAXT = +(process.env.MAXT ?? 25);
const tP = Date.now();
while ((Date.now() - tP) / 1000 < MAXT) {
  const s = await page.evaluate(() => {
    const g = window.__jump.scene.game;
    const tp = window.__jump.input.tracked;
    const lm = tp?.landmarks;
    const up = lm && lm.length > 16 ? (lm[15].y < lm[11].y && lm[16].y < lm[12].y) : null;
    return { paused: g.state.paused, prog: +g.state.pauseProgress.toFixed(2), vis: tp?.visible, who: window.__jump.input.tracked.indexOf(tp) + 1, up, shY: lm ? +((lm[11].y + lm[12].y) / 2).toFixed(3) : null, hipY: lm ? +((lm[23].y + lm[24].y) / 2).toFixed(3) : null, det: tp?.detector?.state, status: g.pause?.status?.text, level: g.state.level };
  });
  const line = JSON.stringify(s);
  if (line !== last) { console.log(`t≈${vt()}`, line); last = line; }
  if (!shot && s.prog > 0.35) { await page.screenshot({ path: process.env.SHOT ?? '/tmp/pause-cam.png' }); shot = true; }
  if (!s.paused) { console.log(`CONTINUED at video t≈${vt()} s, level ${s.level}`); break; }
  await page.waitForTimeout(200);
}
const fps = await page.evaluate(() => +(window.__jump.camera?.fps ?? 0).toFixed(1)).catch(() => null);
console.log('pose fps', fps, '| still paused at end:', await page.evaluate(() => window.__jump.scene.game?.state?.paused));
await browser.close();
