import type { LevelJson } from '../level/schema';
import type { PatrolProgram } from '../sim/patrol';
import type {
  AlarmWindow,
  Plan,
  PlanRequest,
  PlannerResponseMsg,
  PlannerStats,
} from './types';

export interface PlanResult {
  plans: Plan[];
  stats: PlannerStats;
  /**
   * True when the job was cut short because a newer one took the worker. The
   * plans are whatever had arrived, which is usually none: a caller that treats
   * this as "the planner found nothing" will quietly stand down a whole round.
   */
  cancelled: boolean;
}

export interface JobHandle {
  jobId: number;
  promise: Promise<PlanResult>;
  cancel: () => void;
}

export interface JobOptions {
  nowTick: number;
  doorLocked: Uint8Array;
  guardPrograms: PatrolProgram[];
  alarmWindows: AlarmWindow[];
  requests: PlanRequest[];
  keycardCells?: Record<string, number>;
  budgetMs?: number;
  onPlans?: (plans: Plan[]) => void;
  onProgress?: (done: number, total: number, found: number, distinct: number) => void;
}

/**
 * Main-thread handle on the planning worker. Only one job runs at a time; a new
 * job cancels the previous one, which is exactly what should happen when the
 * chief moves a guard and every plan in flight becomes stale.
 */
export class PlannerClient {
  private worker: Worker;
  private ready: Promise<void>;
  private nextJob = 1;
  private active: {
    jobId: number;
    plans: Plan[];
    opts: JobOptions;
    resolve: (v: PlanResult) => void;
    reject: (e: unknown) => void;
  } | null = null;

  constructor(levelJson: LevelJson) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise<void>((resolve, reject) => {
      const onReady = (ev: MessageEvent<PlannerResponseMsg>) => {
        if (ev.data.type === 'ready') {
          this.worker.removeEventListener('message', onReady);
          resolve();
        }
      };
      this.worker.addEventListener('message', onReady);
      this.worker.addEventListener('error', (e) => reject(e));
    });
    this.worker.addEventListener('message', (ev: MessageEvent<PlannerResponseMsg>) =>
      this.onMessage(ev.data),
    );
    this.worker.postMessage({ type: 'init', level: levelJson });
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private onMessage(msg: PlannerResponseMsg): void {
    const a = this.active;
    if (!a || (msg.type !== 'ready' && 'jobId' in msg && msg.jobId !== a.jobId)) return;
    switch (msg.type) {
      case 'plans':
        a.plans.push(...msg.plans);
        a.opts.onPlans?.(msg.plans);
        break;
      case 'progress':
        a.opts.onProgress?.(msg.done, msg.total, msg.found, msg.distinct);
        break;
      case 'done':
        this.active = null;
        a.resolve({ plans: a.plans, stats: msg.stats, cancelled: false });
        break;
      case 'error':
        this.active = null;
        a.reject(new Error(msg.message));
        break;
      default:
        break;
    }
  }

  plan(opts: JobOptions): JobHandle {
    this.cancel();
    const jobId = this.nextJob++;
    let resolve!: (v: PlanResult) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<PlanResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.active = { jobId, plans: [], opts, resolve, reject };
    void this.ready.then(() => {
      if (this.active?.jobId !== jobId) return;
      this.worker.postMessage({
        type: 'plan',
        jobId,
        dynamic: {
          nowTick: opts.nowTick,
          nowQ: 0,
          doorLocked: opts.doorLocked.slice(),
          guardPrograms: opts.guardPrograms,
          alarmWindows: opts.alarmWindows,
          keycardCells: opts.keycardCells,
        },
        requests: opts.requests,
        budgetMs: opts.budgetMs ?? 4000,
      });
    });
    return { jobId, promise, cancel: () => this.cancel(jobId) };
  }

  cancel(jobId?: number): void {
    const a = this.active;
    if (!a) return;
    if (jobId !== undefined && a.jobId !== jobId) return;
    this.worker.postMessage({ type: 'cancel', jobId: a.jobId });
    this.active = null;
    a.resolve({
      plans: a.plans,
      stats: { wallMs: 0, searches: 0, expansions: 0, found: a.plans.length, distinct: 0, noPath: 0 },
      cancelled: true,
    });
  }

  dispose(): void {
    this.cancel();
    this.worker.terminate();
  }
}
