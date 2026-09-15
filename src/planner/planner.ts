import { Rng } from '../core/rng';
import { cellOf, fineToPlan, type Level } from '../level/loader';
import type { PatrolProgram } from '../sim/patrol';
import { bakeDangerMap, type DangerMap } from './dangerMap';
import { DiversityTracker, signatureOf } from './diversity';
import { buildEntryMasks } from './options';
import { truckWindows, type TruckWindow } from './truck';
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
  cameras?: boolean;
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
  truckWindows?: Map<number, TruckWindow[]>;
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
  coverageCuts = 2,
): Uint8Array | null {
  const mask = ctx.blockScratch;
  mask.fill(0);
  let any = false;
  if (entryMask) {
    mask.set(entryMask);
    any = true;
  }
  if (useHeat && req.coverage) {
    // Cut a few previously used corridors, not most of the reachable floor.
    // Dense random masks used to fail, then fall back to identical shortest paths.
    const rng = new Rng(req.seed ^ 0x73a4f021);
    const distance = (a: number, b: number) => Math.max(Math.abs(a % level.pw - b % level.pw),
      Math.abs(Math.floor(a / level.pw) - Math.floor(b / level.pw)));
    const keep = (c: number) => protectedCells.some(p => distance(c, p) <= 2);
    const entrance = level.json.entries.find(e => e.id === req.entryId);
    const entranceDoor = entrance?.doorId ? level.doorIndex.get(entrance.doorId) : undefined;
    const anchors: { cell: number; score: number }[] = [];
    for (let c = 0; c < mask.length; c++) {
      if (!level.pwalk[c] || !level.pindoor[c] || mask[c] || keep(c) || ctx.heat[c] <= 0) continue;
      if (entranceDoor !== undefined && level.pdoorAt[c] === entranceDoor) continue;
      anchors.push({ cell: c, score: ctx.heat[c] * (0.4 + rng.next()) });
    }
    anchors.sort((a, b) => b.score - a.score || a.cell - b.cell);
    const cuts: number[] = [];
    const visited = new Uint8Array(level.planCount), queue = new Int32Array(level.planCount);
    // Mandatory chokepoints cannot be diversified. Leave them usable and spend
    // the avoidance budget on corridors which actually have another way around.
    const connected = () => {
      visited.fill(0);
      let head = 0, tail = 1; queue[0] = protectedCells[0]; visited[queue[0]] = 1;
      const offer = (cell: number) => {
        if (cell < 0 || visited[cell] || mask[cell]) return;
        visited[cell] = 1; queue[tail++] = cell;
      };
      while (head < tail) {
        const c = queue[head++];
        for (let i = 0; i < 8; i++) offer(ctx.nbr[c * 8 + i]);
        for (const portal of ctx.portalsByCell.get(c) ?? []) offer(ctx.portalList[portal].toPlan);
      }
      return protectedCells.every(c => !!visited[c]);
    };
    let tried = 0;
    for (const anchor of anchors) {
      if (cuts.some(c => distance(c, anchor.cell) < 6)) continue;
      if (++tried > 12) break;
      const changed: number[] = [];
      const door = level.pdoorAt[anchor.cell];
      for (let c = 0; c < mask.length; c++) {
        if (keep(c)) continue;
        if (!mask[c] && (door >= 0 ? level.pdoorAt[c] === door : distance(c, anchor.cell) <= 1)) {
          mask[c] = 1; changed.push(c);
        }
      }
      if (!connected()) { for (const c of changed) mask[c] = 0; continue; }
      cuts.push(anchor.cell);
      any = true;
      if (cuts.length >= coverageCuts) break;
    }
  } else if (useHeat) {
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
        cameras: kind === 'power' ? false : input.cameras,
        disguised: kind === 'uniform',
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
  const { level, ctx } = input;
  const heldKeys = new Set(req.heldKeys);
  const doorLocked = req.pickedDoors?.length ? input.doorLocked.slice() : input.doorLocked;
  for (const door of req.pickedDoors ?? []) doorLocked[door] = 0;
  const rules = level.json.rules;
  const horizonQ = danger.horizonQ;
  const entry = level.json.entries.find((e) => e.id === req.entryId);
  if (!entry) return null;

  const startCell = req.startPlanCell ?? req.launchPlanCell ?? fineToPlan(level, cellOf(level, entry.spawn));
  const keepEntry = req.startPlanCell !== undefined && req.coverage && !level.pindoor[startCell];
  let entryMask = req.startPlanCell !== undefined && !keepEntry ? null : (scratch.entryMasks.get(req.entryId) ?? null);
  const disguised = level.json.keycards.some(k => k.kind === 'uniform' && heldKeys.has(k.id));
  const intervals = req.naive
    ? naiveIntervals(ctx, scratch)
    : disguised
      ? variantIntervals(input, danger, scratch, 'uniform')
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
  const needsItem = itemId && !heldKeys.has(itemId) && !(req.keyStrategy.kind === 'power' && input.cameras === false);
  const itemCell = needsItem ? cellOfItem(itemId) : -1;
  const legs: Legs = {
    startCell,
    cardId: cardDef?.id ?? '',
    cardCell,
    itemId: needsItem ? itemId : undefined,
    itemCell,
    hasCard: !!cardDef && heldKeys.has(cardDef.id),
  };
  const protectedCells = [startCell, level.vaultPlanCell];
  if (cardCell >= 0) protectedCells.push(cardCell);
  if (itemCell >= 0) protectedCells.push(itemCell);

  const attempt = (useHeat: boolean, cuts = 2): Plan | null => {
    const blocked = buildBlockMask(ctx, level, req, entryMask, useHeat, protectedCells, cuts);
    const common = {
      intervals,
      doorLocked,
      truckWindows: scratch.truckWindows ??= truckWindows(level, danger.baseQ * rules.quantumTicks, horizonQ),
      blocked,
      moveQuanta: req.moveQuanta,
      maxExpansions: input.maxExpansions ?? 120_000,
      heuristicWeight: input.heuristicWeight ?? 1.0,
    };
    return runLegs(input, danger, req, common, legs, scratch);
  };
  const shaped = () => attempt(true) ?? (req.coverage ? attempt(true, 1) : null) ?? attempt(false);
  const plan = shaped();
  if (plan) return plan;
  // A safe truck ride is still a way into the building when the current patrol
  // timetable offers no complete vault route. Keep that foothold and replan on
  // unloading, without claiming a vault breach or bypassing any detection rules.
  if (req.coverage && entry.kind === 'truck' && !level.pindoor[startCell]) {
    const portal = level.portals.find(p => p.truckStop !== undefined);
    if (portal) {
      const result = search(ctx, { intervals, startCell, startQ: req.startDelayQ,
        goalCell: portal.toPlan, goalHoldQ: 0, moveQuanta: req.moveQuanta,
        keyHeld: null, allowLockpick: false, doorLocked,
        blocked: scratch.entryMasks.get(req.entryId) ?? null,
        maxExpansions: input.maxExpansions ?? 120_000,
        truckWindows: scratch.truckWindows });
      if (result?.nodes.some(n => n.kind === 'portal' && n.ref === portal.def.id)) {
        return { agentId: req.agentId, request: req, startQ: danger.baseQ, endQ: result.endQ,
          nodes: result.nodes, ...materialize(level, result.nodes, result.endQ, horizonQ, []),
          signature: signatureOf(level, req.entryId, 'truck-entry', result.nodes),
          cost: result.cost, expansions: result.expansions, reachedVault: false, replanOnArrival: true };
      }
    }
  }
  if (!keepEntry) return null;
  // An outside replan keeps its entrance assignment if it still works. If the
  // chief seals that approach, let the agent recover through another entrance.
  entryMask = null;
  return shaped();
}

interface Legs {
  startCell: number;
  cardId: string;
  cardCell: number;
  itemId?: string;
  itemCell: number;
  hasCard: boolean;
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
    const first = leg(legs.itemCell, 0, legs.hasCard ? legs.cardId : null);
    if (!first) return null;
    take(first);
    pickups.push({ id: legs.itemId, q });
    intervals = variantIntervals(input, danger, scratch, kind === 'uniform' ? 'uniform' : 'power');
  }

  if (!legs.hasCard && cur !== legs.cardCell) {
    const toCard = leg(legs.cardCell, 0, null);
    if (!toCard) return null;
    take(toCard);
  }
  if (!legs.hasCard) pickups.push({ id: legs.cardId, q });

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
      cameras: input.cameras,
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

  const searchStarted = Date.now();
  let attempted = 0;
  for (let i = 0; i < requests.length; i++) {
    if (attempted > 0 && Date.now() - searchStarted > input.budgetMs) break;
    attempted++;
    const plan = planOne(input, danger, requests[i], scratch);
    if (!plan) {
      noPath++;
    } else {
      expansions += plan.expansions;
      if (plan.request.coverage || tracker.isNew(plan.signature)) {
        tracker.accept(plan);
      }
      plans.push(plan);
      input.onPlan?.(plan);
    }
    if ((i & 7) === 7) {
      input.onProgress?.(i + 1, requests.length, plans.length, tracker.distinct);
    }
  }

  input.onProgress?.(attempted, requests.length, plans.length, tracker.distinct);
  return {
    plans,
    danger,
    stats: {
      wallMs: Date.now() - t0,
      searches: attempted,
      expansions,
      found: plans.length,
      distinct: tracker.distinct,
      noPath,
    },
  };
}
