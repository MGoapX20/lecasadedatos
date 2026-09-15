import { beforeAll, describe, expect, it } from 'vitest';
import { enumerateRequests, enumerateSwarmCandidates, enumerateSwarmRequests, keyStrategiesFor, SWARM_DELAYS } from '../src/planner/options';
import { routeShape, selectSwarmPlans, tacticOf } from '../src/planner/coverage';
import { makeCtx, runJob } from '../src/planner/planner';
import { planningSnapshot } from '../src/planner/snapshot';
import type { Plan } from '../src/planner/types';
import { SimWorld } from '../src/sim/world';
import { TIMERS } from '../src/config';
import { loadMint } from './helpers';
import { buildLevel } from '../src/level/loader';

const level = loadMint();
const maxQ = TIMERS.round2BCap / 1000 * level.json.rules.tickHz / level.json.rules.quantumTicks;
const edgeCoverage = (plans: Plan[]) => new Set(plans.flatMap(p => p.nodes.slice(1).flatMap((n, i) => {
  const a = p.nodes[i].cell, b = n.cell;
  return a === b || (!level.pindoor[a] && !level.pindoor[b]) ? [] : [a < b ? `${a}:${b}` : `${b}:${a}`];
}))).size;
let candidates: Plan[], chosen: Plan[], legacy: Plan[];
beforeAll(() => {
  const world = new SimWorld(level, 5);
  const { nowTick, guardPrograms, ...dynamic } = planningSnapshot(world);
  const run = (requests: ReturnType<typeof enumerateRequests>) => runJob({ level, ctx: makeCtx(level),
    baseTick: nowTick, programs: guardPrograms, ...dynamic, requests, budgetMs: 20000 });
  const result = run(enumerateSwarmCandidates(level, 80, 777));
  candidates = result.plans;
  chosen = selectSwarmPlans(level, candidates, 80, maxQ);
  // Previous launch policy: randomly mixed strategies/delays, balanced only by entrance.
  const combos = enumerateRequests(level, level.json.entries.length * keyStrategiesFor(level).length * SWARM_DELAYS.length, 777, 1, SWARM_DELAYS);
  const queues = level.json.entries.map(e => combos.filter(r => r.entryId === e.id));
  const launch = enumerateSwarmRequests(level, 1, 777)[0].launchPlanCell;
  const old = [];
  for (let i = 0; old.length < 80; i++) for (const queue of queues) if (old.length < 80) old.push({ ...queue[i], agentId: old.length, launchPlanCell: launch });
  legacy = run(old).plans;
  console.log('swarm coverage', { candidates: candidates.length, selected: chosen.length,
    entrances: new Set(chosen.map(p => p.request.entryId)).size,
    tactics: new Set(chosen.map(tacticOf)).size, previousFeasibleTactics: new Set(legacy.filter(p => p.endQ <= maxQ).map(tacticOf)).size,
    uniquePaths: new Set(chosen.map(routeShape)).size, previousPaths: new Set(legacy.map(routeShape)).size,
    interiorEdges: edgeCoverage(chosen), previousEdges: edgeCoverage(legacy), planningMs: result.stats.wallMs });
}, 20000);

