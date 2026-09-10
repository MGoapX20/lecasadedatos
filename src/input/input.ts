export interface Edge {
  down: boolean;
  pressed: boolean;
  released: boolean;
}

export type DeviceKind = 'keyboard' | 'mouse' | 'gamepad';

export interface PointerState {
  x: number;
  y: number;
  click: Edge;
  moved: boolean;
  /** True while the virtual gamepad cursor is driving the pointer. */
  virtual: boolean;
}

/** View rotation from middle-drag or Q/E, in equivalent pixels this frame. */
export interface OrbitDrag {
  dx: number;
  dy: number;
  active: boolean;
}

export interface InputState {
  move: { x: number; y: number };
  confirm: Edge;
  cancel: Edge;
  alarm: Edge;
  anyButton: Edge;
  /** A deliberate press to begin or advance: Space, or the gamepad's A. */
  start: Edge;
  lang: Edge;
  pointer: PointerState;
  orbit: OrbitDrag;
  lastDevice: DeviceKind;
}

function edge(): Edge {
  return { down: false, pressed: false, released: false };
}

function stepEdge(e: Edge, down: boolean): void {
  e.pressed = down && !e.down;
  e.released = !down && e.down;
  e.down = down;
}

const MIDDLE = 1;
const KEY_ORBIT_PIXELS_PER_SECOND = 240;

const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

/**
 * One input vocabulary for keyboard, mouse and gamepad. Screens only ever read
 * the unified state, so a visitor can pick up whichever device is in front of
 * them and every control still means the same thing.
 */
export class InputManager {
  readonly state: InputState = {
    move: { x: 0, y: 0 },
    confirm: edge(),
    cancel: edge(),
    alarm: edge(),
    anyButton: edge(),
    start: edge(),
    lang: edge(),
    pointer: { x: 0, y: 0, click: edge(), moved: false, virtual: false },
    orbit: { dx: 0, dy: 0, active: false },
    lastDevice: 'keyboard',
  };

