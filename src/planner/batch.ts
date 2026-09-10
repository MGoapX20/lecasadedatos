import type { Plan } from './types';

/**
 * Collects plans into chunks for posting back to the main thread.
 *
 * The one rule: every plan handed to `add` is eventually handed to `emit`. The
 * worker's search loop can stop early on its time budget, and a batcher that
 * only flushed on a full chunk or the last request threw away everything found
 * since the previous flush -- while still reporting it as found. That is how
 * the AI could report a dozen routes and hand over none.
 */
export class PlanBatcher {
  private batch: Plan[] = [];

  constructor(
    private readonly emit: (plans: Plan[]) => void,
    private readonly chunk = 12,
  ) {}

  add(plan: Plan): void {
    this.batch.push(plan);
  }

  /** Send a full chunk, so the main thread can draw routes as they arrive. */
  flushIfFull(): void {
    if (this.batch.length >= this.chunk) this.flush();
  }

  /** Send whatever is left. Always call this before reporting the job done. */
  flush(): void {
    if (!this.batch.length) return;
    this.emit(this.batch);
    this.batch = [];
  }

  get pending(): number {
    return this.batch.length;
  }
}
