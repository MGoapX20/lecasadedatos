import { MinHeap } from '../core/heap';

export const NEIGHBOR_DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
export const NEIGHBOR_DY = [0, 0, 1, -1, 1, -1, 1, -1] as const;
export const NEIGHBOR_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2] as const;

/** True when moving diagonally from (x,y) by (dx,dy) would clip a wall corner. */
export function cornerBlocked(
  walk: Uint8Array,
  w: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): boolean {
  if (dx === 0 || dy === 0) return false;
  return !walk[y * w + (x + dx)] || !walk[(y + dy) * w + x];
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

export interface AStarScratch {
  gScore: Float64Array;
  parent: Int32Array;
  stamp: Uint32Array;
  gen: number;
  heap: MinHeap;
}

export function makeScratch(cellCount: number): AStarScratch {
  return {
    gScore: new Float64Array(cellCount),
    parent: new Int32Array(cellCount),
    stamp: new Uint32Array(cellCount),
    gen: 0,
    heap: new MinHeap(2048),
  };
}

/**
 * Plain A* over a static walk grid. Used by guard chase/return, by click-to-move
 * and by level sanity checks. Returns the cell path including both endpoints, or
 * null when unreachable.
 */
export function staticAStar(
  walk: Uint8Array,
  w: number,
  h: number,
  start: number,
  goal: number,
  scratch: AStarScratch,
  blocked?: Uint8Array,
): Int32Array | null {
  if (start === goal) return Int32Array.of(start);
  if (!walk[start] || !walk[goal]) return null;
  const gen = ++scratch.gen;
  const { gScore, parent, stamp, heap } = scratch;
  heap.clear();
  const gx = goal % w;
  const gy = (goal / w) | 0;
  stamp[start] = gen;
  gScore[start] = 0;
  parent[start] = -1;
  heap.push(chebyshev(start % w, (start / w) | 0, gx, gy), start);

  let guard = 0;
  const maxExpansions = w * h * 4;
  while (heap.size > 0) {
    if (++guard > maxExpansions) return null;
    const cur = heap.pop();
    if (cur === goal) break;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    const g = gScore[cur];
    for (let n = 0; n < 8; n++) {
      const nx = cx + NEIGHBOR_DX[n];
      const ny = cy + NEIGHBOR_DY[n];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!walk[ni]) continue;
      if (blocked && blocked[ni]) continue;
      if (cornerBlocked(walk, w, cx, cy, NEIGHBOR_DX[n], NEIGHBOR_DY[n])) continue;
      const ng = g + NEIGHBOR_COST[n];
      if (stamp[ni] === gen && gScore[ni] <= ng) continue;
      stamp[ni] = gen;
      gScore[ni] = ng;
      parent[ni] = cur;
      heap.push(ng + chebyshev(nx, ny, gx, gy), ni);
    }
  }
  if (stamp[goal] !== gen) return null;
  const out: number[] = [];
  for (let c = goal; c !== -1; c = parent[c]) out.push(c);
  out.reverse();
  return Int32Array.from(out);
}

/**
 * String pulling: drop path nodes that a straight walkable line can skip.
 * Turns a blocky grid path into the handful of corners a person would actually walk.
 */
export function simplifyPath(
  path: ArrayLike<number>,
  walk: Uint8Array,
  w: number,
  h: number,
): number[] {
  const n = path.length;
  if (n <= 2) return Array.from(path as ArrayLike<number>);
  const out: number[] = [path[0]];
  let anchor = 0;
  for (let i = 2; i < n; i++) {
    if (!walkableLine(walk, w, h, path[anchor], path[i])) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[n - 1]);
  return out;
}

/** Sampled straight-line walkability test between two cell centres. */
export function walkableLine(
  walk: Uint8Array,
  w: number,
  h: number,
  a: number,
  b: number,
): boolean {
  const ax = (a % w) + 0.5;
  const ay = ((a / w) | 0) + 0.5;
  const bx = (b % w) + 0.5;
  const by = ((b / w) | 0) + 0.5;
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.ceil(dist * 3);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = Math.floor(ax + (bx - ax) * t);
    const y = Math.floor(ay + (by - ay) * t);
    if (x < 0 || y < 0 || x >= w || y >= h || !walk[y * w + x]) return false;
  }
  return true;
}

/** Breadth-first flood fill returning the set of cells reachable from `start`. */
export function floodFill(walk: Uint8Array, w: number, h: number, start: number): Uint8Array {
  const seen = new Uint8Array(walk.length);
  if (!walk[start]) return seen;
  const queue = new Int32Array(walk.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (let n = 0; n < 8; n++) {
      const nx = cx + NEIGHBOR_DX[n];
      const ny = cy + NEIGHBOR_DY[n];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni] || !walk[ni]) continue;
      if (cornerBlocked(walk, w, cx, cy, NEIGHBOR_DX[n], NEIGHBOR_DY[n])) continue;
      seen[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return seen;
}
