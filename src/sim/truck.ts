import type { CellXY } from '../level/schema';

/**
 * The supplier's delivery round. A truck leaves the loading bay, drives the
 * service road to one of the shops around the building, loads, and drives back
 * in through the gate. The gate itself is shut and has no lock worth picking:
 * the way in is the lorry, which is the whole point of the loading bay analogy.
 *
 * Everything here is a pure function of the tick, exactly like a guard's patrol
 * program, so the planner can reason about it and the tests can replay it.
 */
export interface DeliveryDef {
  /** Where the truck parks inside the bay. */
  dockCell: CellXY;
  /** The gate cell it drives through. */
  gateCell: CellXY;
  /** Where it joins the service road, just outside the gate. */
  roadCell: CellXY;
  /** Corners of the service road loop, in order. */
  ring: CellXY[];
  /** Shops it collects from, each a point on the loop. */
  stops: CellXY[];
  /** One full round trip, in ticks. Any time left over is spent parked. */
  cycleTicks: number;
  /** How long it sits at the shop with the shutters up. */
  loadTicks: number;
  /** How long it sits in the bay being emptied. */
  unloadTicks: number;
  /** Cells per second. */
  speedCells: number;
}

export type TruckPhase = 'parked' | 'outbound' | 'loading' | 'inbound' | 'unloading';

export interface TruckPose {
  x: number;
  y: number;
  /** Degrees, 0 = +x, matching the rest of the simulation. */
  facing: number;
  phase: TruckPhase;
  /** Which shop this round is collecting from. */
  stop: number;
  /** 0..1 through the current loading or unloading dwell. */
  dwell: number;
}

export function blankTruckPose(): TruckPose {
  return { x: 0, y: 0, facing: 0, phase: 'parked', stop: 0, dwell: 0 };
}

type Pt = { x: number; y: number };

const pt = (c: CellXY): Pt => ({ x: c[0] + 0.5, y: c[1] + 0.5 });

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Cumulative arc length of a closed loop, plus its total. */
function ringLengths(ring: Pt[]): { at: number[]; total: number } {
  const at: number[] = [0];
  for (let i = 1; i <= ring.length; i++) {
    at.push(at[i - 1] + dist(ring[i - 1], ring[i % ring.length]));
  }
  return { at, total: at[ring.length] };
}

/** Distance along the loop of the point on it nearest to `p`. */
function arcOf(ring: Pt[], at: number[], p: Pt): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < bestD) {
      bestD = d;
      best = at[i] + Math.sqrt(len2) * t;
    }
  }
  return best;
}

/** The point at distance `s` around the loop. */
function ringAt(ring: Pt[], at: number[], total: number, s: number): Pt {
  let d = ((s % total) + total) % total;
  for (let i = 0; i < ring.length; i++) {
    const seg = at[i + 1] - at[i];
    if (d <= seg || i === ring.length - 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const t = seg > 0 ? d / seg : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    d -= seg;
  }
  return ring[0];
}

/**
 * The outbound route, bay to shop: out of the gate, onto the service road, then
 * whichever way round the loop is shorter. The return leg is this reversed.
 */
function outboundPath(def: DeliveryDef, stopIndex: number): Pt[] {
  const ring = def.ring.map(pt);
  const { at, total } = ringLengths(ring);
  const start = arcOf(ring, at, pt(def.roadCell));
  const end = arcOf(ring, at, pt(def.stops[stopIndex] ?? def.stops[0]));
  // Go whichever way round is shorter, so the truck never takes the long way
  // past the shop it is heading for.
  let delta = end - start;
  if (delta > total / 2) delta -= total;
  if (delta < -total / 2) delta += total;
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / 2));
  const along: Pt[] = [];
  for (let i = 1; i <= steps; i++) along.push(ringAt(ring, at, total, start + (delta * i) / steps));
  return [pt(def.dockCell), pt(def.gateCell), pt(def.roadCell), ...along];
}

/** Heading of the final leg of a path, so a parked truck faces where it drove. */
function headingOf(path: Pt[]): number {
  for (let i = path.length - 1; i > 0; i--) {
    const a = path[i - 1];
    const b = path[i];
    if (dist(a, b) > 1e-6) return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  }
  return 0;
}

function pathLength(path: Pt[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
  return total;
}

/** Position and heading `d` cells along a polyline. */
function walk(path: Pt[], d: number, out: TruckPose): void {
  let left = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = dist(a, b);
    if (left <= seg || i === path.length - 1) {
      const t = seg > 0 ? Math.min(1, left / seg) : 1;
      out.x = a.x + (b.x - a.x) * t;
      out.y = a.y + (b.y - a.y) * t;
      if (seg > 0) out.facing = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      return;
    }
    left -= seg;
  }
  const last = path[path.length - 1];
  out.x = last.x;
  out.y = last.y;
}

/** Which shop this round of the loop is collecting from. */
export function stopForCycle(def: DeliveryDef, cycle: number): number {
  if (!def.stops.length) return 0;
  // A cheap hash so consecutive rounds do not simply walk the list in order.
  const h = Math.imul(cycle + 1, 2654435761) >>> 0;
  return h % def.stops.length;
}

/** Where the truck is at this tick. Pure, so the planner and the tests agree. */
export function truckPoseAt(
  def: DeliveryDef,
  tickHz: number,
  tick: number,
  out: TruckPose = blankTruckPose(),
): TruckPose {
  const cycle = Math.floor(tick / def.cycleTicks);
  const t = tick - cycle * def.cycleTicks;
  const stop = stopForCycle(def, cycle);
  out.stop = stop;
  out.dwell = 0;

  const path = outboundPath(def, stop);
  const legTicks = Math.max(1, Math.round((pathLength(path) / def.speedCells) * tickHz));
  const loadStart = legTicks;
  const backStart = loadStart + def.loadTicks;
  const unloadStart = backStart + legTicks;
  const parkedStart = unloadStart + def.unloadTicks;

  if (t < loadStart) {
    out.phase = 'outbound';
    walk(path, (t / legTicks) * pathLength(path), out);
  } else if (t < backStart) {
    out.phase = 'loading';
    out.dwell = (t - loadStart) / Math.max(1, def.loadTicks);
    const last = path[path.length - 1];
    out.x = last.x;
    out.y = last.y;
    // Keep the heading it arrived on, or a parked lorry points across the road.
    out.facing = headingOf(path);
  } else if (t < unloadStart) {
    out.phase = 'inbound';
    const back = [...path].reverse();
    walk(back, ((t - backStart) / legTicks) * pathLength(back), out);
  } else if (t < parkedStart) {
    out.phase = 'unloading';
    out.dwell = (t - unloadStart) / Math.max(1, def.unloadTicks);
    const dock = pt(def.dockCell);
    out.x = dock.x;
    out.y = dock.y;
    out.facing = headingOf([...path].reverse());
  } else {
    out.phase = 'parked';
    const dock = pt(def.dockCell);
    out.x = dock.x;
    out.y = dock.y;
    out.facing = headingOf([...path].reverse());
  }
  return out;
}

/** Is the truck sitting still with its shutters up, ready to be climbed into? */
export function truckIsOpen(pose: TruckPose): boolean {
  return pose.phase === 'loading' || pose.phase === 'unloading';
}
