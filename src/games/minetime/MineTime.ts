import { Container, Graphics, Text } from 'pixi.js';
import type { GameContext, GameModule } from '../types';
import { W, H } from '../types';
import { MineGrid, COLS, VISIBLE_ROWS, type MineEvent, type Block, HAMMER_DURATION } from './grid';
import { drawBlock, drawClock, drawGem, GEM_COLORS, KIND_COLORS } from './draw';
import { ParticleSystem } from '../../core/particles';
import { Tweens, floatText, label, easeOutBack, easeOutCubic } from '../../core/fx';
import { Vfx } from '../../core/vfx';
import { armsUp, ArmsUpHold, StillnessCheck, upperBody } from '../../input/armsUp';

const CELL_W = 110;
const CELL_H = 74;
const GX = (W - COLS * CELL_W) / 2;
const GY = 122;
const PLAYER_COLORS = [0x3fd0ff, 0xffa53d];
const params = new URLSearchParams(location.search);
export const ROUND_TIME = Number(params.get('time')) || 120;

interface CellView { c: Container; g: Graphics; block: Block }

export class MineTime implements GameModule {
  id = 'minetime';
  title = 'Mine Time';
  private ctx!: GameContext;
  private grid!: MineGrid;
  private tw = new Tweens();
  private layer = new Container();
  private gridLayer = new Container();
  private cellLayer = new Container();
  private fxLayer = new Container();
  private hud = new Container();
  private highlight = new Graphics();
  private markers: Container[] = [];
  private cells = new Map<number, CellView>();
  private particles!: ParticleSystem;
  private scoreText!: Text;
  private timeText!: Text;
  private levelText!: Text;
  private comboText!: Text;
  private hammerText!: Text;
  private hintText!: Text;
  private scrollY = 0;
  private timeLeft = ROUND_TIME;
  private t = 0;
  private cols: number[] = [0, 3];
  private ended = false;
  private advancing = false;
  private lastTick = 99;
  private shownScore = 0;
  private hits = 0;
  private highJumps = 0;
  private destroyed = false;
  private vfx!: Vfx;
  private pauseLayer = new Container();
  private pause: {
    hold: ArmsUpHold; still: StillnessCheck[]; ring: Graphics; status: Text; t: number; closing: boolean; camera: boolean;
    onKey: (e: KeyboardEvent) => void; level: number;
  } | null = null;
  /** seconds already added to timeLeft but not yet shown (clock icon still flying to the timer) */
  private timeInFlight = 0;
  /** 1 → 0: green flash/pulse of the timer after a time bonus */
  private timeFlash = 0;
  private gemsAtLevelStart = 0;
  private scoreAtLevelStart = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.grid = new MineGrid(Date.now() & 0xffffffff, 1);
    this.cols = ctx.players === 2 ? [1, 4] : [2, 0];
    ctx.root.addChild(this.layer);

    // cave frame + darker "air" behind blocks (the player cut-out shows through)
    const frame = new Graphics();
    frame.roundRect(GX - 14, GY - 10, COLS * CELL_W + 28, VISIBLE_ROWS * CELL_H + 20, 18).fill({ color: 0x2a1a10, alpha: 0.85 }).stroke({ width: 6, color: 0x5a3a1c });
    frame.rect(GX, GY, COLS * CELL_W, VISIBLE_ROWS * CELL_H).fill({ color: 0x0b0710, alpha: 0.35 });
    if (ctx.players === 2) frame.rect(GX + 3 * CELL_W - 2, GY - 10, 4, VISIBLE_ROWS * CELL_H + 20).fill(0xffffff);
    this.layer.addChild(frame);

    const mask = new Graphics().rect(GX, GY, COLS * CELL_W, VISIBLE_ROWS * CELL_H).fill(0xffffff);
    this.gridLayer.addChild(this.cellLayer);
    this.gridLayer.mask = mask;
    this.layer.addChild(mask, this.highlight, this.gridLayer);

