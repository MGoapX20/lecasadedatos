import { TICK_MS } from '../config';

export type TickFn = (tick: number) => void;
export type RenderFn = (alpha: number, dtMs: number) => void;

/**
 * Fixed-timestep accumulator loop. The simulation always advances in whole
 * ticks so it stays deterministic; rendering interpolates with `alpha`.
 */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private readonly maxStepsPerFrame = 6;

  constructor(
    private readonly onTick: TickFn,
    private readonly onRender: RenderFn,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      let dt = now - this.last;
      this.last = now;
      if (dt > 250) dt = 250; // tab was hidden; do not death-spiral
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < this.maxStepsPerFrame) {
        this.onTick(0);
        this.acc -= TICK_MS;
        steps++;
      }
      if (steps === this.maxStepsPerFrame) this.acc = 0;
      this.onRender(this.acc / TICK_MS, dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
