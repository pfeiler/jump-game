// Start screen with fake camera: camera must start on page load (no gesture) and keep running into the menu.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/jump-game/';
const Y4M = process.env.Y4M ?? '/tmp/fake/jump2.y4m';
const QS = process.env.QS ?? '&model=lite&delegate=cpu';
const OUT = process.env.OUT ?? 'shots/17-start-camera.png';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${Y4M}`],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera'] });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__gum = 0;
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; return orig(c); };
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(URL + '?' + QS.replace(/^&/, ''));
const t0 = Date.now();
await page.waitForFunction(() => window.__jump?.camSprite && window.__jump.scene?.name === 'start', null, { timeout: 90000 });
console.log('camera running on start screen after', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => window.__jump.camera.status)));
await page.waitForFunction(() => window.__jump.scene.readiness?.ok, null, { timeout: 20000 }).catch(() => console.log('not ok within 20s'));
await page.waitForTimeout(400);
console.log('readiness', JSON.stringify(await page.evaluate(() => window.__jump.scene.readiness)));
await page.screenshot({ path: OUT });
const before = await page.evaluate(() => ({ cam: window.__jump.camera.frameVersion, gum: window.__gum }));
await page.keyboard.press('Space');
await page.waitForTimeout(3000);
const after = await page.evaluate(() => ({ scene: window.__jump.scene.name, cam: window.__jump.camera.frameVersion, gum: window.__gum, status: window.__jump.camera.status.state, msg: window.__jump.cameraStatus() }));
console.log('before', JSON.stringify(before), 'after', JSON.stringify(after));
await browser.close();
