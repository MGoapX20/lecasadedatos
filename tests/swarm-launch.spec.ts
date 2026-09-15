import { beforeAll, describe, expect, it } from 'vitest';
import { cellOf, fineToPlan } from '../src/level/loader';
import { enumerateSwarmRequests } from '../src/planner/options';
import { makeCtx, runJob, type JobResult } from '../src/planner/planner';
import { planningSnapshot } from '../src/planner/snapshot';
import { SimWorld } from '../src/sim/world';
import { TIMERS } from '../src/config';
import { loadMint } from './helpers';

describe('the swarm shares an outside launch point', () => {
  const level = loadMint();
  const world = new SimWorld(level, 5);
  const requests = enumerateSwarmRequests(level, 80, 777);
  const front = level.json.entries.find(entry => entry.id === 'front')!;
  const launch = fineToPlan(level, cellOf(level, front.spawn));
  let job: JobResult;

  beforeAll(() => {
    const { nowTick, guardPrograms, ...dynamic } = planningSnapshot(world);
    job = runJob({ level, ctx: makeCtx(level), baseTick: nowTick, programs: guardPrograms,
      ...dynamic, requests, budgetMs: 20000 });
  });

  it('tries each entrance early, even when the worker has a short budget', () => {
    expect(requests.slice(0, 5).map(request => request.entryId)).toEqual(level.json.entries.map(entry => entry.id));
    expect(requests).toHaveLength(80);
    expect(new Set(requests.map(request => request.agentId)).size).toBe(80);
    expect(requests.every(request => request.launchPlanCell === launch && request.startPlanCell === undefined)).toBe(true);
    expect(level.pindoor[launch]).toBe(0);
  });

  it('plans the approach from the front plaza while keeping all five distinct entrances', () => {
    expect(new Set(job.plans.map(plan => plan.request.entryId))).toEqual(new Set(level.json.entries.map(entry => entry.id)));
    for (const plan of job.plans) {
      expect(plan.nodes[0].cell).toBe(launch);
      expect(plan.steps[0]).toBe(launch);
      const entry = level.json.entries.find(entry => entry.id === plan.request.entryId)!;
      if (entry.doorId) {
        const door = level.doorIndex.get(entry.doorId)!;
        expect(plan.nodes.some(node => level.pdoorAt[node.cell] === door), `${entry.id} must use its assigned door`).toBe(true);
      } else {
        const portal = level.portals.find(portal => portal.fromFine === cellOf(level, entry.spawn))!;
        expect(plan.actions.some(action => action.kind === 'portalStart' && action.id === portal.def.id)).toBe(true);
      }
      // A new start coordinate alone would make a remote entrance teleport.
      for (let i = 1; i < plan.nodes.length; i++) {
        const node = plan.nodes[i], prev = plan.nodes[i - 1];
        if (node.kind === 'portal') continue;
        expect(Math.abs(node.cell % level.pw - prev.cell % level.pw)).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.floor(node.cell / level.pw) - Math.floor(prev.cell / level.pw))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('spawns together and gives every entrance time to breach during the actual defense round', () => {
    job.plans.forEach(plan => world.spawnPlanThief(plan, `AI ${plan.agentId}`));
    expect(new Set(world.thieves.map(thief => `${thief.x},${thief.y}`)).size).toBe(1);
    const breachedEntries = new Set<string>();
    let breaches = 0;
    for (let tick = 0; tick < TIMERS.round2BCap / 1000 * level.json.rules.tickHz; tick++) {
      world.step();
      for (const event of world.drainEvents()) {
        if (event.kind !== 'breach') continue;
        breaches++;
        breachedEntries.add(world.thieves.find(thief => thief.id === event.thief)!.entryId);
      }
    }
    expect(breaches).toBeGreaterThan(10);
    expect(breachedEntries).toEqual(new Set(level.json.entries.map(entry => entry.id)));
  });
});
