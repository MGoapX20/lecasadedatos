/**
 * Breaking through the outside wall, which is how the money gets out.
 *
 * Hold the trigger and the bit bites; hold it too long and the motor screams
 * loud enough to bring a guard. So the game is not "can you drill" but "can you
 * drill in short bursts and wait" — which is exactly the shape of the thing it
 * stands for. A channel out of a network that moves everything at once is the
 * one that gets noticed; the patient one is the one that works.
 *
 * Pure and tick-driven like the lockpick and the fuse box, so the tests can
 * replay it and the HUD only has to read numbers.
 */
export interface DrillSpec {
  /** Ticks of actual drilling needed to get through. */
  ticksToBreak: number;
  /** Heat gained per tick while the bit is in the wall, as a fraction of full. */
  heatPerTick: number;
  /** Heat lost per tick with the trigger released. */
  coolPerTick: number;
  /** How long the bit is jammed after it overheats. */
  jamTicks: number;
  /** Progress lost when it overheats, as a fraction of the whole. */
  setback: number;
}

export const DEFAULT_DRILL: DrillSpec = {
  ticksToBreak: 160,
  heatPerTick: 1 / 70,
  coolPerTick: 1 / 45,
  jamTicks: 24,
  setback: 0.08,
};

export type DrillResult = 'idle' | 'drilling' | 'cooling' | 'jam' | 'through';

export class DrillGame {
  /** 0..1 through the wall. */
  progress = 0;
  /** 0..1; at 1 the motor screams and the bit jams. */
  heat = 0;
  jamTicks = 0;
  complete = false;
  /** The last thing that happened, for the panel to flash on. */
  lastResult: DrillResult = 'idle';
  /** Counts down so a flash lasts longer than the frame that caused it. */
  flashTicks = 0;

  constructor(readonly spec: DrillSpec = DEFAULT_DRILL) {}

  get jammed(): boolean {
    return this.jamTicks > 0;
  }

  /** One tick. `holding` is the trigger. */
  step(holding: boolean): DrillResult {
    if (this.flashTicks > 0) this.flashTicks--;
    if (this.complete) return 'through';

    if (this.jamTicks > 0) {
      this.jamTicks--;
      // A jammed bit still cools, so the wait is never wasted.
      this.heat = Math.max(0, this.heat - this.spec.coolPerTick);
      return (this.lastResult = 'jam');
    }

    if (!holding) {
      this.heat = Math.max(0, this.heat - this.spec.coolPerTick);
      return (this.lastResult = this.heat > 0 ? 'cooling' : 'idle');
    }

    this.progress = Math.min(1, this.progress + 1 / this.spec.ticksToBreak);
    this.heat += this.spec.heatPerTick;
    if (this.progress >= 1) {
      this.complete = true;
      this.flashTicks = 20;
      return (this.lastResult = 'through');
    }
    if (this.heat >= 1) {
      // Screaming metal: it stops, it slips back, and it was heard.
      this.heat = 0.55;
      this.jamTicks = this.spec.jamTicks;
      this.progress = Math.max(0, this.progress - this.spec.setback);
      this.flashTicks = 14;
      return (this.lastResult = 'jam');
    }
    return (this.lastResult = 'drilling');
  }
}
