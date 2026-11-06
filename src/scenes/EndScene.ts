import { Container, Graphics, Text } from 'pixi.js';
import type { Scene } from './types';
import { label, Tweens, easeOutBack } from '../core/fx';
import { W, H, type GameResult } from '../games/types';
import type { InputManager } from '../input/inputManager';
import type { Sfx } from '../core/audio';
import { loadScores, saveScore, MAX_NAME, sanitizeName, isHighscore } from '../core/highscores';

export class EndScene implements Scene {
  readonly name = 'end';
  container = new Container();
  cameraAlpha = 0.6;
  private playerName = '';
  private nameText: Text;
  private prompt: Text;
  private listText: Text;
  private footer: Text;
  private tw = new Tweens();
  private phase: 'entry' | 'list' = 'entry';
  private t = 0;
  private rank = -1;

  constructor(private gameId: string, private result: GameResult, private input: InputManager, private sfx: Sfx, private onMenu: () => void) {
    const panel = new Graphics().roundRect(140, 30, W - 280, H - 60, 36).fill({ color: 0x140a24, alpha: 0.85 }).stroke({ width: 6, color: 0xffe66b });
    const title = label(result.score > 0 ? 'Super gemacht!' : 'Gut gesprungen!', 66, 0xffe66b);
    title.position.set(W / 2, 95);
    const score = label(`${result.score} Punkte`, 80, 0xffffff);
    score.position.set(W / 2, 190);
    score.scale.set(0);
    this.tw.add(0.6, (k) => score.scale.set(easeOutBack(k)));
    const stats = label(result.stats.join('   ·   '), 22, 0xc8c0e0, { fontWeight: '700', wordWrap: true, wordWrapWidth: W - 340 });
    stats.position.set(W / 2, 262);
    this.prompt = label(isHighscore(gameId, result.score) ? 'Neuer Highscore! Wie heißt du? (Vorname oder Initialen)' : 'Wie heißt du? (Vorname oder Initialen)', 30, 0x7dffa8);
    this.prompt.position.set(W / 2, 330);
    const box = new Graphics().roundRect(W / 2 - 230, 365, 460, 76, 18).fill(0xffffff).stroke({ width: 5, color: 0x7dffa8 });
    this.nameText = label('', 48, 0x1a1030, { stroke: { width: 0, color: 0 } });
    this.nameText.position.set(W / 2, 404);
    this.listText = label('', 26, 0xffffff, { align: 'left', fontWeight: '800' });
    this.listText.anchor.set(0.5, 0);
    this.listText.position.set(W / 2, 460);
    this.footer = label('Tippe deinen Namen und drück Enter · Esc = ohne Speichern', 22, 0xc8c0e0, { fontWeight: '600' });
    this.footer.position.set(W / 2, H - 60);
    this.container.addChild(panel, title, score, stats, this.prompt, box, this.nameText, this.listText, this.footer);
    this.renderList();
    input.textMode = true;
    input.keyListeners.add(this.onKey);
  }

  private renderList(): void {
    const list = loadScores(this.gameId).slice(0, 5);
    this.listText.text = list.length
      ? list.map((e, i) => `${i === this.rank ? '▶ ' : '   '}${i + 1}.  ${e.name.padEnd(MAX_NAME, ' ')}  ${String(e.score).padStart(6, ' ')}`).join('\n')
      : 'Noch keine Einträge';
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.phase === 'entry') {
      if (e.key === 'Enter') {
        const n = sanitizeName(this.playerName);
        if (n) {
          this.rank = saveScore(this.gameId, { name: n, score: this.result.score, date: new Date().toISOString().slice(0, 10) });
          this.sfx.confirm();
        }
        this.toList();
      } else if (e.key === 'Escape') {
        this.toList();
      } else if (e.key === 'Backspace') {
        this.playerName = this.playerName.slice(0, -1);
      } else if (e.key.length === 1 && this.playerName.length < MAX_NAME && /[\p{L}\p{N} .\-]/u.test(e.key)) {
        this.playerName += e.key;
        this.sfx.select();
      }
      e.preventDefault();
    } else if (this.phase === 'list' && this.t > 0.5 && (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape')) {
      this.onMenu();
    }
  };

  private toList(): void {
    this.phase = 'list';
    this.t = 0;
    this.input.textMode = false;
    this.input.flush();
    this.prompt.text = this.rank >= 0 ? `Gespeichert! Du bist auf Platz ${this.rank + 1}.` : 'Bestenliste';
    this.footer.text = 'Spring oder drück Enter für das Menü';
    this.renderList();
  }

  update(dt: number): void {
    this.t += dt;
    this.tw.update(dt);
    const cursor = this.phase === 'entry' && Math.floor(this.t * 2) % 2 === 0 ? '|' : '';
    this.nameText.text = this.phase === 'entry' ? this.playerName + cursor : this.playerName || '–';
    const inputs = this.input.poll();
    const jumped = inputs.some((p) => p.landings.length && p.source === 'camera');
    if (this.phase === 'entry' && this.t > 4 && jumped) {
      // no keyboard at hand: a jump skips the name entry (saves if something was typed)
      const n = sanitizeName(this.playerName);
      if (n) this.rank = saveScore(this.gameId, { name: n, score: this.result.score, date: new Date().toISOString().slice(0, 10) });
      this.toList();
    } else if (this.phase === 'list' && this.t > 1.5 && inputs.some((p) => p.landings.length)) this.onMenu();
  }

  destroy(): void {
    this.input.textMode = false;
    this.input.keyListeners.delete(this.onKey);
    this.container.destroy({ children: true });
  }
}
