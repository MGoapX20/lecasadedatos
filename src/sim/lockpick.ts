import type { Rng } from '../core/rng';

/** How a single lock behaves as a mini-game. Authored per door in the level. */
export interface PickSpec {
  /** How many pins must be set before the lock opens. */
  pins: number;
  /** Width of the target zone, as a fraction of the bar. */
  zone: number;
  /** Marker travel, in bar widths per second. */
  speed: number;
}

export const DEFAULT_PICK: PickSpec = { pins: 2, zone: 0.28, speed: 0.9 };

export type PickResult = 'hit' | 'miss' | 'done';

/**
 * The lockpicking mini-game: a marker sweeps a bar and the player presses when
 * it crosses the gold zone. Deterministic and free of any rendering, so it runs
 * in tests exactly as it does on screen.
 *
 * A miss never fails the lock. It resets the current pin and makes a noise,
 * which is what gives the mini-game its stakes: guards come to look.
 */
export class LockpickGame {
  /** 0..1 position of the marker along the bar. */
  marker = 0;
  /** 0..1 start of the current target zone. */
  zoneStart = 0;
  pinsSet = 0;
  /** Fumbles so far on this lock; the first is only a warning. */
  misses = 0;
  elapsedTicks = 0;
  /** Ticks remaining on the hit/miss flash, for the HUD. */
  flashTicks = 0;
  lastResult: PickResult | 'none' = 'none';

  private dir = 1;

  constructor(
    readonly door: number,
    readonly spec: PickSpec,
    private readonly rng: Rng,
    private readonly tickHz: number,
    /** After this long the lock yields anyway; nobody should be stuck at a fair. */
    readonly graceTicks: number,
  ) {
    this.placeZone();
    this.marker = this.rng.next() * 0.3;
  }

  private placeZone(): void {
    const margin = 0.06;
    const span = Math.max(0.02, 1 - this.spec.zone - margin * 2);
    this.zoneStart = margin + this.rng.next() * span;
  }

  get zoneEnd(): number {
    return this.zoneStart + this.spec.zone;
  }

  get inZone(): boolean {
    return this.marker >= this.zoneStart && this.marker <= this.zoneEnd;
  }

  get progress(): number {
    return this.pinsSet / this.spec.pins;
  }

  /**
   * True once the lock gives up, by skill or by mercy. Mercy only rescues
   * somebody who is genuinely trying: without a single pin set, standing at a
   * door forever gets you nothing, which is what stops waiting from being a
   * third way in that beats both picking and the card.
   */
  get complete(): boolean {
    if (this.pinsSet >= this.spec.pins) return true;
    return this.pinsSet > 0 && this.elapsedTicks >= this.graceTicks;
  }

  /** Advance one simulation tick. */
  step(): void {
    this.elapsedTicks++;
    if (this.flashTicks > 0) this.flashTicks--;
    const delta = this.spec.speed / this.tickHz;
    this.marker += delta * this.dir;
    if (this.marker >= 1) {
      this.marker = 1;
      this.dir = -1;
    } else if (this.marker <= 0) {
      this.marker = 0;
      this.dir = 1;
    }
  }

  /** The player pressed. Returns what happened. */
  attempt(): PickResult {
    if (this.inZone) {
      this.pinsSet++;
      this.flashTicks = 8;
      this.lastResult = 'hit';
      if (this.pinsSet >= this.spec.pins) return 'done';
      this.placeZone();
      return 'hit';
    }
    // A miss costs the current pin and, far more importantly, makes a noise.
    this.misses++;
    this.flashTicks = 10;
    this.lastResult = 'miss';
    this.placeZone();
    return 'miss';
  }
}
