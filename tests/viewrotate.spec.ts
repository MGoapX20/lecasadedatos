import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraDirector } from '../src/render/camera';
import { InputManager } from '../src/input/input';

/** Where the camera sits relative to what it is looking at. */
function offset(d: CameraDirector): Vector3 {
  const target = (d as unknown as { shot: { target: Vector3 } }).shot.target;
  return new Vector3().subVectors(d.camera.position, target);
}

/** Ground-plane azimuth of the camera, in degrees, as apply() lays it out. */
function camAzimuth(d: CameraDirector): number {
  const p = offset(d);
  return (Math.atan2(p.z, p.x) * 180) / Math.PI;
}

function camPitch(d: CameraDirector): number {
  const p = offset(d);
  return (Math.atan2(p.y, Math.hypot(p.x, p.z)) * 180) / Math.PI;
}

describe('middle-drag view rotation', () => {
  function director(): CameraDirector {
    const d = new CameraDirector();
    d.setBounds(41, 27);
    d.resize(16 / 9);
    d.cut('gameplay');
    return d;
  }

  it('swings the camera around the building', () => {
    const d = director();
    const before = camAzimuth(d);
    d.orbitBy(30, 0);
    expect(camAzimuth(d) - before).toBeCloseTo(30, 4);
  });

  it('drags the world with the mouse: pulling right sends the scene right', () => {
    // Screen-right in world terms, then check the camera swings the other way,
    // which is what makes the building appear to follow the hand.
    const d = director();
    const right = { x: 0, y: 0 };
    d.screenToWorldDir(1, 0, right);
    const before = d.camera.position.clone();
    d.orbitBy(20, 0);
    const moved = new Vector3().subVectors(d.camera.position, before);
    expect(moved.x * right.x + moved.z * right.y).toBeLessThan(0);
  });

  it('holds the tilt inside a readable band however far it is dragged', () => {
    const d = director();
    d.orbitBy(0, 400);
    expect(camPitch(d)).toBeLessThanOrEqual(86.001);
    d.orbitBy(0, -800);
    expect(camPitch(d)).toBeGreaterThanOrEqual(5.999);
  });

  it('moves on-screen up away from the camera after the view has turned', () => {
    const d = director();
    d.orbitBy(90, 0);
    const away = { x: 0, y: 0 };
    d.screenToWorldDir(0, -1, away);
    // Away-from-camera means the ground direction opposes the camera's offset.
    const p = offset(d);
    expect(away.x * p.x + away.y * p.z).toBeLessThan(0);
  });

  it('gives the shot its angle back on a cut, so every stage starts framed', () => {
    const d = director();
    const canonical = camAzimuth(d);
    d.orbitBy(120, 25);
    expect(camAzimuth(d)).not.toBeCloseTo(canonical, 1);
    d.cut('gameplay');
    expect(camAzimuth(d)).toBeCloseTo(canonical, 4);
  });

  it('eases the visitor rotation away while a scripted move plays', () => {
    const d = director();
    d.orbitBy(60, 0);
    d.moveTo('wide', 1.2);
    for (let i = 0; i < 200; i++) d.update(1 / 60);
    const fresh = director();
    fresh.cut('wide');
    expect(camAzimuth(d)).toBeCloseTo(camAzimuth(fresh), 1);
  });
});

describe('middle button in the input manager', () => {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const on = (t: string, f: (e: unknown) => void) => {
    handlers.set(t, [...(handlers.get(t) ?? []), f]);
  };
  const fire = (t: string, e: Record<string, unknown>) => {
    for (const f of handlers.get(t) ?? []) f({ preventDefault() {}, ...e });
  };
  const element = {
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLElement;
  const saved = { window: globalThis.window, navigator: globalThis.navigator };

  beforeEach(() => {
    handlers.clear();
    Object.defineProperty(globalThis, 'window', {
      value: { addEventListener: on, removeEventListener: () => {} },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads: () => [] },
      configurable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: saved.window, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true });
  });

  function manager(): InputManager {
    return new InputManager(element, () => ({ w: 1920, h: 1080 }));
  }

  it('rotates with held Q/E, cancels opposite keys, and stops on release', () => {
    const im = manager();
    fire('keydown', { code: 'KeyQ' });
    expect(im.update(1 / 60).orbit).toEqual({ dx: -4, dy: 0, active: true });
    expect(im.update(1 / 30).orbit.dx).toBe(-8);
    expect(im.state.move).toEqual({ x: 0, y: 0 });
    fire('keydown', { code: 'KeyE' });
    expect(im.update(1 / 60).orbit.dx).toBe(0);
    fire('keyup', { code: 'KeyQ' });
    expect(im.update(1 / 60).orbit.dx).toBe(4);
    fire('keyup', { code: 'KeyE' });
    expect(im.update(1 / 60).orbit).toEqual({ dx: 0, dy: 0, active: false });
  });

  it('combines keyboard rotation with mouse drag and clears both on blur', () => {
    const im = manager();
    fire('keydown', { code: 'KeyE' });
    fire('mousedown', { button: 1, clientX: 10, clientY: 10 });
    fire('mousemove', { clientX: 30, clientY: 15 });
    expect(im.update(1 / 60).orbit).toEqual({ dx: 24, dy: 5, active: true });
    fire('blur', {});
    expect(im.update(1 / 60).orbit).toEqual({ dx: 0, dy: 0, active: false });
  });

  it('reports the drag once and only while the button is held', () => {
    const im = manager();
    fire('mousedown', { button: 1, clientX: 100, clientY: 100 });
    fire('mousemove', { clientX: 140, clientY: 130 });
    let s = im.update(1 / 60);
    expect(s.orbit).toEqual({ dx: 40, dy: 30, active: true });
    // Consumed: the same drag must not be applied twice.
    s = im.update(1 / 60);
    expect(s.orbit.dx).toBe(0);

    fire('mouseup', { button: 1, clientX: 140, clientY: 130 });
    fire('mousemove', { clientX: 400, clientY: 400 });
    s = im.update(1 / 60);
    expect(s.orbit).toEqual({ dx: 0, dy: 0, active: false });
  });

  it('does not fire a UI click when the visitor lets go of the middle button', () => {
    const im = manager();
    fire('mousedown', { button: 1, clientX: 10, clientY: 10 });
    fire('mousemove', { clientX: 60, clientY: 10 });
    fire('mouseup', { button: 1, clientX: 60, clientY: 10 });
    expect(im.update(1 / 60).pointer.click.pressed).toBe(false);
  });

  it('still clicks on the left button', () => {
    const im = manager();
    fire('mousedown', { button: 0, clientX: 10, clientY: 10 });
    fire('mouseup', { button: 0, clientX: 10, clientY: 10 });
    expect(im.update(1 / 60).pointer.click.pressed).toBe(true);
  });

  it('drops the drag when the window loses focus mid-hold', () => {
    const im = manager();
    fire('mousedown', { button: 1, clientX: 10, clientY: 10 });
    fire('blur', {});
    fire('mousemove', { clientX: 200, clientY: 200 });
    expect(im.update(1 / 60).orbit).toEqual({ dx: 0, dy: 0, active: false });
  });
});
