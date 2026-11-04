/**
 * Debris / gem / explosion particles simulated with Rapier2D.
 * (Rapier is used ONLY for these effects – players are never physics bodies.)
 */
import RAPIER from '@dimforge/rapier2d-compat';
import { Container, Graphics } from 'pixi.js';

const PX = 50; // pixels per metre
let rapierReady: Promise<void> | null = null;
export const initPhysics = (): Promise<void> => (rapierReady ??= RAPIER.init());

interface P { g: Graphics; body: RAPIER.RigidBody; life: number; max: number; spin: number }

export type ParticleShape = 'rock' | 'gem' | 'spark';

export class ParticleSystem {
  readonly container = new Container();
  private world: RAPIER.World;
  private ps: P[] = [];
  private acc = 0;
  readonly max = 260;

  constructor(width: number, floorY: number) {
    this.world = new RAPIER.World({ x: 0, y: 22 });
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const groups = (0x0002 << 16) | 0x0001; // static: member 2, collides with 1
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / PX, 0.5).setTranslation(width / 2 / PX, floorY / PX + 0.5).setCollisionGroups(groups).setFriction(0.8),
      ground,
    );
    for (const x of [-0.5, width / PX + 0.5])
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 40).setTranslation(x, 0).setCollisionGroups(groups), ground);
  }

  burst(x: number, y: number, color: number, count: number, opts: { speed?: number; shape?: ParticleShape; size?: number; up?: number; life?: number } = {}): void {
    const speed = opts.speed ?? 6;
    const shape = opts.shape ?? 'rock';
    for (let i = 0; i < count; i++) {
      if (this.ps.length >= this.max) this.kill(0);
      const s = (opts.size ?? 7) * (0.5 + Math.random() * 0.8);
      const g = new Graphics();
      if (shape === 'gem') {
        g.poly([0, -s, s * 0.8, 0, 0, s, -s * 0.8, 0]).fill(color).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
      } else if (shape === 'spark') {
        g.circle(0, 0, s * 0.5).fill({ color, alpha: 0.95 });
      } else {
        g.poly([-s, -s * 0.6, s * 0.7, -s, s, s * 0.5, -s * 0.4, s]).fill(color).stroke({ width: 1, color: 0x000000, alpha: 0.35 });
      }
      g.position.set(x, y);
      this.container.addChild(g);
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x / PX, y / PX)
          .setLinvel(Math.cos(a) * v, Math.sin(a) * v - (opts.up ?? 5))
          .setAngvel((Math.random() - 0.5) * 20)
          .setLinearDamping(shape === 'spark' ? 1.5 : 0.2),
      );
      const groups = (0x0001 << 16) | 0x0002; // particle: member 1, collides only with static 2
      this.world.createCollider(
        RAPIER.ColliderDesc.ball(Math.max(0.04, s / PX)).setRestitution(0.45).setDensity(1).setCollisionGroups(groups),
        body,
      );
      const max = (opts.life ?? 1.6) * (0.7 + Math.random() * 0.6);
      this.ps.push({ g, body, life: max, max, spin: 0 });
    }
  }

  private kill(i: number): void {
    const p = this.ps[i];
    this.world.removeRigidBody(p.body);
    p.g.destroy();
    this.ps.splice(i, 1);
  }

  update(dt: number): void {
    this.acc += Math.min(dt, 0.1);
    const step = 1 / 60;
    this.world.timestep = step;
    while (this.acc >= step) { this.world.step(); this.acc -= step; }
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) { this.kill(i); continue; }
      const t = p.body.translation();
      p.g.position.set(t.x * PX, t.y * PX);
      p.g.rotation = p.body.rotation();
      p.g.alpha = Math.min(1, p.life / (p.max * 0.4));
    }
  }

  clear(): void {
    while (this.ps.length) this.kill(this.ps.length - 1);
  }

  destroy(): void {
    this.clear();
    this.world.free();
    this.container.destroy({ children: true });
  }
}