  private keys = new Set<string>();
  private mouseDown = false;
  private mouseClickQueued = false;
  private orbiting = false;
  private orbitX = 0;
  private orbitY = 0;
  private orbitDx = 0;
  private orbitDy = 0;
  private padIndex: number | null = null;
  private padConnectedAt = 0;
  private cursorSpeed = 900;
  private onPresenter?: () => void;
  private onMenu?: () => void;
  private listeners: (() => void)[] = [];
  padDisconnected = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly getSize: () => { w: number; h: number },
  ) {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'KeyP' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        this.onPresenter?.();
        return;
      }
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        this.onMenu?.();
      }
      if (!e.repeat) this.state.lastDevice = 'keyboard';
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const mm = (e: MouseEvent) => {
      if (this.orbiting) {
        this.orbitDx += e.clientX - this.orbitX;
        this.orbitDy += e.clientY - this.orbitY;
        this.orbitX = e.clientX;
        this.orbitY = e.clientY;
      }
      const r = this.element.getBoundingClientRect();
      this.state.pointer.x = e.clientX - r.left;
      this.state.pointer.y = e.clientY - r.top;
      this.state.pointer.moved = true;
      this.state.pointer.virtual = false;
      this.state.lastDevice = 'mouse';
    };
    const md = (e: MouseEvent) => {
      this.state.lastDevice = 'mouse';
      // Mouse events are bound to the window so a drag can finish off-canvas,
      // which means a press on a HUD control (the alarm chip, a fuse-box wire)
      // would otherwise also register as a click on the world behind it and
      // walk the player away from the thing they just clicked. Anything that
      // is a real element other than the canvas belongs to the HUD.
      const onEl = e.target as (Element & { closest?: unknown }) | null | undefined;
      if (onEl && onEl !== this.element && typeof onEl.closest === 'function') return;
      if (e.button === MIDDLE) {
        // Hold the middle button to swing the view; suppress Chrome's autoscroll.
        e.preventDefault();
        this.orbiting = true;
        this.orbitX = e.clientX;
        this.orbitY = e.clientY;
        return;
      }
      this.mouseDown = true;
    };
    const mu = (e: MouseEvent) => {
      if (e.button === MIDDLE) {
        this.orbiting = false;
        return;
      }
      if (this.mouseDown) this.mouseClickQueued = true;
      this.mouseDown = false;
    };
    // A drag that ends off-window (or an alt-tab) must not leave the view stuck.
    const endOrbit = () => {
      this.orbiting = false;
      this.orbitDx = 0;
      this.orbitDy = 0;
      this.keys.clear();
    };
    const aux = (e: MouseEvent) => {
      if (e.button === MIDDLE) e.preventDefault();
    };
    const ctx = (e: Event) => e.preventDefault();
    const gpc = (e: GamepadEvent) => {
      this.padIndex = e.gamepad.index;
      this.padConnectedAt = performance.now();
      this.padDisconnected = false;
    };
    const gpd = () => {
      this.padIndex = null;
      this.padDisconnected = true;
    };
    const touch = (e: TouchEvent) => {
      const t = e.touches[0] ?? e.changedTouches[0];
      if (!t) return;
      const r = this.element.getBoundingClientRect();
      this.state.pointer.x = t.clientX - r.left;
      this.state.pointer.y = t.clientY - r.top;
      this.state.pointer.virtual = false;
      this.state.lastDevice = 'mouse';
      if (e.type === 'touchend') this.mouseClickQueued = true;
    };

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('auxclick', aux);
    window.addEventListener('blur', endOrbit);
    window.addEventListener('contextmenu', ctx);
    window.addEventListener('gamepadconnected', gpc as EventListener);
    window.addEventListener('gamepaddisconnected', gpd as EventListener);
    element.addEventListener('touchstart', touch, { passive: true });
    element.addEventListener('touchmove', touch, { passive: true });
    element.addEventListener('touchend', touch, { passive: true });
    this.listeners.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('auxclick', aux);
      window.removeEventListener('blur', endOrbit);
      window.removeEventListener('contextmenu', ctx);
      window.removeEventListener('gamepadconnected', gpc as EventListener);
      window.removeEventListener('gamepaddisconnected', gpd as EventListener);
    });

    const { w, h } = getSize();
    this.state.pointer.x = w / 2;
    this.state.pointer.y = h / 2;
  }

  onPresenterHotkey(fn: () => void): void {
    this.onPresenter = fn;
  }

  onMenuKey(fn: () => void): void {
    this.onMenu = fn;
  }

  /** Gamepad Start, so the menu is reachable without a keyboard. */
  private startWasDown = false;
  pollMenuButton(): boolean {
    const p = this.pad();
    const down = !!p?.buttons[9]?.pressed;
    const edge = down && !this.startWasDown;
    this.startWasDown = down;
    return edge;
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.padIndex !== null && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p) return p;
    return null;
  }

  update(dtSec: number): InputState {
    const s = this.state;
    let mx = 0;
    let my = 0;
    for (const [code, [dx, dy]] of Object.entries(MOVE_KEYS)) {
      if (this.keys.has(code)) {
        mx += dx;
        my += dy;
      }
    }
    let startBtn = this.keys.has('Space');
    let confirm = this.keys.has('Enter') || this.keys.has('Space');
    let cancel = this.keys.has('Escape') || this.keys.has('Backspace');
    let alarmBtn = this.keys.has('KeyX');
    let langBtn = this.keys.has('KeyL');
    let anyKey = this.keys.size > 0;

    const p = this.pad();
    let padCursor = 0;
    let padCursorY = 0;
    if (p) {
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      const dz = 0.28;
      const gx = Math.abs(ax) > dz ? ax : 0;
      const gy = Math.abs(ay) > dz ? ay : 0;
      if (gx || gy) {
        mx += gx;
        my += gy;
        padCursor = gx;
        padCursorY = gy;
        s.lastDevice = 'gamepad';
      }
      const b = (i: number) => !!p.buttons[i]?.pressed;
      if (b(12)) my -= 1;
      if (b(13)) my += 1;
      if (b(14)) mx -= 1;
      if (b(15)) mx += 1;
      if (b(0)) {
        confirm = true;
        startBtn = true;
      }
      if (b(1)) cancel = true;
      if (b(2)) alarmBtn = true;
      if (b(3)) langBtn = true;
      const anyPad = p.buttons.some((btn) => btn.pressed);
      if (anyPad) {
        anyKey = true;
        s.lastDevice = 'gamepad';
      }
      // Ignore the first instant after connection; some pads report noise.
      if (performance.now() - this.padConnectedAt < 250) {
        anyKey = this.keys.size > 0;
      }
    }

    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    s.move.x = mx;
    s.move.y = my;

    if (padCursor || padCursorY) {
      const { w, h } = this.getSize();
      s.pointer.x = clamp(s.pointer.x + padCursor * this.cursorSpeed * dtSec, 0, w);
      s.pointer.y = clamp(s.pointer.y + padCursorY * this.cursorSpeed * dtSec, 0, h);
      s.pointer.virtual = true;
    }

    stepEdge(s.confirm, confirm);
    stepEdge(s.cancel, cancel);
    stepEdge(s.alarm, alarmBtn);
    stepEdge(s.lang, langBtn);
    stepEdge(s.anyButton, anyKey || this.mouseDown || this.mouseClickQueued);
    stepEdge(s.start, startBtn);
    const click = this.mouseClickQueued || (s.pointer.virtual && s.confirm.pressed);
    stepEdge(s.pointer.click, click);
    s.pointer.click.pressed = click;
    this.mouseClickQueued = false;
    s.pointer.moved = false;
    const keyOrbit = Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
    s.orbit.dx = this.orbitDx + keyOrbit * KEY_ORBIT_PIXELS_PER_SECOND * dtSec;
    s.orbit.dy = this.orbitDy;
    s.orbit.active = this.orbiting || keyOrbit !== 0;
    this.orbitDx = 0;
    this.orbitDy = 0;
    return s;
  }

  /** True when nothing at all has been touched, used by the idle watchdog. */
  get idle(): boolean {
    return (
      this.keys.size === 0 &&
      !this.mouseDown &&
      !this.orbiting &&
      !this.pad()?.buttons.some((b) => b.pressed)
    );
  }

  dispose(): void {
    for (const off of this.listeners) off();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
