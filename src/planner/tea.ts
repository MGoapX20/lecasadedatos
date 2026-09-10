import { MinHeap } from '../core/heap';
import type { Level, RuntimePortal } from '../level/loader';
import { buildIntervals, intervalFrom, type SafeIntervals } from './intervals';
import type { PlanNode } from './types';

const VIA_MOVE = 0;
const VIA_LOCKPICK = 1;
const VIA_PORTAL = 2;

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Reusable state for time-aware searches. Allocated once per worker and shared
 * by every agent in a job, so planning 100 routes does not allocate 100 large
 * typed arrays.
 */
export interface SearchCtx {
  level: Level;
  planCount: number;
  horizonQ: number;
  /** 8 neighbour plan cells per cell, -1 where a move is impossible. */
  nbr: Int32Array;
  portalList: RuntimePortal[];
  portalsByCell: Map<number, number[]>;
  /** Per-agent cost shaping. */
  heat: Float64Array;
  noise: Float64Array;
  blockScratch: Uint8Array;
  /** Interval-indexed search arrays, resized when a new danger map arrives. */
  gArrive: Int32Array;
  parent: Int32Array;
  via: Int8Array;
  viaRef: Int32Array;
  depart: Int32Array;
  stamp: Uint32Array;
  gen: number;
  heap: MinHeap;
}

export function createSearchCtx(level: Level, horizonQ: number): SearchCtx {
  const planCount = level.planCount;
  const nbr = new Int32Array(planCount * 8).fill(-1);
  for (let y = 0; y < level.ph; y++) {
    for (let x = 0; x < level.pw; x++) {
      const c = y * level.pw + x;
      if (!level.pwalk[c]) continue;
      for (let n = 0; n < 8; n++) {
        const nx = x + DX[n];
        const ny = y + DY[n];
        if (nx < 0 || ny < 0 || nx >= level.pw || ny >= level.ph) continue;
        const ni = ny * level.pw + nx;
        if (!level.pwalk[ni]) continue;
        if (DX[n] !== 0 && DY[n] !== 0) {
          if (!level.pwalk[y * level.pw + nx] || !level.pwalk[ny * level.pw + x]) continue;
        }
        nbr[c * 8 + n] = ni;
      }
    }
  }
  const portalList: RuntimePortal[] = [];
  const portalsByCell = new Map<number, number[]>();
  for (const [cell, list] of level.portalsFrom) {
    const ids: number[] = [];
    for (const p of list) {
      ids.push(portalList.length);
      portalList.push(p);
    }
    portalsByCell.set(cell, ids);
  }
  const empty = new Int32Array(0);
  return {
    level,
    planCount,
    horizonQ,
    nbr,
    portalList,
    portalsByCell,
    heat: new Float64Array(planCount),
    noise: new Float64Array(planCount),
    blockScratch: new Uint8Array(planCount),
    gArrive: empty,
    parent: empty,
    via: new Int8Array(0),
    viaRef: empty,
    depart: empty,
    stamp: new Uint32Array(0),
    gen: 0,
    heap: new MinHeap(4096),
  };
}

/** Grow the per-state arrays to cover a freshly built interval table. */
export function ensureCapacity(ctx: SearchCtx, n: number): void {
  if (ctx.gArrive.length >= n) return;
  ctx.gArrive = new Int32Array(n);
  ctx.parent = new Int32Array(n);
  ctx.via = new Int8Array(n);
  ctx.viaRef = new Int32Array(n);
  ctx.depart = new Int32Array(n);
  ctx.stamp = new Uint32Array(n);
  ctx.gen = 0;
}

export function makeIntervals(ctx: SearchCtx, danger: Uint8Array): SafeIntervals {
  const iv = buildIntervals(danger, ctx.level.pwalk, ctx.planCount, ctx.horizonQ);
  ensureCapacity(ctx, iv.count);
  return iv;
}

