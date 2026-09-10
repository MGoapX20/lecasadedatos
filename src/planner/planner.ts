import { Rng } from '../core/rng';
import { cellOf, fineToPlan, type Level } from '../level/loader';
import type { PatrolProgram } from '../sim/patrol';
import { bakeDangerMap, type DangerMap } from './dangerMap';
import { DiversityTracker, signatureOf } from './diversity';
import { buildEntryMasks } from './options';
import { createSearchCtx, makeIntervals, search, type SearchCtx, type SearchResult } from './tea';
import type { SafeIntervals } from './intervals';
import type { AlarmWindow, Plan, PlanAction, PlanNode, PlanRequest, PlannerStats } from './types';

export interface JobInput {
  level: Level;
  ctx: SearchCtx;
  programs: PatrolProgram[];
  baseTick: number;
  doorLocked: Uint8Array;
  alarmWindows: AlarmWindow[];
  requests: PlanRequest[];
  budgetMs: number;
  keycardCells?: Record<string, number>;
  maxExpansions?: number;
  heuristicWeight?: number;
  entryMasks?: Map<string, Uint8Array>;
  danger?: DangerMap;
  onPlan?: (plan: Plan) => void;
  onProgress?: (done: number, total: number, found: number, distinct: number) => void;
}

export interface JobResult {
  plans: Plan[];
  stats: PlannerStats;
  danger: DangerMap;
}

export function horizonQuantaOf(level: Level): number {
  const r = level.json.rules;
  return Math.floor((r.horizonSec * r.tickHz) / r.quantumTicks);
}

export function makeCtx(level: Level): SearchCtx {
  return createSearchCtx(level, horizonQuantaOf(level));
}

/** Turn the search's legs into the per-quantum arrays the simulation replays. */
function materialize(
  level: Level,
  nodes: PlanNode[],
  endQ: number,
  horizonQ: number,
  pickups: { id: string; q: number }[],
): { steps: Int32Array; hidden: Uint8Array; actions: PlanAction[] } {
  const len = Math.min(horizonQ, endQ + 1);
  const steps = new Int32Array(len);
  const hidden = new Uint8Array(len);
  const actions: PlanAction[] = [];
  const first = nodes[0];
  for (let q = 0; q < Math.min(len, first.arriveQ + 1); q++) {
    steps[q] = first.cell;
    hidden[q] = q < first.arriveQ ? 1 : 0;
  }
  let prev = first;
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    const from = Math.max(0, prev.arriveQ);
    const to = Math.min(len - 1, n.arriveQ);
    for (let q = from; q <= to; q++) {
      steps[q] = q === n.arriveQ ? n.cell : prev.cell;
      if (n.kind === 'portal' && q > prev.arriveQ && q < n.arriveQ) hidden[q] = 1;
    }
    if (n.kind === 'lockpick' && n.ref !== undefined) {
      actions.push({ q: prev.arriveQ, kind: 'lockpickStart', id: n.ref });
      actions.push({ q: n.arriveQ, kind: 'lockpickEnd', id: n.ref });
    } else if (n.kind === 'portal' && n.ref) {
      actions.push({ q: prev.arriveQ, kind: 'portalStart', id: n.ref });
      actions.push({ q: n.arriveQ, kind: 'portalEnd', id: n.ref });
    }
    prev = n;
  }
  for (const p of pickups) actions.push({ q: p.q, kind: 'pickup', id: p.id });
  actions.sort((a, b) => a.q - b.q);
  return { steps, hidden, actions };
}

/**
 * Plan one agent. `key` strategies run two chained searches so the detour to
 * fetch the manager's card is a real decision with a real time cost.
 */
export interface PlanScratch {
  ivNormal: SafeIntervals;
  ivMargin: SafeIntervals | null;
  /** Built on first use: the world as seen by an agent in a stolen uniform. */
  ivDisguised?: SafeIntervals | null;
  /** Built on first use: the world once the cameras are dead. */
  ivDark?: SafeIntervals | null;
  /** Built on first use: every cell safe for the whole horizon. */
  ivNaive: SafeIntervals | null;
  entryMasks: Map<string, Uint8Array>;
}

function naiveIntervals(ctx: SearchCtx, scratch: PlanScratch): SafeIntervals {
  if (!scratch.ivNaive) {
    scratch.ivNaive = makeIntervals(ctx, new Uint8Array(ctx.planCount * ctx.horizonQ));
  }
  return scratch.ivNaive;
}

/**
 * Per-agent route shaping. Rather than nudging costs (which would break the
 * interval search's optimality), each agent simply refuses to use some ground:
 * whatever earlier agents already claimed, plus a little of its own randomness.
 * The result is a swarm that tries structurally different ideas.
 */
