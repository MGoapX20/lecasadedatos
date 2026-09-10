import type { Rng } from '../core/rng';

/** Wire colours, in the order they are stacked on the panel. */
export type WireColor = 'red' | 'blue' | 'yellow' | 'green';

export interface Wire {
  color: WireColor;
  /** Live wires carry the current and are the ones that have to go. */
  live: boolean;
  cut: boolean;
}

export type CutResult = 'cut' | 'short' | 'nothing' | 'done';

const COLORS: WireColor[] = ['red', 'blue', 'yellow', 'green'];

/**
 * The fuse box mini-game: a panel of wires, some of them live. Cut every live
 * wire and the building goes dark. Cut an earth wire and it shorts, which
 * sparks, makes a noise the guards hear, and jams the cutters for a moment.
 *
 * Deliberately easy. The visitor has three and a half minutes for the whole
 * exhibit and this is a texture beat, not a puzzle; the tension comes from
 * standing still in a patrolled building, not from working out which wire.
 *
 * Pure logic with no rendering, so it runs in tests exactly as on screen.
 */
export class WireCutGame {
  readonly wires: Wire[] = [];
  /** Which wire the cutters are held against. */
  cursor = 0;
  elapsedTicks = 0;
  /** Ticks the cutters stay jammed after a short. */
  shortTicks = 0;
  /** Ticks remaining on the cut/short flash, for the HUD. */
  flashTicks = 0;
  shorts = 0;
  lastResult: CutResult | 'none' = 'none';
  /** 0..1 position of the current travelling along the live wires. */
  phase = 0;

  constructor(
    /** Index into `level.json.keycards`, so a second panel cannot be confused for this one. */
    readonly item: number,
    rng: Rng,
    private readonly tickHz: number,
    /** After this long the panel gives way anyway; nobody should be stuck at a fair. */
    readonly graceTicks: number,
    count = 4,
    liveCount = 2,
  ) {
    const order = [...COLORS];
    rng.shuffle(order);
    for (let i = 0; i < count; i++) {
      this.wires.push({ color: order[i % order.length], live: false, cut: false });
    }
    // Choose which wires are live, then start the cutters on one of them so the
    // first thing the visitor sees is already the right idea.
    const idx = this.wires.map((_, i) => i);
    rng.shuffle(idx);
    for (let i = 0; i < Math.min(liveCount, count); i++) this.wires[idx[i]].live = true;
    this.cursor = idx[0];
  }

  get liveLeft(): number {
    return this.wires.filter((w) => w.live && !w.cut).length;
  }

  get anyCut(): boolean {
    return this.wires.some((w) => w.cut);
  }

  get jammed(): boolean {
    return this.shortTicks > 0;
  }

  /**
   * True once the panel is dead. Mercy only rescues somebody who is genuinely
   * trying: standing at the box without cutting anything gets you nothing.
   */
  get complete(): boolean {
    if (this.liveLeft === 0) return true;
    return this.anyCut && this.elapsedTicks >= this.graceTicks;
  }

  /** Advance one simulation tick. */
  step(): void {
    this.elapsedTicks++;
    if (this.flashTicks > 0) this.flashTicks--;
    if (this.shortTicks > 0) this.shortTicks--;
    // The remaining current runs faster as the circuit is starved.
    const speed = 0.45 + (2 - Math.min(2, this.liveLeft)) * 0.35;
    this.phase = (this.phase + speed / this.tickHz) % 1;
  }

  /** Move the cutters up or down the panel. */
  moveCursor(delta: number): void {
    const n = this.wires.length;
    this.cursor = (((this.cursor + delta) % n) + n) % n;
  }

  /** Hold the cutters against a particular wire, for a mouse click. */
  select(index: number): void {
    if (index >= 0 && index < this.wires.length) this.cursor = index;
  }

  /** The player squeezed the cutters. Returns what happened. */
  cut(): CutResult {
    if (this.jammed) return 'nothing';
    const w = this.wires[this.cursor];
    if (!w || w.cut) return 'nothing';
    if (!w.live) {
      // An earth wire: no progress, a shower of sparks and a noise.
      this.shorts++;
      this.shortTicks = Math.round(this.tickHz * 0.7);
      this.flashTicks = 10;
      this.lastResult = 'short';
      return 'short';
    }
    w.cut = true;
    this.flashTicks = 8;
    this.lastResult = this.liveLeft === 0 ? 'done' : 'cut';
    return this.lastResult;
  }
}
