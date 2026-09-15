import { describe, expect, it, vi } from 'vitest';
import { SimWorld } from '../src/sim/world';
import { makeCtx, runJob } from '../src/planner/planner';
import { planningSnapshot } from '../src/planner/snapshot';
import { enumerateRequests } from '../src/planner/options';
import type { PlanRequest } from '../src/planner/types';
import { planningFixture } from './planning-fixture';

function fixture(camera = false) {
  const level = planningFixture(camera), world = new SimWorld(level), ctx = makeCtx(level);
  const request: PlanRequest = { ...enumerateRequests(level, 1, 5)[0], startPlanCell: 18,
    keyStrategy: { kind: 'key', keyId: 'k_manager' }, startDelayQ: 0,
    personality: { heatLambda: 0, noiseEps: 0, margin: 0, waitBias: 0 } };
  const run = (changes: Partial<PlanRequest> = {}, budgetMs = 1000) => {
    const { nowTick, guardPrograms, ...state } = planningSnapshot(world);
    return runJob({ level, ctx, baseTick: nowTick, programs: guardPrograms, ...state,
      requests: [{ ...request, ...changes }], budgetMs });
  };
  return { level, world, request, run };
}

describe('planning from live defenses and inventory', () => {
  it('replans from the live position even if the request still remembers its launch point', () => {
    const { request, run } = fixture();
    const job = run({ launchPlanCell: 1, heldKeys: ['k_manager'] });
    expect(job.plans).toHaveLength(1);
    expect(job.plans[0].nodes[0].cell).toBe(request.startPlanCell);
    expect(job.plans[0].nodes.some(node => node.cell === 1)).toBe(false);
  });

  it('continues toward the vault with a collected card after a door seals the way back', () => {
    const { world, run } = fixture();
    expect(run().plans).toHaveLength(0);
    const job = run({ heldKeys: ['k_manager'] });
    expect(job.plans).toHaveLength(1);
    expect(job.plans[0].actions.filter(a => a.kind === 'pickup')).toEqual([]);
    const thief = world.spawnPlanThief(job.plans[0], 'Test'); thief.keys.add('k_manager');
    for (let i = 0; i < 30; i++) world.step();
    expect(thief.breached).toBe(true);
    expect(thief.blockedByDoor).toBe(-1);
  });

  it('does not send a disguised agent back through a sealed door for the uniform again', () => {
    const { run } = fixture(true);
    const job = run({ heldKeys: ['k_manager', 'k_uniform'], keyStrategy: { kind: 'uniform', keyId: 'k_uniform' } });
    expect(job.plans).toHaveLength(1);
    expect(job.plans[0].actions.filter(a => a.kind === 'pickup')).toEqual([]);
  });

  it('honors power already cut by the first attacker and skips the fuse detour', () => {
    const { world, run } = fixture(true);
    expect(run({ heldKeys: ['k_manager'] }).plans).toHaveLength(0);
    world.setPowerEnabled(false);
    expect(run({ heldKeys: ['k_manager'], keyStrategy: { kind: 'power', keyId: 'k_fuse' } }).plans).toHaveLength(1);
  });

  it('does not let a uniform evade cameras during an alarm', () => {
    const { world, run } = fixture(true);
    world.alarmWindows.push({ fromTick: 0, toTick: 10000 });
    expect(run({ heldKeys: ['k_manager', 'k_uniform'] }).plans).toHaveLength(0);
  });

  it('remembers a lock this agent already picked', () => {
    const { run } = fixture();
    expect(run().plans).toHaveLength(0);
    expect(run({ pickedDoors: [0] }).plans).toHaveLength(1);
  });

  it('snapshots a broken lock as open without changing the chief’s lock setting', () => {
    const { world, run } = fixture();
    world.doorPickedOpen[0] = 1;
    expect(planningSnapshot(world).doorLocked[0]).toBe(0);
    expect(run().plans).toHaveLength(1);
    expect(world.doorLocked[0]).toBe(1);
  });

  it('still searches when timetable preparation exceeds the search budget', () => {
    const { run } = fixture();
    let clock = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 5000));
    try {
      const job = run({ heldKeys: ['k_manager'] }, 1);
      expect(job.stats.searches).toBe(1);
      expect(job.plans).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });
});