    for (let i = 0; i < ctx.players; i++) {
      const m = new Container();
      const g = new Graphics();
      // little miner helmet marker
      g.circle(0, 0, 20).fill(PLAYER_COLORS[i]).stroke({ width: 4, color: 0xffffff });
      g.rect(-24, 2, 48, 8).fill(PLAYER_COLORS[i]);
      g.circle(0, -8, 7).fill(0xfff7a8).stroke({ width: 2, color: 0x806000 });
      g.poly([-10, 14, 10, 14, 0, 30]).fill(0xffffff);
      m.addChild(g);
      if (ctx.players === 2) { const l = label(`${i + 1}`, 18, 0x1a1030, { stroke: { width: 0, color: 0 } }); l.y = 4; m.addChild(l); }
      this.markers.push(m);
      this.layer.addChild(m);
    }

    this.particles = new ParticleSystem(W, H - 4);
    this.vfx = new Vfx(W, H);
    this.layer.addChild(this.vfx.container, this.fxLayer, this.particles.container, this.hud, this.vfx.flashLayer, this.pauseLayer);

    // HUD
    const hudBg = new Graphics().roundRect(10, 8, W - 20, 82, 20).fill({ color: 0x140a24, alpha: 0.7 });
    this.hud.addChild(hudBg);
    const scoreIcon = new Graphics();
    drawGem(scoreIcon, 56, 49, 22, 3);
    this.hud.addChild(scoreIcon);
    this.scoreText = label('0', 46, 0xffe66b);
    this.scoreText.anchor.set(0, 0.5);
    this.scoreText.position.set(90, 49);
    this.timeText = label('2:00', 54, 0xffffff);
    this.timeText.position.set(W / 2, 49);
    this.levelText = label('', 30, 0xb6ffcf);
    this.levelText.anchor.set(1, 0.5);
    this.levelText.position.set(W - 34, 36);
    this.hammerText = label('', 22, 0xffe66b);
    this.hammerText.anchor.set(1, 0.5);
    this.hammerText.position.set(W - 34, 70);
    this.comboText = label('', 30, 0xff7ad9);
    this.comboText.anchor.set(0, 0.5);
    this.comboText.position.set(330, 49);
    this.hintText = label('Spring, um zu graben!', 30, 0xffffff, { wordWrap: true, wordWrapWidth: GX - 40 });
    this.hintText.position.set(GX / 2, H / 2 + 60);
    this.hud.addChild(this.scoreText, this.timeText, this.levelText, this.hammerText, this.comboText);
    this.layer.addChild(this.hintText);
    this.tw.add(4, (k) => { this.hintText.alpha = k < 0.8 ? 1 : 1 - (k - 0.8) * 5; });

