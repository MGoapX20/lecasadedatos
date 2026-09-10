import { simplifyPath, staticAStar } from '../level/grid';
import { cellOf, type Level } from '../level/loader';
import type { GuardDef, PatrolWaypoint } from '../level/schema';

export interface Pose {
  x: number; // fine-cell coordinates, continuous
  y: number;
  facingDeg: number;
  present: boolean;
  moving: boolean;
}

type Step =
  | { kind: 'move'; dur: number; x0: number; y0: number; x1: number; y1: number; facing: number }
  | { kind: 'hold'; dur: number; x: number; y: number; facing: number };

/** A repeating walk built from A*-routed waypoints. */
interface LoopSegment {
  kind: 'loop';
  startTick: number;
  steps: Step[];
  starts: Float64Array;
  period: number;
}

/** A one-shot walk to a destination, appended when the chief repositions a guard. */
interface WalkSegment {
  kind: 'walk';
  startTick: number;
  steps: Step[];
  starts: Float64Array;
  duration: number;
  endX: number;
  endY: number;
  endFacing: number;
}

/** Standing watch, optionally sweeping the head back and forth. */
interface SentrySegment {
  kind: 'sentry';
  startTick: number;
  /** When set, the sentry expires and the earlier schedule resumes. */
  endTick?: number;
  x: number;
  y: number;
  facingDeg: number;
  sweepDeg: number;
  periodTicks: number;
}

interface AbsentSegment {
  kind: 'absent';
  startTick: number;
  endTick: number;
  x: number;
  y: number;
}

export type PatrolSegment = LoopSegment | WalkSegment | SentrySegment | AbsentSegment;

export interface PatrolProgram {
  guardId: string;
  segments: PatrolSegment[];
  speedCellsPerTick: number;
}

function angleOf(dx: number, dy: number): number {
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function buildSteps(points: number[][], holds: number[], speed: number): Step[] {
  const steps: Step[] = [];
  let facing = points.length > 1 ? angleOf(points[1][0] - points[0][0], points[1][1] - points[0][1]) : 0;
  for (let i = 0; i < points.length; i++) {
    const nextIdx = i + 1;
    if (nextIdx < points.length) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[nextIdx];
      const dist = Math.hypot(x1 - x0, y1 - y0);
      if (dist > 1e-6) facing = angleOf(x1 - x0, y1 - y0);
      if (holds[i] > 0) steps.push({ kind: 'hold', dur: holds[i], x: x0, y: y0, facing });
      if (dist > 1e-6) {
        steps.push({ kind: 'move', dur: dist / speed, x0, y0, x1, y1, facing });
      }
    } else if (holds[i] > 0) {
      steps.push({ kind: 'hold', dur: holds[i], x: points[i][0], y: points[i][1], facing });
    }
  }
  if (steps.length === 0) {
    steps.push({ kind: 'hold', dur: 1, x: points[0][0], y: points[0][1], facing });
  }
  return steps;
}

function startsOf(steps: Step[]): { starts: Float64Array; total: number } {
  const starts = new Float64Array(steps.length + 1);
  let t = 0;
  for (let i = 0; i < steps.length; i++) {
    starts[i] = t;
    t += steps[i].dur;
  }
  starts[steps.length] = t;
  return { starts, total: t };
}

/** Route between authored waypoints so guards walk around furniture, not through it. */
/** Nearest cell on `grid` within a couple of cells, or -1. */
function snapTo(level: Level, grid: Uint8Array, cell: number, radius = 3): number {
  if (grid[cell]) return cell;
  const x0 = cell % level.w;
  const y0 = (cell / level.w) | 0;
  let best = -1;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) continue;
      const c = y * level.w + x;
      if (!grid[c]) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/**
 * Route on the eroded grid so guards keep their shoulders off the walls. A
 * waypoint authored right against a wall is nudged onto the eroded grid first;
 * only if that fails does the full grid get used.
 */
