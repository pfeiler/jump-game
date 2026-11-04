import { Container, Graphics, Text } from 'pixi.js';
import type { Scene } from './types';
import { label, Tweens, easeOutBack } from '../core/fx';
import { W, type GameDefinition } from '../games/types';
import { listGames } from '../games/registry';
import type { InputManager } from '../input/inputManager';
import type { Sfx } from '../core/audio';
import { loadScores } from '../core/highscores';
import { drawGem } from '../games/minetime/draw';

type Tile = { kind: 'game'; def: GameDefinition } | { kind: 'players' } | { kind: 'soon' };

const TILE_W = 330, TILE_H = 300, TILE_Y = 330;

export class MenuScene implements Scene {
  readonly name = 'menu';
  container = new Container();
  cameraAlpha = 0.85;
  private tiles: Tile[] = [];
  private tileViews: Container[] = [];
  private tileBgs: Graphics[] = [];
  private cursors: Graphics[] = [];
  private playersText!: Text;
  private status!: Text;
  private tw = new Tweens();
  private sel = 0;
  private t = 0;
  private busy = false;
  private destroyed = false;
  private pop: number[] = [0, 0, 0, 0, 0, 0];

  constructor(
    private input: InputManager,
    private sfx: Sfx,
    private getPlayers: () => 1 | 2,
    private setPlayers: (n: 1 | 2) => void,
    private startGame: (def: GameDefinition) => void,
    private cameraStatus: () => string,
  ) {
    const title = label('Jump Game', 84, 0xffe66b);
    title.position.set(W / 2, 70);
    const sub = label('Stell dich über ein Feld und spring, um es zu wählen!', 32, 0xffffff);
    sub.position.set(W / 2, 140);
    this.container.addChild(title, sub);

    for (const def of listGames()) this.tiles.push({ kind: 'game', def });
    this.tiles.push({ kind: 'players' });
    if (listGames().length < 2) this.tiles.push({ kind: 'soon' });
    const n = this.tiles.length;
    const gap = (W - n * TILE_W) / (n + 1);
    this.tiles.forEach((tile, i) => {
      const c = new Container();
      c.position.set(gap + i * (TILE_W + gap) + TILE_W / 2, TILE_Y);
      const bg = new Graphics();
      c.addChild(bg);
      this.tileBgs.push(bg);
      if (tile.kind === 'game') {
        const icon = new Graphics();
        // little mine scene icon
        for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) icon.roundRect(-90 + x * 60, -95 + y * 44, 56, 40, 8).fill([0x9a6233, 0x8d939e, 0x4b4f5e][(x + y) % 3]);
        drawGem(icon, 0, -51, 16, 1);
        drawGem(icon, -60, -51, 14, 2);
        c.addChild(icon);
        const t = label(tile.def.title, 50, 0xffe66b);
        t.y = 20;
        const s = label(tile.def.subtitle, 22, 0xffffff, { wordWrap: true, wordWrapWidth: TILE_W - 30 });
        s.y = 80;
        c.addChild(t, s);
      } else if (tile.kind === 'players') {
        this.playersText = label('', 46, 0x7df9ff);
        this.playersText.y = -20;
        const s = label('Spring hier, um umzuschalten', 22, 0xffffff, { wordWrap: true, wordWrapWidth: TILE_W - 30 });
        s.y = 80;
        c.addChild(this.playersText, s);
      } else {
        const t = label('Bald mehr Spiele …', 34, 0xb0a8c8);
        c.addChild(t);
      }
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointerdown', () => { this.sel = i; this.activate(i); });
      this.tileViews.push(c);
      this.container.addChild(c);
      c.scale.set(0);
      const d = i * 0.1;
      this.tw.add(0.5 + d, (k) => {
        const kk = (k * (0.5 + d) - d) / 0.5;
        c.scale.set(kk > 0 ? easeOutBack(Math.min(1, kk)) : 0);
      });
    });
    for (let i = 0; i < 2; i++) {
      const g = new Graphics();
      g.circle(0, 0, 22).fill(i === 0 ? 0x3fd0ff : 0xffa53d).stroke({ width: 5, color: 0xffffff });
      g.poly([-14, -24, 14, -24, 0, -44]).fill(0xffffff);
      g.y = TILE_Y + TILE_H / 2 + 40;
      this.cursors.push(g);
      this.container.addChild(g);
    }