    this.buildCells(true);
    this.banner('Los geht\u2019s!', 0xffe66b);
    ctx.sfx.start();
  }

  // ---------- grid view ----------
  private key(c: number, r: number): number { return r * COLS + c; }

  private cellPos(c: number, r: number): { x: number; y: number } {
    return { x: GX + c * CELL_W + CELL_W / 2, y: GY + (r - this.scrollY) * CELL_H + CELL_H / 2 };
  }

  private buildCells(intro: boolean): void {
    for (const v of this.cells.values()) v.c.destroy({ children: true });
    this.cells.clear();
    this.scrollY = this.grid.viewTop;
    for (let r = 0; r < this.grid.rows; r++)
      for (let c = 0; c < COLS; c++) {
        const b = this.grid.get(c, r);
        if (!b) continue;
        const cont = new Container();
        const g = new Graphics();
        g.position.set(-CELL_W / 2, -CELL_H / 2);
        drawBlock(g, b, CELL_W, CELL_H, c, r, this.grid.level);
        cont.addChild(g);
        cont.position.set(c * CELL_W + CELL_W / 2, r * CELL_H + CELL_H / 2);
        this.cellLayer.addChild(cont);
        this.cells.set(this.key(c, r), { c: cont, g, block: b });
        if (intro && r < VISIBLE_ROWS + 1) {
          cont.scale.set(0);
          const delay = (r * COLS + c) * 0.012;
          this.tw.add(0.35 + delay, (k) => {
            const kk = Math.max(0, (k * (0.35 + delay) - delay) / 0.35);
            cont.scale.set(easeOutBack(Math.min(1, kk)) * (kk > 0 ? 1 : 0));
          });
        }
      }
    this.syncScroll();
  }

  private syncScroll(): void {
    this.gridLayer.position.set(GX, GY - this.scrollY * CELL_H);
  }

  private redraw(c: number, r: number): void {
    const v = this.cells.get(this.key(c, r));
    if (v) drawBlock(v.g, v.block, CELL_W, CELL_H, c, r, this.grid.level);
  }

  private removeCell(c: number, r: number, delay = 0): void {
    const k = this.key(c, r);
    const v = this.cells.get(k);
    if (!v) return;
    this.cells.delete(k);
    this.tw.add(0.12 + delay, (kk) => {
      const local = Math.max(0, (kk * (0.12 + delay) - delay) / 0.12);
      v.c.scale.set(1 + 0.25 * local);
      v.c.alpha = 1 - local;
    }, () => v.c.destroy({ children: true }));
  }

  // ---------- feedback ----------
  private banner(text: string, color: number, size = 64): void {
    const t = label(text, size, color);
    t.position.set(W / 2, H / 2 - 40);
    this.fxLayer.addChild(t);
    this.tw.add(1.6, (k) => {
      t.scale.set(k < 0.2 ? easeOutBack(k / 0.2) : 1 + (k - 0.2) * 0.1);
      t.alpha = k < 0.75 ? 1 : 1 - (k - 0.75) * 4;
      t.rotation = Math.sin(k * 12) * 0.03;
    }, () => t.destroy());
  }

  private flyGem(x: number, y: number, type: number): void {
    const g = new Graphics();
    drawGem(g, 0, 0, 14, type);
    g.position.set(x, y);
    this.fxLayer.addChild(g);
    const sx = 56, sy = 49;
    this.tw.add(0.7, (k) => {
      const e = easeOutCubic(k);
      g.position.set(x + (sx - x) * e, y + (sy - y) * e - Math.sin(k * Math.PI) * 120);
      g.scale.set(1.4 - k * 0.6);
    }, () => {
      g.destroy();
      this.scoreText.scale.set(1.25);
    });
  }

  /**
   * Time block collected: sparkles at the block, a stopwatch flies to the timer (0.45 s),
   * then the timer flashes green and pulses, "+5 s" pops up next to it (0.5 s). Total < 1 s.
   * The seconds are credited immediately (so the clock can't run out mid-flight); only the display waits.
   */
  private timeBonusFx(x: number, y: number, seconds: number, delay: number): void {
    this.timeInFlight += seconds;
    this.particles.burst(x, y, 0x7dffa8, 12, { shape: 'spark', speed: 9, size: 7, life: 0.55, up: 5 });
    this.particles.burst(x, y, 0xffffff, 6, { shape: 'spark', speed: 6, size: 5, life: 0.45 });
    const icon = new Graphics();
    drawClock(icon, 0, 0, 20, false);
    icon.position.set(x, y);
    icon.scale.set(0);
    this.hud.addChild(icon); // above the HUD background so it stays visible up to the timer
    const tx = this.timeText.x, ty = this.timeText.y;
    const fly = 0.45, total = fly + delay;
    this.tw.add(total, (kk) => {
      const k = Math.max(0, (kk * total - delay) / fly);
      const e = easeOutCubic(k);
      // curve sideways (not upwards – the timer sits at the top edge)
      const side = x < tx ? -1 : 1;
      icon.position.set(x + (tx - x) * e + side * Math.sin(k * Math.PI) * 110, y + (ty - y) * e);
      icon.scale.set(k < 0.2 ? easeOutBack(k / 0.2) * 1.5 : 1.5 - (k - 0.2) * 0.9);
      icon.rotation = Math.sin(k * Math.PI * 2) * 0.35;
    }, () => {
      icon.destroy();
      if (this.destroyed) return;
      this.timeInFlight = Math.max(0, this.timeInFlight - seconds);
      this.timeFlash = 1;
      this.ctx.sfx.timeBonus();
      this.particles.burst(tx, ty, 0x7dffa8, 10, { shape: 'spark', speed: 8, size: 6, life: 0.45 });
      this.particles.burst(tx, ty, 0xfff7a8, 5, { shape: 'spark', speed: 5, size: 5, life: 0.4 });
      const ring = new Graphics();
      ring.position.set(tx, ty);
      const pop = label(`+${seconds} s`, 40, 0x7dffa8);
      pop.position.set(tx + 120, ty);
      this.hud.addChild(ring, pop);
      this.tw.add(0.5, (k) => {
        ring.clear().circle(0, 0, 40 + 70 * easeOutCubic(k)).stroke({ width: 8 * (1 - k) + 1, color: 0x7dffa8, alpha: 0.9 * (1 - k) });
        pop.y = ty - 26 * easeOutCubic(k);
        pop.scale.set(k < 0.25 ? 0.4 + easeOutBack(k / 0.25) * 0.8 : 1.2 - (k - 0.25) * 0.3);
        pop.alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      }, () => { ring.destroy(); pop.destroy(); });
    });
  }

  private onEvents(ev: MineEvent[], player: number): void {
    const sfx = this.ctx.sfx;
    let breaks = 0;
    let bombs = 0;
    let clocks = 0;
    for (const e of ev) {
      switch (e.type) {
        case 'damage': {
          this.redraw(e.col, e.row);
          const v = this.cells.get(this.key(e.col, e.row));
          if (v) this.tw.add(0.25, (k) => { if (v.c.destroyed) return; const s = 1 - Math.sin(k * Math.PI) * 0.15; v.c.scale.set(1 + (1 - s), s); });
          const p = this.cellPos(e.col, e.row);
          this.particles.burst(p.x, p.y - CELL_H / 2, KIND_COLORS[e.block.kind], 5, { speed: 4, size: 5 });
          sfx.crack();
          this.ctx.shake(3);
          break;
        }
        case 'break': {
          breaks++;
          const p = this.cellPos(e.col, e.row);
          const color = KIND_COLORS[e.block.kind];
          const n = e.cause === 'hit' ? 14 : 7;
          this.particles.burst(p.x, p.y, color, n, { speed: e.cause === 'bomb' ? 9 : 6, size: 8 });
          this.removeCell(e.col, e.row, e.cause === 'drill' ? Math.max(0, e.row - this.grid.viewTop) * 0.04 : 0);
          if (e.points >= 3 && e.cause === 'hit' && e.block.kind !== 'clock') floatText(this.fxLayer, this.tw, `+${e.points}`, p.x, p.y, 0xffffff, 26);
          if (e.cause === 'hit') this.ctx.shake(e.block.kind === 'hard' ? 9 : 5);
          break;
        }
        case 'gem': {
          const p = this.cellPos(e.col, e.row);
          this.particles.burst(p.x, p.y, GEM_COLORS[e.gemType], 10, { shape: 'gem', speed: 7, size: 8, up: 7 });
          this.particles.burst(p.x, p.y, 0xffffff, 8, { shape: 'spark', speed: 8, size: 6, life: 0.6 });
          floatText(this.fxLayer, this.tw, `+${e.points}`, p.x, p.y - 10, GEM_COLORS[e.gemType], 40);
          this.flyGem(p.x, p.y, e.gemType);
          sfx.gem(e.gemType);
          break;
        }
        case 'bomb': {
          // first TNT of a chain gets the full blast, chained ones are a bit smaller (keeps it readable and cheap)
          const p = this.cellPos(e.col, e.row);
          const first = bombs++ === 0;
          this.vfx.explosion(p.x, p.y, first ? 1 : 0.6);
          this.particles.burst(p.x, p.y, 0xff8a1f, first ? 18 : 8, { shape: 'spark', speed: 16, size: 10, life: 0.9 });
          this.particles.burst(p.x, p.y, 0x6b4a2a, first ? 12 : 5, { speed: 12, size: 10, up: 8 });
          if (first) {
            floatText(this.fxLayer, this.tw, 'BUMM!', p.x, p.y - 20, 0xff8a1f, 72);
            sfx.bigBoom();
            this.ctx.shake(34);
          } else this.ctx.shake(26);
          break;
        }
        case 'powerup': {
          const txt = { drill: 'BOHRER!', hammer: 'SUPER-HAMMER!', magnet: 'MAGNET!' }[e.kind];
          this.banner(txt, 0xffe66b, 60);
          const p = this.cellPos(e.col, e.row);
          this.particles.burst(p.x, p.y, 0xffe66b, 16, { shape: 'spark', speed: 10, size: 7, life: 0.8 });
          if (e.kind === 'drill') this.drillLightning(e.col, e.row);
          else sfx.power();
          this.ctx.shake(e.kind === 'drill' ? 16 : 6);
          break;
        }
        case 'time': {
          if (this.ended) break;
          this.timeLeft += e.seconds;
          const p = this.cellPos(e.col, e.row);
          this.timeBonusFx(p.x, p.y, e.seconds, 0.08 * clocks++);
          floatText(this.fxLayer, this.tw, `+${e.seconds} s`, p.x, p.y - 10, 0x7dffa8, 34);
          break;
        }
        case 'combo':
          if (e.combo >= 3) sfx.combo(e.combo);
          if (e.multiplier > 1 && [5, 10, 20].includes(e.combo)) {
            this.banner(`Combo x${e.multiplier}!`, 0xff7ad9, 54);
          }
          break;
        case 'empty':
          sfx.empty();
          this.hint('Hier ist alles leer – such dir eine andere Spalte!');
          break;
        case 'cavein':
          this.ctx.shake(8);
          break;
        case 'exitReached':
          this.onExit(e.col, e.row);
          break;
      }
    }
    if (breaks) this.ctx.sfx.breakBlock(breaks > 3);
    else if (!ev.some((e) => e.type === 'damage' || e.type === 'empty')) sfx.hit();
    void player;
  }

  /** Drill power-up: lightning strikes down along both sides of the column and both sides of the cave. */
  private drillLightning(col: number, row: number): void {
    const bottom = GY + VISIBLE_ROWS * CELL_H;
    const left = GX + col * CELL_W + 10, right = GX + (col + 1) * CELL_W - 10;
    const strikes: [number, number, number][] = [
      [left, bottom, 0], [right, bottom, 0.06],
      [GX - 40, H - 30, 0.16], [GX + COLS * CELL_W + 40, H - 30, 0.22],
    ];
    for (const [x, y1, delay] of strikes) {
      this.vfx.lightning(x, 0, y1, () => {
        if (this.destroyed) return;
        this.particles.burst(x, y1 - 6, 0xbfe3ff, 10, { shape: 'spark', speed: 13, size: 7, life: 0.6, up: 6 });
        this.particles.burst(x, y1 - 6, 0xffffff, 6, { shape: 'spark', speed: 8, size: 5, life: 0.45, up: 4 });
      }, delay);
    }
    // sparks running down the drilled column
    const p = this.cellPos(col, row);
    for (let r = 0; r < 5; r++) this.particles.burst(p.x, p.y + r * CELL_H, 0x9fd0ff, 3, { shape: 'spark', speed: 9, size: 6, life: 0.5 });
    this.ctx.sfx.thunder();
  }

  private hint(text: string): void {
    this.hintText.text = text;
    this.hintText.alpha = 1;
    this.tw.add(2.5, (k) => { this.hintText.alpha = k < 0.8 ? 1 : 1 - (k - 0.8) * 5; });
  }

  private onExit(c: number, r: number): void {
    if (this.advancing) return;
    this.advancing = true;
    this.ctx.sfx.level();
    const p = this.cellPos(c, r);
    this.particles.burst(p.x, p.y, 0x2bd96b, 30, { shape: 'spark', speed: 12, size: 9, life: 1.2 });
    this.banner('AUSGANG GEFUNDEN!', 0x7dffa8, 64);
    this.tw.add(1.4, () => {}, () => {
      if (this.ended || this.destroyed) return;
      this.showPause();
    });
  }

  private get cameraActive(): boolean {
    const cam = this.ctx.input.camera;
    return !!cam && cam.status.state === 'running';
  }

  /** Pause between levels: shows the result and waits for "both arms up" (or Enter/Space). */
  private pauseStartedAt = 0;
  private showPause(): void {
    this.pauseStartedAt = performance.now() / 1000;
    const done = this.grid.level;
    const gems = this.grid.gems - this.gemsAtLevelStart;
    const bonus = this.grid.advanceLevel(); // score already includes the bonus; cells are rebuilt on continue
    const levelPoints = this.grid.score - this.scoreAtLevelStart;
    this.ctx.sfx.pauseIn();
    const L = this.pauseLayer;
    const dim = new Graphics().rect(0, 0, W, H).fill({ color: 0x0b0618, alpha: 0.72 });
    const PW = 880, PH = 500, PX = (W - PW) / 2, PY = 120;
    const panel = new Graphics().roundRect(PX, PY, PW, PH, 32).fill({ color: 0x24143f, alpha: 0.96 }).stroke({ width: 6, color: 0xffe66b });
    const title = label(`Level ${done} geschafft! 🎉`, 58, 0xffe66b);
    title.position.set(W / 2, PY + 62);
    const l1 = label(`${gems} Edelsteine  ·  ${levelPoints} Punkte (inkl. +${bonus} Tiefenbonus)`, 28, 0xffffff);
    l1.position.set(W / 2, PY + 128);
    const l2 = label(`Als Nächstes: Level ${this.grid.level} – noch tiefer! ⛏`, 32, 0x7dffa8);
    l2.position.set(W / 2, PY + 176);
    const camera = this.cameraActive;
    const ring = new Graphics();
    ring.position.set(W / 2, PY + 300);
    const icon = label(camera ? '🙌' : '⌨️', 64, 0xffffff, { stroke: { width: 0, color: 0 } });
    icon.position.set(W / 2, PY + 300);
    const hint = label(camera ? 'Arme hochheben zum Weitermachen 🙌' : 'Drücke Enter oder Leertaste zum Weitermachen', camera ? 36 : 32, 0xffffff);
    hint.position.set(W / 2, PY + 410);
    const status = label(camera ? 'oder Enter / Leertaste drücken' : '', 22, 0xc8c0e0, { fontWeight: '700' });
    status.position.set(W / 2, PY + 458);
    L.addChild(dim, panel, title, l1, l2, ring, icon, hint, status);
    L.alpha = 0;
    L.visible = true;
    this.tw.add(0.3, (k) => { L.alpha = k; panel.scale.set(1); });
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && (this.pause?.t ?? 0) > 0.6) { e.preventDefault(); this.continueFromPause(); }
    };
    window.addEventListener('keydown', onKey);
    this.pause = { hold: new ArmsUpHold(), still: [new StillnessCheck(), new StillnessCheck()], ring, status, t: 0, closing: false, camera, onKey, level: this.grid.level };
  }

  private updatePause(dt: number, now: number): void {
    const P = this.pause;
    if (!P || P.closing) return;
    P.t += dt;
    let anyUp = false;
    let grounded = true;
    if (this.cameraActive) {
      for (let i = 0; i < this.ctx.players; i++) {
        const tp = this.ctx.input.tracked[i];
        if (!tp.visible) { P.still[i].reset(); continue; }
        // shoulder line must stay still (second jump guard, independent of the jump detector)
        const ub = upperBody(tp.landmarks);
        const quiet = ub ? P.still[i].update(now, ub.y, ub.torso) : false;
        if (!anyUp && armsUp(tp.landmarks)) {
          anyUp = true;
          const st = tp.detector.state;
          grounded = quiet && st !== 'AIRBORNE' && st !== 'APEX' && st !== 'TAKEOFF';
        }
      }
      const before = P.hold.progress;
      if (P.hold.update(now, anyUp, grounded)) { this.continueFromPause(); return; }
      if (Math.floor(P.hold.progress * 4) > Math.floor(before * 4)) this.ctx.sfx.armsTick();
      P.status.text = P.t < 1 ? 'Gleich geht\u2019s weiter …' : !grounded ? 'Nicht springen – Arme oben halten!' : anyUp ? 'Super – Arme oben halten!' : 'oder Enter / Leertaste drücken';
      P.status.style.fill = anyUp && grounded ? 0x7dff8a : 0xc8c0e0;
    }
    // progress ring
    const pr = P.camera ? P.hold.progress : 0;
    const g = P.ring.clear();
    g.circle(0, 0, 64).fill({ color: 0x140a24, alpha: 0.9 }).stroke({ width: 12, color: 0x3a2a5a });
    if (pr > 0) g.arc(0, 0, 64, -Math.PI / 2, -Math.PI / 2 + pr * Math.PI * 2).stroke({ width: 12, color: 0x7dff8a, cap: 'round' });
    P.ring.scale.set(1 + 0.04 * Math.sin(P.t * 5) + pr * 0.12);
    // keep landings from piling up while paused
    this.ctx.input.flush();
  }

  private continueFromPause(): void {
    const P = this.pause;
    if (!P || P.closing || this.destroyed) return;
    P.closing = true;
    window.removeEventListener('keydown', P.onKey);
    // the hammer power-up does not run out while the game is paused
    const pausedFor = performance.now() / 1000 - this.pauseStartedAt;
    if (this.grid.hammerUntil > this.pauseStartedAt) this.grid.hammerUntil += pausedFor;
    this.ctx.sfx.confirm();
    P.ring.clear().circle(0, 0, 64).fill({ color: 0x2ecc71, alpha: 0.95 }).stroke({ width: 12, color: 0x7dff8a });
    this.tw.add(0.35, (k) => { this.pauseLayer.alpha = 1 - k; }, () => {
      if (this.destroyed) return;
      this.pauseLayer.removeChildren().forEach((c) => c.destroy());
      this.pauseLayer.visible = false;
      this.pause = null;
      this.gemsAtLevelStart = this.grid.gems;
      this.scoreAtLevelStart = this.grid.score;
      this.buildCells(true);
      this.banner(`Level ${this.grid.level} – Los!`, 0xffe66b, 60);
      this.advancing = false;
      this.ctx.input.flush();
    });
  }

  // ---------- loop ----------
  private colFor(x: number, i: number): number {
    const n = this.ctx.players === 2 ? 3 : COLS;
    const local = this.ctx.players === 2 ? (i === 0 ? x / 0.5 : (x - 0.5) / 0.5) : x;
    const off = this.ctx.players === 2 ? i * 3 : 0;
    const cur = this.cols[i] - off;
    const pos = Math.min(0.9999, Math.max(0, local)) * n;
    // hysteresis: stay in the current column until clearly beyond its border
    if (pos > cur - 0.15 && pos < cur + 1.15) return cur + off;
    return Math.floor(pos) + off;
  }

  update(dt: number): void {
    this.t += dt;
    const now = performance.now() / 1000;
    this.tw.update(dt);
    if (this.destroyed) return;
    this.particles.update(dt);
    this.vfx.update(dt);
    if (this.pause) this.updatePause(dt, now);

    if (!this.ended && !this.advancing) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const sec = Math.ceil(this.timeLeft);
      if (sec <= 10 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; this.ctx.sfx.tick(); }
      if (this.timeLeft <= 0) this.finish();
    }

    const inputs = this.ctx.input.poll();
    for (const p of inputs) {
      this.cols[p.id] = this.colFor(p.x, p.id);
      if (this.ended || this.advancing) continue;
      for (const land of p.landings) {
        this.hits++;
        if (land.high) this.highJumps++;
        const ev = this.grid.hit(this.cols[p.id], now, land.high);
        this.onEvents(ev, p.id);
        if (land.high) floatText(this.fxLayer, this.tw, 'HOCHSPRUNG x2!', this.cellPos(this.cols[p.id], this.grid.viewTop).x, GY + 190, 0x7df9ff, 30);
      }
    }

    // smooth scroll
    const target = this.grid.viewTop;
    if (Math.abs(this.scrollY - target) > 0.001) {
      this.scrollY += (target - this.scrollY) * Math.min(1, dt * 6);
      if (Math.abs(this.scrollY - target) < 0.01) this.scrollY = target;
      this.syncScroll();
    }

    // column highlight + markers
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
    this.highlight.clear();
    for (let i = 0; i < this.ctx.players; i++) {
      const c = this.cols[i];
      const x = GX + c * CELL_W;
      this.highlight.rect(x, GY, CELL_W, VISIBLE_ROWS * CELL_H).fill({ color: PLAYER_COLORS[i], alpha: 0.16 + 0.1 * pulse });
      const top = this.grid.topRow(c);
      const ty = GY + (top - this.scrollY) * CELL_H;
      const m = this.markers[i];
      const tx = x + CELL_W / 2;
      m.position.set(m.x ? m.x + (tx - m.x) * Math.min(1, dt * 18) : tx, Math.max(GY - 30, Math.min(H - 60, ty - 32)) + Math.sin(this.t * 5 + i) * 3);
      if (top < this.grid.rows) {
        this.highlight.roundRect(x + 2, ty + 2, CELL_W - 4, CELL_H - 4, 10).stroke({ width: 5, color: PLAYER_COLORS[i], alpha: 0.6 + 0.4 * pulse });
      }
    }
    this.highlight.mask = null;

    // HUD
    const g = this.grid;
    this.shownScore += (g.score - this.shownScore) * Math.min(1, dt * 10);
    if (Math.abs(g.score - this.shownScore) < 1) this.shownScore = g.score;
    this.scoreText.text = `${Math.round(this.shownScore)}`;
    this.scoreText.scale.set(1 + (this.scoreText.scale.x - 1) * 0.85);
    const s = Math.max(0, Math.ceil(this.timeLeft - this.timeInFlight));
    this.timeText.text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timeFlash = Math.max(0, this.timeFlash - dt / 0.5);
    const f = this.timeFlash;
    this.timeText.style.fill = f > 0.85 ? 0xffffff : f > 0.1 ? 0x5dff8f : s <= 10 ? 0xff5a5a : 0xffffff;
    this.timeText.scale.set(f > 0 ? 1 + 0.45 * Math.sin(f * Math.PI) * f + 0.1 * f : s <= 10 ? 1 + 0.1 * pulse : 1);
    this.levelText.text = `Level ${g.level} · Tiefe ${g.depth * 2 + 2} m`;
    const comboActive = now - g.lastHitT < 1.6 && g.combo >= 2;
    this.comboText.text = comboActive ? `Combo ${g.combo}${g.multiplier > 1 ? `  x${g.multiplier}` : ''}` : '';
    const hammer = g.hammerUntil - now;
    this.hammerText.text = hammer > 0 ? `HAMMER ${Math.ceil(hammer)}s` : '';
    if (hammer > 0) this.hammerText.alpha = hammer < 2 ? pulse : 1;
    void HAMMER_DURATION;
  }

  private finish(): void {
    this.ended = true;
    this.ctx.sfx.end();
    this.banner('Zeit um!', 0xffe66b, 80);
    this.tw.add(1.8, () => {}, () => {
      this.ctx.end({
        score: this.grid.score,
        stats: [
          `Edelsteine: ${this.grid.gems}`,
          ...(this.grid.clocks ? [`Zeit-Blöcke: ${this.grid.clocks} (+${this.grid.timeBonus} s)`] : []),
          `Level erreicht: ${this.grid.level}`,
          `Tiefe: ${this.grid.depth * 2 + 2} m`,
          `Sprünge: ${this.hits} (davon ${this.highJumps} Hochsprünge)`,
        ],
      });
    });
  }

  /** for tests / debugging */
  get state() {
    return {
      score: this.grid.score, level: this.grid.level, viewTop: this.grid.viewTop, timeLeft: this.timeLeft, cols: this.cols,
      clocks: this.grid.clocks, timeBonus: this.grid.timeBonus, timeFlash: this.timeFlash,
      paused: !!this.pause, pauseProgress: this.pause?.hold.progress ?? 0, vfx: { ...this.vfx.stats, active: this.vfx.active },
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pause) window.removeEventListener('keydown', this.pause.onKey);
    this.pause = null;
    this.tw.clear();
    this.vfx.destroy();
    this.particles.destroy();
    this.layer.destroy({ children: true });
  }
}