function buildBlockMask(
  ctx: SearchCtx,
  level: Level,
  req: PlanRequest,
  entryMask: Uint8Array | null,
  useHeat: boolean,
  protectedCells: number[],
): Uint8Array | null {
  const mask = ctx.blockScratch;
  mask.fill(0);
  let any = false;
  if (entryMask) {
    mask.set(entryMask);
    any = true;
  }
  if (useHeat) {
    const rng = new Rng(req.seed ^ 0x5bf03635);
    const lambda = req.personality.heatLambda;
    const eps = req.personality.noiseEps * 0.035;
    for (let c = 0; c < mask.length; c++) {
      if (!level.pwalk[c] || mask[c]) continue;
      const heat = ctx.heat[c];
      const p = heat > 0 ? Math.min(0.92, heat * lambda) : eps;
      if (p > 0 && rng.next() < p) {
        mask[c] = 1;
        any = true;
      }
    }
  }
  for (const c of protectedCells) mask[c] = 0;
  return any ? mask : null;
}

/** Strategies that fetch something first, then go for the vault. */
const TWO_LEG = new Set(['key', 'uniform', 'power']);

/** How much of a guard's range a stolen uniform leaves him. Must match the sim. */
export const DISGUISE_RANGE_MUL = 0.3;

function variantIntervals(input: JobInput, danger: DangerMap, scratch: PlanScratch, kind: 'uniform' | 'power'): SafeIntervals {
  const bake = (guardRangeMul: number) =>
    makeIntervals(
      input.ctx,
      bakeDangerMap({
        level: input.level,
        programs: input.programs,
        baseTick: input.baseTick,
        horizonQ: danger.horizonQ,
        alarmWindows: input.alarmWindows,
        withMargin: false,
        doorLocked: input.doorLocked,
        guardRangeMul,
        cameras: false,
      }).bits,
    );
  if (kind === 'uniform') return (scratch.ivDisguised ??= bake(DISGUISE_RANGE_MUL));
  return (scratch.ivDark ??= bake(1));
}

export function planOne(
  input: JobInput,
  danger: DangerMap,
  req: PlanRequest,
  scratch: PlanScratch,
): Plan | null {
  const { level, ctx, doorLocked } = input;
  const rules = level.json.rules;
  const horizonQ = danger.horizonQ;
  const entry = level.json.entries.find((e) => e.id === req.entryId);
  if (!entry) return null;

  const startCell = req.startPlanCell ?? fineToPlan(level, cellOf(level, entry.spawn));
  const entryMask = req.startPlanCell !== undefined ? null : (scratch.entryMasks.get(req.entryId) ?? null);
  const intervals = req.naive
    ? naiveIntervals(ctx, scratch)
    : req.personality.margin === 1 && scratch.ivMargin
      ? scratch.ivMargin
      : scratch.ivNormal;

  const cellOfItem = (id: string): number => {
    const live = input.keycardCells?.[id];
    if (live !== undefined) return fineToPlan(level, live);
    const kc = level.json.keycards.find((k) => k.id === id);
    return kc ? fineToPlan(level, cellOf(level, kc.cell)) : -1;
  };
  // The vault door only ever opens for the card, so every route collects it.
  const cardDef = level.json.keycards.find((k) => (k.kind ?? 'card') === 'card');
  const cardCell = cardDef ? cellOfItem(cardDef.id) : -1;
  const itemId =
    req.keyStrategy.kind === 'uniform' || req.keyStrategy.kind === 'power'
      ? req.keyStrategy.keyId
      : undefined;
  const itemCell = itemId ? cellOfItem(itemId) : -1;
  const legs: Legs = {
    startCell,
    cardId: cardDef?.id ?? '',
    cardCell,
    itemId,
    itemCell,
  };
  const protectedCells = [startCell, level.vaultPlanCell];
  if (cardCell >= 0) protectedCells.push(cardCell);
  if (itemCell >= 0) protectedCells.push(itemCell);

  const attempt = (useHeat: boolean): Plan | null => {
    const blocked = buildBlockMask(ctx, level, req, entryMask, useHeat, protectedCells);
    const common = {
      intervals,
      doorLocked,
      blocked,
      moveQuanta: req.moveQuanta,
      maxExpansions: input.maxExpansions ?? 120_000,
      heuristicWeight: input.heuristicWeight ?? 1.0,
    };
    return runLegs(input, danger, req, common, legs, scratch);
  };
  return attempt(true) ?? attempt(false);
}

interface Legs {
  startCell: number;
  cardId: string;
  cardCell: number;
  itemId?: string;
  itemCell: number;
}

/**
 * Walk the route in order: the optional item (a uniform, the fuse box), then
 * the manager's card, then the vault. The card leg is not optional because the
 * vault door has no lock to pick, which is the one control that always holds.
 */
