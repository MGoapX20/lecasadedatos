import type { Level } from '../level/loader';
import type { Plan } from './types';

/** Real actions, not the requested strategy label: every route now steals a card. */
export function tacticOf(plan: Plan): string {
  const actions = [...new Set(plan.actions.filter(a =>
    a.kind === 'pickup' || a.kind === 'lockpickEnd' || a.kind === 'portalStart')
    .map(a => `${a.kind}:${a.id}`))].sort();
  return `${plan.request.entryId}|${actions.join('+')}`;
}

/** Timing changes, waits, and renamed agents do not make a different path. */
export function routeShape(plan: Plan): string {
  const cells: number[] = [];
  for (const n of plan.nodes) if (cells.at(-1) !== n.cell) cells.push(n.cell);
  return cells.join(',');
}

function interiorEdges(level: Level, plan: Plan): Set<string> {
  const edges = new Set<string>();
  for (let i = 1; i < plan.nodes.length; i++) {
    const a = plan.nodes[i - 1].cell, b = plan.nodes[i].cell;
    if (a === b || (!level.pindoor[a] && !level.pindoor[b])) continue;
    // Direction does not turn the same corridor into fresh coverage.
    edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
  return edges;
}

/** Greedy coverage of feasible candidates: entrances, tactics, then unused ground.
 * Prefer routes that finish in time, but keep slower entrances represented too.
 * Repeated paths only fill spare slots after all distinct candidates are assigned.
 * No plan is edited: its safety, inventory, launch point and timetable stay valid. */
export function selectSwarmPlans(level: Level, plans: Plan[], limit: number, maxEndQ = Infinity): Plan[] {
  const candidates = plans.map(plan => ({
    plan, tactic: tacticOf(plan), shape: routeShape(plan), edges: interiorEdges(level, plan),
  }));
  const selected: Plan[] = [];
  const entries = new Map<string, number>(), tactics = new Set<string>(), shapes = new Set<string>();
  const claimed = new Map<string, number>();
  while (selected.length < limit && candidates.length) {
    const hasUnique = candidates.some(c => !shapes.has(c.shape));
    let best = -1, bestScore: number[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (hasUnique && shapes.has(c.shape)) continue;
      const count = entries.get(c.plan.request.entryId) ?? 0;
      let fresh = 0, reuse = 0;
      for (const edge of c.edges) {
        const n = claimed.get(edge) ?? 0;
        if (!n) fresh++;
        reuse += n;
      }
      const score = [count === 0 ? 1 : 0, c.plan.reachedVault ? 1 : 0, c.plan.endQ <= maxEndQ ? 1 : 0, tactics.has(c.tactic) ? 0 : 1,
        fresh, -count, -reuse / Math.max(1, c.edges.size), -c.plan.endQ];
      let better = best < 0;
      for (let j = 0; !better && j < score.length; j++) {
        if (score[j] === bestScore[j]) continue;
        better = score[j] > bestScore[j]; break;
      }
      if (better) { best = i; bestScore = score; }
    }
    const [chosen] = candidates.splice(best, 1);
    selected.push(chosen.plan);
    const entry = chosen.plan.request.entryId;
    entries.set(entry, (entries.get(entry) ?? 0) + 1);
    tactics.add(chosen.tactic); shapes.add(chosen.shape);
    for (const edge of chosen.edges) claimed.set(edge, (claimed.get(edge) ?? 0) + 1);
  }
  return selected;
}
