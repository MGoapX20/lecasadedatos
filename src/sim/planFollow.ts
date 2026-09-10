import type { Level } from '../level/loader';
import type { Plan, PlanNodeKind } from '../planner/types';

export interface PlanSample {
  x: number;
  y: number;
  facing: number;
  hidden: boolean;
  /** 'pending' before the agent's start slot, 'done' after the last leg. */
  phase: 'pending' | 'active' | 'done';
  kind: PlanNodeKind;
  nodeIdx: number;
}

export function planCellCenterX(level: Level, cell: number): number {
  return (cell % level.pw) * level.stride + level.stride / 2;
}

export function planCellCenterY(level: Level, cell: number): number {
  return ((cell / level.pw) | 0) * level.stride + level.stride / 2;
}

/**
 * Where a plan puts its agent at relative quantum `qf`. The planner verified
 * safety for exactly these positions, so simulation and planner agree by
 * construction rather than by luck.
 */
export function samplePlan(level: Level, plan: Plan, qf: number, hintIdx = 1): PlanSample {
  const nodes = plan.nodes;
  const out: PlanSample = {
    x: 0,
    y: 0,
    facing: 0,
    hidden: false,
    phase: 'active',
    kind: 'move',
    nodeIdx: hintIdx,
  };
  if (nodes.length === 0) {
    out.phase = 'done';
    return out;
  }
  if (qf < nodes[0].arriveQ) {
    out.x = planCellCenterX(level, nodes[0].cell);
    out.y = planCellCenterY(level, nodes[0].cell);
    out.hidden = true;
    out.phase = 'pending';
    out.kind = 'start';
    out.nodeIdx = 1;
    return out;
  }
  const last = nodes[nodes.length - 1];
  if (qf >= last.arriveQ) {
    out.x = planCellCenterX(level, last.cell);
    out.y = planCellCenterY(level, last.cell);
    out.phase = 'done';
    out.kind = last.kind;
    out.nodeIdx = nodes.length - 1;
    return out;
  }
  let i = Math.min(Math.max(1, hintIdx), nodes.length - 1);
  while (i > 1 && nodes[i - 1].arriveQ > qf) i--;
  while (i < nodes.length - 1 && nodes[i].arriveQ <= qf) i++;
  const cur = nodes[i];
  const prev = nodes[i - 1];
  out.nodeIdx = i;
  out.kind = cur.kind;
  const ax = planCellCenterX(level, prev.cell);
  const ay = planCellCenterY(level, prev.cell);
  const bx = planCellCenterX(level, cur.cell);
  const by = planCellCenterY(level, cur.cell);
  const span = Math.max(1e-6, cur.arriveQ - prev.arriveQ);
  const f = Math.min(1, Math.max(0, (qf - prev.arriveQ) / span));
  if (cur.kind === 'move') {
    out.x = ax + (bx - ax) * f;
    out.y = ay + (by - ay) * f;
    if (Math.abs(bx - ax) > 1e-6 || Math.abs(by - ay) > 1e-6) {
      out.facing = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    }
  } else if (cur.kind === 'portal') {
    out.hidden = true;
    out.x = f < 0.5 ? ax : bx;
    out.y = f < 0.5 ? ay : by;
  } else {
    out.x = ax;
    out.y = ay;
  }
  return out;
}
