import { describe, it, expect, beforeAll } from 'vitest';
import { InputManager } from '../src/input/inputManager';
import type { LandingEvent } from '../src/input/jumpDetector';

type KeyFn = (e: { code: string; shiftKey?: boolean; repeat?: boolean; preventDefault: () => void }) => void;

beforeAll(() => {
  const listeners: KeyFn[] = [];
  (globalThis as unknown as { window: Window }).window = {
    addEventListener: (_type: string, fn: KeyFn) => { listeners.push(fn); },
  } as unknown as Window;
  (globalThis as unknown as { __keyListeners: KeyFn[] }).__keyListeners = listeners;
});

function press(code: string, shift = false): void {
  const listeners = (globalThis as unknown as { __keyListeners: KeyFn[] }).__keyListeners;
  for (const fn of listeners) fn({ code, shiftKey: shift, repeat: false, preventDefault() {} });
}

const camLanding: LandingEvent = { type: 'landing', flightTime: 0.3, height: 0.1, high: false, peak: 0.2, t: 1 };

describe('keyboard during a round', () => {
  it('does not dig or move the column, but camera landings still count', () => {
    const input = new InputManager({});
    input.gameplay = true;
    const x = input.poll()[0].x;
    press('Space');
    press('ArrowRight');
    press('KeyW');
    press('KeyE');
    const blocked = input.poll()[0];
    expect(blocked.landings).toEqual([]);
    expect(blocked.x).toBe(x);

    input.camera = { status: { state: 'running' } } as InputManager['camera'];
    input.tracked.visible = true;
    input.tracked.pending.push(camLanding);
    press('Space');
    const played = input.poll()[0];
    expect(played.landings).toHaveLength(1);
    expect(played.landings[0].flightTime).toBe(0.3);
    expect(played.source).toBe('camera');
  });

  it('still treats those keys as jumps outside a round (menu)', () => {
    const input = new InputManager({});
    input.gameplay = false;
    press('Space');
    expect(input.poll()[0].landings.map((e) => e.high)).toEqual([false]);
    press('ArrowDown');
    expect(input.poll()[0].landings.map((e) => e.high)).toEqual([true]);
  });

  it('still delivers key listeners during a round (pause / skip)', () => {
    const input = new InputManager({});
    input.gameplay = true;
    let seen = '';
    input.keyListeners.add((e) => { seen = (e as unknown as { code: string }).code; });
    press('Enter');
    press('Space');
    expect(seen).toBe('Space');
    expect(input.poll()[0].landings).toEqual([]);
  });
});
