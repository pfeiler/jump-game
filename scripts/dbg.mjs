import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text().slice(0, 500)}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.stack}`));
await page.goto('http://localhost:4173/jump-game/?nocam=1&time=25');
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await page.keyboard.press('Space');
await page.waitForTimeout(5000);
for (let i = 0; i < 40; i++) {
  if (i % 5 === 0) await page.keyboard.press(['ArrowLeft', 'ArrowRight', 'ArrowRight'][i % 3]);
  await page.keyboard.press(i % 4 === 3 ? 'Shift+Space' : 'Space');
  await page.waitForTimeout(260);
  if (i % 5 === 0) console.log(i, JSON.stringify(await page.evaluate(() => [window.__jump.scene?.game?.state, window.__jump.pixi.ticker.started, window.__jump.fps])));
}
await browser.close();
