// End-to-end camera test with Chrome's fake webcam fed from a y4m file
// (a photo of a person moved up/down along jump parabolas).
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/jump-game/';
const Y4M = process.env.Y4M ?? '/tmp/fake/jump2.y4m';
const QS = process.env.QS ?? '';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera'] });
const page = await ctx.newPage();
const t0 = Date.now();
page.on('console', (m) => { const s = m.text(); if (!/Deprecat|groupEnd|^\s+at /.test(s)) console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s [${m.type()}] ${s.slice(0, 300)}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(URL + '?time=40&debug=1' + QS);
await page.waitForTimeout(1000);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__jump.camera?.status.state === 'running' || window.__jump.cameraMsg.startsWith('Keine'), null, { timeout: 90000 });
await page.waitForTimeout(10);
const status = await page.evaluate(() => ({ s: window.__jump.camera?.status, msg: window.__jump.cameraMsg }));
console.log('camera status', JSON.stringify(status));
const landings = [];
await page.exposeFunction('reportLanding', (l) => landings.push(l));
await page.evaluate(() => {
  const tp = window.__jump.input.tracked[0];
  const orig = tp.feed.bind(tp);
  tp.feed = (t, hip, lms) => { const before = tp.pending.length; orig(t, hip, lms); for (const l of tp.pending.slice(before)) window.reportLanding({ at: +(performance.now() / 1000).toFixed(2), T: l.flightTime, h: l.height, high: l.high }); };
});
const shotAt = { 2: '11-camera-menu-debug', 6: '12-camera-calibration', 11: '13-camera-gameplay-debug', 18: '15-camera-gameplay-high' };
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(2000);
  if (shotAt[i]) await page.screenshot({ path: `shots/${shotAt[i]}.png` });
  const st = await page.evaluate(() => ({ scene: window.__jump.scene?.name, cam: { fps: window.__jump.camera?.fps, infer: window.__jump.camera?.inferMs, lat: window.__jump.camera?.latencyMs }, det: { state: window.__jump.input.tracked[0].detector.state, cal: window.__jump.input.tracked[0].detector.isCalibrated, vis: window.__jump.input.tracked[0].visible }, game: window.__jump.scene?.game?.state }));
  console.log('t+', (i + 1) * 2, JSON.stringify(st));
  if (i === 13) { await page.keyboard.press('KeyB'); await page.waitForTimeout(100); await page.screenshot({ path: 'shots/14-camera-gameplay.png' }); }
}
console.log('landings', JSON.stringify(landings));
await browser.close();