export interface SearchOpts {
  intervals: SafeIntervals;
  startCell: number;
  startQ: number;
  goalCell: number;
  goalHoldQ: number;
  moveQuanta: number;
  keyHeld: string | null;
  allowLockpick: boolean;
  doorLocked: Uint8Array;
  /** Plan cells this agent must not use. */
  blocked: Uint8Array | null;
  maxExpansions: number;
  heuristicWeight?: number;
}

export interface SearchResult {
  nodes: PlanNode[];
  endQ: number;
  cost: number;
  expansions: number;
}

function chebyshev(pw: number, a: number, b: number): number {
  const ax = a % pw;
  const ay = (a / pw) | 0;
  const bx = b % pw;
  const by = (b / pw) | 0;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Safe Interval Path Planning over the plan grid. Guard vision is a time-varying
 * obstacle; waiting for a patrol to pass is a first-class move, and the state
 * space stays small because a cell has a handful of safe windows rather than
 * hundreds of time slices.
 */
export function search(ctx: SearchCtx, o: SearchOpts): SearchResult | null {
  const iv = o.intervals;
  const { nbr, heap, level } = ctx;
  const { doorLocked, moveQuanta: M } = o;
  const gen = ++ctx.gen;
  const gArrive = ctx.gArrive;
  const parent = ctx.parent;
  const via = ctx.via;
  const viaRef = ctx.viaRef;
  const depart = ctx.depart;
  const stamp = ctx.stamp;
  const pw = level.pw;
  const hw = (o.heuristicWeight ?? 1) * M;
  heap.clear();
  let expansions = 0;

  if (!level.pwalk[o.startCell]) return null;
  if (o.blocked && o.blocked[o.startCell]) return null;

  const startIv = intervalFrom(iv, o.startCell, o.startQ);
  if (startIv < 0) return null;
  const startArrive = Math.max(o.startQ, iv.lo[startIv]);
  if (startArrive > iv.hi[startIv]) return null;

  stamp[startIv] = gen;
  gArrive[startIv] = startArrive;
  parent[startIv] = -1;
  via[startIv] = -1;
  depart[startIv] = startArrive;
  heap.push(startArrive + chebyshev(pw, o.startCell, o.goalCell) * hw, startIv);

  /** -1 blocked, 0 free, >0 quanta needed to pick the lock. */
  const doorCost = (cell: number): number => {
    const di = level.pdoorAt[cell];
    if (di < 0) return 0;
    if (!doorLocked[di]) return 0;
    const door = level.doors[di];
    if (o.keyHeld && door.keyId === o.keyHeld) return 0;
    if (door.pickable === false) return -1;
    if (o.allowLockpick && door.lockpickQuanta) return door.lockpickQuanta;
    return -1;
  };

  let goalState = -1;
  const stateCell = iv.cell;

  /** Is `cell` continuously safe from t0 to t1 inclusive? */
  const safeSpan = (cell: number, t0: number, t1: number): boolean => {
    const a = iv.offset[cell];
    const b = iv.offset[cell + 1];
    for (let i = a; i < b; i++) {
      if (iv.lo[i] <= t0 && iv.hi[i] >= t1) return true;
    }
    return false;
  };

  while (heap.size > 0) {
    const cur = heap.pop();
    if (stamp[cur] !== gen) continue;
    const c = stateCell[cur];
    const t = gArrive[cur];
    const hiC = iv.hi[cur];

    if (c === o.goalCell && t + o.goalHoldQ <= hiC) {
      goalState = cur;
      break;
    }
    if (++expansions > o.maxExpansions) break;

    const relax = (state: number, arrive: number, dep: number, kind: number, ref: number) => {
      if (stamp[state] === gen && gArrive[state] <= arrive) return;
      stamp[state] = gen;
      gArrive[state] = arrive;
      parent[state] = cur;
      via[state] = kind;
      viaRef[state] = ref;
      depart[state] = dep;
      heap.push(arrive + chebyshev(pw, stateCell[state], o.goalCell) * hw, state);
    };

    const base = c * 8;
    for (let n = 0; n < 8; n++) {
      const ncell = nbr[base + n];
      if (ncell < 0) continue;
      if (o.blocked && o.blocked[ncell]) continue;
      const lock = doorCost(ncell);
      if (lock < 0) continue;
      const total = lock + M;
      const a = iv.offset[ncell];
      const b = iv.offset[ncell + 1];
      // A diagonal step passes through the shared corner, so the two cells
      // either side of it must be clear too. Without this the agent clips the
      // corner of a cone the plan believed it had avoided.
      const diagonal = n >= 4;
      let orthA = -1;
      let orthB = -1;
      if (diagonal) {
        const cxp = c % pw;
        const cyp = (c / pw) | 0;
        orthA = cyp * pw + (cxp + DX[n]);
        orthB = (cyp + DY[n]) * pw + cxp;
      }
      for (let j = a; j < b; j++) {
        // Stay put until `dep`, spend `lock` quanta picking, then `M` moving.
        const depMin = Math.max(t, iv.lo[j] - lock);
        const depMax = Math.min(hiC - total, iv.hi[j] - total);
        if (depMin > depMax) continue;
        const arrive = depMin + total;
        if (diagonal && (!safeSpan(orthA, depMin, arrive) || !safeSpan(orthB, depMin, arrive))) {
          continue;
        }
        relax(j, arrive, depMin, lock > 0 ? VIA_LOCKPICK : VIA_MOVE, lock > 0 ? level.pdoorAt[ncell] : n);
      }
    }

    const portals = ctx.portalsByCell.get(c);
    if (portals) {
      for (const pi of portals) {
        const p = ctx.portalList[pi];
        if (o.blocked && o.blocked[p.toPlan]) continue;
        const a = iv.offset[p.toPlan];
        const b = iv.offset[p.toPlan + 1];
        for (let j = a; j < b; j++) {
          // Nobody can see you inside a vent, so only the two mouths must be safe.
          const depMin = Math.max(t, iv.lo[j] - p.quanta);
          const depMax = Math.min(hiC, iv.hi[j] - p.quanta);
          if (depMin > depMax) continue;
          relax(j, depMin + p.quanta, depMin, VIA_PORTAL, pi);
        }
      }
    }
  }

  if (goalState < 0) return null;

  const chain: number[] = [];
  for (let s = goalState; s !== -1; s = parent[s]) chain.push(s);
  chain.reverse();

  const nodes: PlanNode[] = [
    { cell: stateCell[chain[0]], arriveQ: gArrive[chain[0]], kind: 'start' },
  ];
  for (let i = 1; i < chain.length; i++) {
    const s = chain[i];
    const prev = chain[i - 1];
    const prevCell = stateCell[prev];
    const cell = stateCell[s];
    const dep = depart[s];
    const arrive = gArrive[s];
    if (dep > gArrive[prev]) {
      nodes.push({ cell: prevCell, arriveQ: dep, kind: 'wait' });
    }
    if (via[s] === VIA_LOCKPICK) {
      const doorIdx = viaRef[s];
      const pickEnd = arrive - o.moveQuanta;
      nodes.push({ cell: prevCell, arriveQ: pickEnd, kind: 'lockpick', ref: String(doorIdx) });
      nodes.push({ cell, arriveQ: arrive, kind: 'move' });
    } else if (via[s] === VIA_PORTAL) {
      nodes.push({ cell, arriveQ: arrive, kind: 'portal', ref: ctx.portalList[viaRef[s]].def.id });
    } else {
      nodes.push({ cell, arriveQ: arrive, kind: 'move' });
    }
  }
  const arriveQ = gArrive[goalState];
  if (o.goalHoldQ > 0) {
    nodes.push({ cell: o.goalCell, arriveQ: arriveQ + o.goalHoldQ, kind: 'print' });
  }

  return { nodes, endQ: arriveQ + o.goalHoldQ, cost: arriveQ, expansions };
}