function guardPath(level: Level, a: number, b: number): Int32Array | null {
  const ea = snapTo(level, level.walkGuard, a);
  const eb = snapTo(level, level.walkGuard, b);
  if (ea >= 0 && eb >= 0) {
    const eroded = staticAStar(level.walkGuard, level.w, level.h, ea, eb, level.scratch);
    if (eroded) return eroded;
  }
  return staticAStar(level.walk, level.w, level.h, a, b, level.scratch);
}

function routeWaypoints(level: Level, waypoints: PatrolWaypoint[], loop: boolean) {
  const points: number[][] = [];
  const holds: number[] = [];
  const n = waypoints.length;
  const pairs = loop ? n : n - 1;
  for (let i = 0; i < pairs; i++) {
    const a = cellOf(level, waypoints[i].cell);
    const b = cellOf(level, waypoints[(i + 1) % n].cell);
    const path = guardPath(level, a, b);
    const cells = path ? simplifyPath(path, level.walkGuard, level.w, level.h) : [a, b];
    for (let k = 0; k < cells.length - 1; k++) {
      const c = cells[k];
      points.push([(c % level.w) + 0.5, ((c / level.w) | 0) + 0.5]);
      holds.push(k === 0 ? (waypoints[i].holdTicks ?? 0) : 0);
    }
  }
  if (!loop) {
    const last = cellOf(level, waypoints[n - 1].cell);
    points.push([(last % level.w) + 0.5, ((last / level.w) | 0) + 0.5]);
    holds.push(waypoints[n - 1].holdTicks ?? 0);
  }
  if (points.length === 0) {
    const c = cellOf(level, waypoints[0].cell);
    points.push([(c % level.w) + 0.5, ((c / level.w) | 0) + 0.5]);
    holds.push(waypoints[0].holdTicks ?? 1);
  }
  return { points, holds };
}

export function compileGuardProgram(level: Level, guard: GuardDef): PatrolProgram {
  const rules = level.json.rules;
  const speedMs = guard.patrol.speed ?? rules.guardSpeed;
  const speed = speedMs / level.cellSize / rules.tickHz; // fine cells per tick
  const { points, holds } = routeWaypoints(level, guard.patrol.waypoints, guard.patrol.loop);
  const steps = buildSteps(points, holds, speed);
  const { starts, total } = startsOf(steps);
  const loopSeg: LoopSegment = { kind: 'loop', startTick: 0, steps, starts, period: total };
  const segments: PatrolSegment[] = [loopSeg];

  const sc = level.json.shiftChange;
  if (sc && sc.guardsAffected.includes(guard.id)) {
    const p = poseInLoop(loopSeg, sc.startTick);
    segments.push({
      kind: 'absent',
      startTick: sc.startTick,
      endTick: sc.startTick + sc.durationTicks,
      x: p.x,
      y: p.y,
    });
    segments.push({ ...loopSeg, startTick: sc.startTick + sc.durationTicks });
  }
  return { guardId: guard.id, segments, speedCellsPerTick: speed };
}

function stepPose(step: Step, local: number, out: Pose): void {
  if (step.kind === 'hold') {
    out.x = step.x;
    out.y = step.y;
    out.facingDeg = step.facing;
    out.moving = false;
  } else {
    const t = step.dur > 0 ? Math.min(1, local / step.dur) : 1;
    out.x = step.x0 + (step.x1 - step.x0) * t;
    out.y = step.y0 + (step.y1 - step.y0) * t;
    out.facingDeg = step.facing;
    out.moving = true;
  }
  out.present = true;
}

function seek(steps: Step[], starts: Float64Array, t: number, out: Pose): void {
  let lo = 0;
  let hi = steps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  stepPose(steps[lo], t - starts[lo], out);
}

function poseInLoop(seg: LoopSegment, tick: number, out: Pose = blankPose()): Pose {
  const rel = tick - seg.startTick;
  const t = seg.period > 0 ? ((rel % seg.period) + seg.period) % seg.period : 0;
  seek(seg.steps, seg.starts, t, out);
  return out;
}

export function blankPose(): Pose {
  return { x: 0, y: 0, facingDeg: 0, present: true, moving: false };
}

/**
 * The guard's scheduled pose at an absolute tick. Pure: the planner and the
 * simulation both call this and therefore always agree about where guards are.
 */
