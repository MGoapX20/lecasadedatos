/// <reference lib="webworker" />
import { buildLevel, type Level } from '../level/loader';
import type { LevelJson } from '../level/schema';
import type { PatrolProgram } from '../sim/patrol';
import { bakeDangerMap, type DangerMap } from './dangerMap';
import { DiversityTracker } from './diversity';
import { PlanBatcher } from './batch';
import { buildEntryMasks } from './options';
import { horizonQuantaOf, makeCtx, planOne, type JobInput, type PlanScratch } from './planner';
import { makeIntervals, type SearchCtx } from './tea';
import type {
  DynamicSnapshot,
  Plan,
  PlanRequest,
  PlannerRequestMsg,
  PlannerResponseMsg,
} from './types';

let level: Level | null = null;
let ctx: SearchCtx | null = null;
let entryMasks: Map<string, Uint8Array> | null = null;
let currentJob = -1;

const CHUNK = 12;

function post(msg: PlannerResponseMsg, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

self.onmessage = (ev: MessageEvent<PlannerRequestMsg>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    level = buildLevel(msg.level as LevelJson);
    ctx = makeCtx(level);
    entryMasks = buildEntryMasks(level);
    post({ type: 'ready' });
    return;
  }
  if (msg.type === 'cancel') {
    if (msg.jobId === currentJob) currentJob = -1;
    return;
  }
  if (msg.type === 'plan') {
    if (!level || !ctx || !entryMasks) {
      post({ type: 'error', jobId: msg.jobId, message: 'planner not initialised' });
      return;
    }
    currentJob = msg.jobId;
    void runChunked(msg.jobId, msg.dynamic, msg.requests, msg.budgetMs);
  }
};

async function runChunked(
  jobId: number,
  dynamic: DynamicSnapshot,
  requests: PlanRequest[],
  budgetMs: number,
): Promise<void> {
  const lvl = level!;
  const searchCtx = ctx!;
  const t0 = Date.now();
  const horizonQ = horizonQuantaOf(lvl);
  const programs = dynamic.guardPrograms as PatrolProgram[];
  const withMargin = requests.some((r) => r.personality.margin === 1);

  let danger: DangerMap;
  try {
    danger = bakeDangerMap({
      level: lvl,
      programs,
      baseTick: dynamic.nowTick,
      horizonQ,
      alarmWindows: dynamic.alarmWindows,
      withMargin,
      doorLocked: dynamic.doorLocked,
    });
  } catch (err) {
    post({ type: 'error', jobId, message: String(err) });
    return;
  }
  if (currentJob !== jobId) return;

  searchCtx.heat.fill(0);
  const scratch: PlanScratch = {
    ivNormal: makeIntervals(searchCtx, danger.bits),
    ivMargin: danger.bitsMargin ? makeIntervals(searchCtx, danger.bitsMargin) : null,
    ivNaive: null,
    entryMasks: entryMasks!,
  };
  const tracker = new DiversityTracker(searchCtx.heat, lvl);
  const input: JobInput = {
    level: lvl,
    ctx: searchCtx,
    programs,
    baseTick: dynamic.nowTick,
    doorLocked: dynamic.doorLocked,
    alarmWindows: dynamic.alarmWindows,
    requests,
    budgetMs,
    keycardCells: dynamic.keycardCells,
  };

  let found = 0;
  let noPath = 0;
  let expansions = 0;
  const batcher = new PlanBatcher((plans) => post({ type: 'plans', jobId, plans }), CHUNK);

  let attempted = 0;
  for (let i = 0; i < requests.length; i++) {
    if (currentJob !== jobId) return;
    if (Date.now() - t0 > budgetMs) break;
    attempted++;
    const plan = planOne(input, danger, requests[i], scratch);
    if (plan) {
      expansions += plan.expansions;
      if (tracker.isNew(plan.signature)) tracker.accept(plan);
      batcher.add(plan);
      found++;
    } else {
      noPath++;
    }
    if (batcher.pending >= CHUNK || i === requests.length - 1) {
      batcher.flush();
      post({
        type: 'progress',
        jobId,
        done: i + 1,
        total: requests.length,
        found,
        distinct: tracker.distinct,
      });
      // Let a cancel message through between chunks.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (currentJob !== jobId) return;
  // The budget breaks the loop mid-batch: whatever it found still has to go.
  batcher.flush();
  post({
    type: 'done',
    jobId,
    stats: {
      wallMs: Date.now() - t0,
      searches: attempted,
      expansions,
      found,
      distinct: tracker.distinct,
      noPath,
    },
  });
}