function runLegs(
  input: JobInput,
  danger: DangerMap,
  req: PlanRequest,
  common: Omit<Parameters<typeof search>[1], 'startCell' | 'startQ' | 'goalCell' | 'goalHoldQ' | 'keyHeld' | 'allowLockpick'>,
  legs: Legs,
  scratch: PlanScratch,
): Plan | null {
  const { level, ctx } = input;
  const rules = level.json.rules;
  const horizonQ = danger.horizonQ;
  const kind = req.keyStrategy.kind;
  if (legs.cardCell < 0 || !legs.cardId) return null;

  let nodes: PlanNode[] = [];
  let cur = legs.startCell;
  let q = req.startDelayQ;
  let cost = 0;
  let expansions = 0;
  const pickups: { id: string; q: number }[] = [];
  let intervals = common.intervals;
  // 'none' is the agent who brought no tools: no key of its own and no picks.
  const allowLockpick = kind !== 'none';

  const leg = (goalCell: number, goalHoldQ: number, keyHeld: string | null): SearchResult | null =>
    search(ctx, {
      ...common,
      intervals,
      startCell: cur,
      startQ: q,
      goalCell,
      goalHoldQ,
      keyHeld,
      allowLockpick,
    });

  const take = (res: SearchResult): void => {
    nodes = nodes.length ? [...nodes, ...res.nodes.slice(1)] : res.nodes;
    cur = res.nodes[res.nodes.length - 1].cell;
    q = res.endQ;
    cost += res.cost;
    expansions += res.expansions;
  };

  // The uniform or the fuse box, when this strategy uses one. Taking it changes
  // what the rest of the route has to avoid.
  if (legs.itemId && legs.itemCell >= 0) {
    const first = leg(legs.itemCell, 0, null);
    if (!first) return null;
    take(first);
    pickups.push({ id: legs.itemId, q });
    intervals = variantIntervals(input, danger, scratch, kind === 'uniform' ? 'uniform' : 'power');
  }

  if (cur !== legs.cardCell) {
    const toCard = leg(legs.cardCell, 0, null);
    if (!toCard) return null;
    take(toCard);
  }
  pickups.push({ id: legs.cardId, q });

  const toVault = leg(level.vaultPlanCell, 0, legs.cardId);
  if (!toVault) return null;
  take(toVault);
  const endQ = q;

  const { steps, hidden, actions } = materialize(level, nodes, endQ, horizonQ, pickups);
  return {
    agentId: req.agentId,
    request: req,
    startQ: danger.baseQ,
    endQ,
    nodes,
    steps,
    hidden,
    actions,
    signature: signatureOf(level, req.entryId, req.keyStrategy.kind, nodes),
    cost,
    expansions,
    reachedVault: true,
  };
}

/**
 * Plan for a whole swarm. Runs inside a worker; the caller receives plans as
 * they are found so the first agents can start walking before the last one is
 * finished thinking.
 */
export function runJob(input: JobInput): JobResult {
  const t0 = Date.now();
  const { level, ctx, requests } = input;
  const horizonQ = horizonQuantaOf(level);
  const withMargin = requests.some((r) => r.personality.margin === 1);
  const danger =
    input.danger ??
    bakeDangerMap({
      level,
      programs: input.programs,
      baseTick: input.baseTick,
      horizonQ,
      alarmWindows: input.alarmWindows,
      withMargin,
      doorLocked: input.doorLocked,
    });
  const entryMasks = input.entryMasks ?? buildEntryMasks(level);
  ctx.heat.fill(0);
  const scratch: PlanScratch = {
    ivNormal: makeIntervals(ctx, danger.bits),
    ivMargin: danger.bitsMargin ? makeIntervals(ctx, danger.bitsMargin) : null,
    ivNaive: null,
    entryMasks,
  };
  const tracker = new DiversityTracker(ctx.heat, level);
  const plans: Plan[] = [];
  let expansions = 0;
  let noPath = 0;

  for (let i = 0; i < requests.length; i++) {
    if (Date.now() - t0 > input.budgetMs) break;
    const plan = planOne(input, danger, requests[i], scratch);
    if (!plan) {
      noPath++;
    } else {
      expansions += plan.expansions;
      if (tracker.isNew(plan.signature)) {
        tracker.accept(plan);
      }
      plans.push(plan);
      input.onPlan?.(plan);
    }
    if ((i & 7) === 7) {
      input.onProgress?.(i + 1, requests.length, plans.length, tracker.distinct);
    }
  }

  input.onProgress?.(requests.length, requests.length, plans.length, tracker.distinct);
  return {
    plans,
    danger,
    stats: {
      wallMs: Date.now() - t0,
      searches: requests.length,
      expansions,
      found: plans.length,
      distinct: tracker.distinct,
      noPath,
    },
  };
}