describe('swarm coverage comes before duplicate routes', () => {
  it('tries every entrance and tactic before repeating them at another start time', () => {
    const pairs = level.json.entries.length * keyStrategiesFor(level).length;
    const requests = enumerateSwarmRequests(level, pairs * 2, 7);
    expect(requests.slice(0, level.json.entries.length).map(r => r.entryId)).toEqual(level.json.entries.map(e => e.id));
    expect(new Set(requests.slice(0, pairs).map(r => `${r.entryId}:${r.keyStrategy.kind}`)).size).toBe(pairs);
    expect(requests.slice(0, pairs).every(r => r.startDelayQ === 0 && r.coverage)).toBe(true);
    expect(new Set(requests.map(r => r.launchPlanCell)).size).toBe(1);
    expect(enumerateSwarmRequests(level, pairs * 2, 7)).toEqual(requests);
  });

  it('covers all feasible entrances and maximizes unique routes before allocating duplicates', () => {
    expect(chosen).toHaveLength(80);
    expect(new Set(chosen.slice(0, 5).map(p => p.request.entryId))).toEqual(new Set(level.json.entries.map(e => e.id)));
    expect(new Set(chosen.map(routeShape)).size).toBe(Math.min(80, new Set(candidates.map(routeShape)).size));
    // A foothold-only fallback is useful when no complete route exists for its
    // entrance; it should not displace a feasible full route with the same ride.
    expect(new Set(chosen.map(tacticOf))).toEqual(new Set(candidates.filter(p => p.reachedVault && p.endQ <= maxQ).map(tacticOf)));
    expect(new Set(chosen.map(routeShape)).size).toBeGreaterThan(new Set(legacy.map(routeShape)).size);
    expect(edgeCoverage(chosen)).toBeGreaterThan(edgeCoverage(legacy));
    for (const tactic of new Set(legacy.filter(p => p.endQ <= maxQ).map(tacticOf)))
      expect(chosen.some(p => tacticOf(p) === tactic), `lost feasible tactic ${tactic}`).toBe(true);
    expect(selectSwarmPlans(level, candidates, 80, maxQ)).toEqual(chosen);
  });

  it('keeps an entrance represented even when its only route reaches the vault after the round cap', () => {
    const front = candidates.find(p => p.request.entryId === 'front')!;
    const dock = candidates.find(p => p.request.entryId === 'dock')!;
    const slow = { ...dock, endQ: maxQ + 10 };
    const picked = selectSwarmPlans(level, [front, { ...front, agentId: 999 }, slow], 2, maxQ);
    expect(picked).toContain(slow);
    expect(new Set(picked.map(p => p.request.entryId))).toEqual(new Set(['front', 'dock']));
  });

  it('does not invent coverage by renaming a strategy, changing a delay, or adding waits', () => {
    const p = candidates[0];
    const copy: Plan = { ...p, request: { ...p.request, agentId: 999, startDelayQ: 40, keyStrategy: { kind: 'key' } },
      nodes: [p.nodes[0], { ...p.nodes[0], arriveQ: 40, kind: 'wait' }, ...p.nodes.slice(1)] };
    expect(routeShape(copy)).toBe(routeShape(p)); expect(tacticOf(copy)).toBe(tacticOf(p));
    const different = candidates.find(c => c.request.entryId === p.request.entryId && routeShape(c) !== routeShape(p))!;
    expect(different).toBeDefined();
    const selected = selectSwarmPlans(level, [p, copy, different], 2);
    expect(new Set(selected.map(routeShape)).size).toBe(2);
  });

  it('keeps an outside replan on its assigned entrance, but can recover if that entrance is sealed', () => {
    const request = enumerateSwarmRequests(level, 20, 777).find(r => r.entryId === 'side' && r.keyStrategy.kind === 'key')!;
    const replan = { ...request, startPlanCell: request.launchPlanCell, startDelayQ: 0 };
    const run = (sealed: boolean) => {
      const changed = buildLevel({ ...level.json, doors: level.json.doors.map(d =>
        d.id === 'd_side' && sealed ? { ...d, locked: true, pickable: false } : d) });
      const world = new SimWorld(changed, 5), { nowTick, guardPrograms, ...dynamic } = planningSnapshot(world);
      return runJob({ level: changed, ctx: makeCtx(changed), baseTick: nowTick, programs: guardPrograms,
        ...dynamic, requests: [replan], budgetMs: 1000 }).plans;
    };
    const normal = run(false), sealed = run(true);
    expect(normal).toHaveLength(1); expect(sealed).toHaveLength(1);
    const door = level.doorIndex.get('d_side')!;
    expect(normal[0].nodes.some(n => level.pdoorAt[n.cell] === door)).toBe(true);
    expect(sealed[0].nodes.some(n => level.pdoorAt[n.cell] === door)).toBe(false);
    expect(sealed[0].nodes[0].cell).toBe(request.launchPlanCell);
  });

  it('keeps real plans intact and reaches the vault through all five entrances within the defense round', () => {
    const world = new SimWorld(level, 5); const breached = new Set<string>();
    chosen.forEach(p => { expect(candidates).toContain(p); world.spawnPlanThief(p, `AI ${p.agentId}`); });
    expect(new Set(world.thieves.map(t => `${t.x},${t.y}`)).size).toBe(1);
    let total = 0;
    for (let i = 0; i < TIMERS.round2BCap / 1000 * level.json.rules.tickHz; i++) {
      world.step();
      for (const e of world.drainEvents()) if (e.kind === 'breach') {
        total++; breached.add(world.thieves.find(t => t.id === e.thief)!.entryId);
      }
    }
    expect(total).toBeGreaterThan(10);
    expect(breached).toEqual(new Set(level.json.entries.map(e => e.id)));
  });
});
