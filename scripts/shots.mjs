// Headless smoke test + screenshots with keyboard fallback.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/jump-game/';
const out = 'shots';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(URL + '?nocam=1&time=25');
await wait(1500);
await page.screenshot({ path: `${out}/01-start.png` });
await page.keyboard.press('Enter');
await wait(1500);
await page.keyboard.press('ArrowRight'); // move selection
await wait(300);
await page.keyboard.press('ArrowLeft');
await wait(500);
await page.screenshot({ path: `${out}/02-menu.png` });
await page.keyboard.press('KeyB'); // debug overlay on
await page.keyboard.press('Space'); // "jump" on Mine Time tile
await wait(1500);
await page.screenshot({ path: `${out}/03-calibration-debug.png` });
await wait(2500);
await page.keyboard.press('KeyB'); // debug off for gameplay
const keys = ['ArrowLeft', 'ArrowLeft', 'ArrowRight'];
for (let i = 0; i < 40; i++) {
  if (i % 5 === 0) await page.keyboard.press(keys[i % 3]);
  if (i % 4 === 3) await page.keyboard.press('Shift+Space');
  else await page.keyboard.press('Space');
  await wait(260);
  if (i === 22) await page.screenshot({ path: `${out}/04-gameplay.png` });
}
await page.screenshot({ path: `${out}/05-gameplay-later.png` });
const st = await page.evaluate(() => window.__jump.scene?.game?.state);
console.log('game state', JSON.stringify(st));
await page.keyboard.press('KeyB');
await wait(300);
await page.screenshot({ path: `${out}/06-gameplay-debug.png` });
await page.keyboard.press('KeyB');
// wait for the end screen (a level pause waits for arms-up / Enter → continue it)
for (let i = 0; i < 240 && (await page.evaluate(() => window.__jump.scene?.name)) !== 'end'; i++) {
  if (await page.evaluate(() => !!window.__jump.scene?.game?.state?.paused)) await page.keyboard.press('Enter');
  await wait(500);
}
await wait(800);
await page.keyboard.type('Leo');
await wait(300);
await page.screenshot({ path: `${out}/07-end-name.png` });
await page.keyboard.press('Enter');
await wait(600);
await page.screenshot({ path: `${out}/08-end-highscores.png` });
const hs = await page.evaluate(() => localStorage.getItem('jumpgame.highscores.minetime'));
console.log('highscores', hs);
await page.keyboard.press('Enter');
await wait(800);
console.log('scene after end', await page.evaluate(() => window.__jump.scene?.name));
console.log(logs.filter((l) => !l.includes('[debug]')).join('\n'));
await browser.close();