    // highscores
    const hs = loadScores('minetime').slice(0, 3);
    const hsText = label(
      hs.length ? 'Bestenliste: ' + hs.map((h, i) => `${i + 1}. ${h.name} ${h.score}`).join('   ') : 'Noch keine Highscores – sei der Erste!',
      24, 0xffe66b, { fontWeight: '700' },
    );
    hsText.position.set(W / 2, 560);
    this.status = label('', 20, 0xc8c0e0, { fontWeight: '600' });
    this.status.position.set(W / 2, 628);
    const help = label('Tastatur: ←/→ wählen · Leertaste = Sprung · Shift+Leertaste = Hochsprung · 1/2 = Spieler · B = Debug', 20, 0xc8c0e0, { fontWeight: '600' });
    help.position.set(W / 2, 668);
    this.container.addChild(hsText, this.status, help);
    input.kbStep = 1 / n;
    input.setKbX(0, 0.5 / n); // keyboard cursor starts on the first game
    input.flush();
    input.keyListeners.add(this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Enter') this.activate(this.sel);
    if (e.code === 'Digit1') this.setPlayers(1);
    if (e.code === 'Digit2') this.setPlayers(2);
  };

  private activate(i: number): void {
    if (this.busy) return;
    const tile = this.tiles[i];
    const v = this.tileViews[i];
    this.pop[i] = 0.15;
    void v;
    if (tile.kind === 'players') {
      this.setPlayers(this.getPlayers() === 1 ? 2 : 1);
      this.sfx.select();
    } else if (tile.kind === 'game') {
      this.busy = true;
      this.sfx.confirm();
      this.tw.add(0.35, () => {}, () => this.startGame(tile.def));
    } else {
      this.sfx.empty();
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.tw.update(dt);
    if (this.destroyed) return;
    const n = this.tiles.length;
    const players = this.getPlayers();
    this.playersText.text = players === 1 ? '1 Spieler' : '2 Spieler';
    const inputs = this.input.poll();
    for (let i = 0; i < 2; i++) this.cursors[i].visible = i < inputs.length;
    for (const p of inputs) {
      const tileIdx = Math.min(n - 1, Math.floor(p.x * n));
      if (p.id === 0 || p.landings.length) {
        if (tileIdx !== this.sel) { this.sel = tileIdx; this.sfx.select(); }
      }
      const cur = this.cursors[p.id];
      cur.x += (p.x * W - cur.x) * Math.min(1, dt * 15);
      cur.y = TILE_Y + TILE_H / 2 + 40 + Math.sin(this.t * 6 + p.id) * 4;
      if (p.landings.length) this.activate(tileIdx);
    }
    this.tileBgs.forEach((bg, i) => {
      const active = i === this.sel;
      const tile = this.tiles[i];
      const color = tile.kind === 'game' ? tile.def.color : tile.kind === 'players' ? 0x3a7bd5 : 0x555066;
      bg.clear();
      bg.roundRect(-TILE_W / 2, -TILE_H / 2, TILE_W, TILE_H, 30).fill({ color, alpha: active ? 0.95 : 0.6 })
        .stroke({ width: active ? 10 : 4, color: active ? 0xffffff : 0x1a1030 });
      if (this.t > 1) {
        const target = (active ? 1.05 + Math.sin(this.t * 5) * 0.02 : 1) + this.pop[i];
        const v = this.tileViews[i];
        v.scale.set(v.scale.x + (target - v.scale.x) * Math.min(1, dt * 12));
        this.pop[i] *= Math.pow(0.02, dt);
      }
    });
    this.status.text = this.cameraStatus();
  }

  destroy(): void {
    this.destroyed = true;
    this.input.keyListeners.delete(this.onKey);
    this.container.destroy({ children: true });
  }
}