export function poseAt(program: PatrolProgram, tick: number, out: Pose = blankPose()): Pose {
  const segs = program.segments;
  let active = segs[0];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.startTick > tick) continue;
    if (s.kind === 'sentry' && s.endTick !== undefined && tick >= s.endTick) continue;
    active = s;
    break;
  }
  switch (active.kind) {
    case 'loop':
      return poseInLoop(active, tick, out);
    case 'walk': {
      const rel = tick - active.startTick;
      if (rel >= active.duration) {
        out.x = active.endX;
        out.y = active.endY;
        out.facingDeg = active.endFacing;
        out.present = true;
        out.moving = false;
        return out;
      }
      seek(active.steps, active.starts, Math.max(0, rel), out);
      return out;
    }
    case 'sentry': {
      const rel = tick - active.startTick;
      const phase = active.periodTicks > 0 ? (rel / active.periodTicks) * Math.PI * 2 : 0;
      out.x = active.x;
      out.y = active.y;
      out.facingDeg = active.facingDeg + Math.sin(phase) * active.sweepDeg;
      out.present = true;
      out.moving = false;
      return out;
    }
    case 'absent':
      out.x = active.x;
      out.y = active.y;
      out.facingDeg = 0;
      out.present = tick >= active.endTick;
      out.moving = false;
      return out;
  }
}

/**
 * Append a reposition order. The past is never rewritten, so plans made before
 * this call stay valid up to `startTick` and the planner can simply re-read the
 * program to see the new future.
 */
export function orderGuardTo(
  level: Level,
  program: PatrolProgram,
  startTick: number,
  targetCell: number,
  sweepDeg = 40,
  sweepPeriod = 200,
  fromPos?: { x: number; y: number },
): void {
  const from = fromPos ?? poseAt(program, startTick);
  const fromCell =
    Math.min(level.h - 1, Math.max(0, Math.floor(from.y))) * level.w +
    Math.min(level.w - 1, Math.max(0, Math.floor(from.x)));
  const path = guardPath(level, fromCell, targetCell);
  const cells = path ? simplifyPath(path, level.walkGuard, level.w, level.h) : [fromCell, targetCell];
  const points: number[][] = [[from.x, from.y]];
  const holds: number[] = [0];
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i];
    points.push([(c % level.w) + 0.5, ((c / level.w) | 0) + 0.5]);
    holds.push(0);
  }
  const steps = buildSteps(points, holds, program.speedCellsPerTick);
  const { starts, total } = startsOf(steps);
  const last = points[points.length - 1];
  const prev = points[Math.max(0, points.length - 2)];
  const endFacing = angleOf(last[0] - prev[0], last[1] - prev[1]);
  // Drop anything scheduled after this order; the guard has new instructions.
  program.segments = program.segments.filter((s) => s.startTick <= startTick);
  program.segments.push({
    kind: 'walk',
    startTick,
    steps,
    starts,
    duration: total,
    endX: last[0],
    endY: last[1],
    endFacing,
  });
  program.segments.push({
    kind: 'sentry',
    startTick: startTick + total,
    x: last[0],
    y: last[1],
    facingDeg: endFacing,
    sweepDeg,
    periodTicks: sweepPeriod,
  });
}

/** Deep-enough copy for handing a program to the planner worker. */
export function cloneProgram(p: PatrolProgram): PatrolProgram {
  return { guardId: p.guardId, speedCellsPerTick: p.speedCellsPerTick, segments: p.segments.slice() };
}

/**
 * A guard who is off chasing somebody is not where the timetable says. For the
 * planner's benefit, pin him where he actually is for a few seconds, after
 * which the timetable takes over again.
 */
export function withTemporaryPost(
  p: PatrolProgram,
  x: number,
  y: number,
  facingDeg: number,
  fromTick: number,
  durationTicks: number,
): PatrolProgram {
  const c = cloneProgram(p);
  c.segments.push({
    kind: 'sentry',
    startTick: fromTick,
    endTick: fromTick + durationTicks,
    x,
    y,
    facingDeg,
    sweepDeg: 35,
    periodTicks: 120,
  });
  return c;
}
