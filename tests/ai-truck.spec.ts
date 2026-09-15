import { describe, expect, it } from 'vitest';
import { buildLevel, cellOf, fineToPlan } from '../src/level/loader';
import { enumerateSwarmRequests } from '../src/planner/options';
import { makeCtx, runJob } from '../src/planner/planner';
import { planningSnapshot } from '../src/planner/snapshot';
import { truckWindows } from '../src/planner/truck';
import { planCellCenterX, planCellCenterY, planPathPoints, samplePlan } from '../src/sim/planFollow';
import { truckPoseAt } from '../src/sim/truck';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

function prepare(baseTick = 0, onlyStop?: number) {
  const json = loadMint().json;
  if (onlyStop !== undefined) json.delivery = { ...json.delivery!, stops: [json.delivery!.stops[onlyStop]] };
  const level = buildLevel(json), world = new SimWorld(level, 5);
  world.tick = baseTick;
  const { nowTick, guardPrograms, ...dynamic } = planningSnapshot(world);
  const plans = runJob({ level, ctx: makeCtx(level), baseTick: nowTick, programs: guardPrograms,
    ...dynamic, requests: enumerateSwarmRequests(level, 100, 777).filter(r => r.entryId === 'dock'), budgetMs: 20000 }).plans;
  expect(plans.length, `supplier routes at tick ${baseTick}, stop ${onlyStop}`).toBeGreaterThan(0);
  return { level, world, plans };
}

describe('AI stowaways use the visible delivery truck', () => {
  it.each([0, 420, 850, 1100])('boards, rides and unloads on the live timetable from tick %i', baseTick => {
    const { level, world, plans } = prepare(baseTick), qt = level.json.rules.quantumTicks;
    world.catchesEnabled = false;
    const front = level.json.entries.find(e => e.id === 'front')!;
    const launch = fineToPlan(level, cellOf(level, front.spawn));
    const riders = plans.map(plan => {
      expect(plan.nodes[0].cell).toBe(launch);
      const index = plan.nodes.findIndex(n => n.kind === 'portal' && n.ref === 'p_truck');
      expect(index).toBeGreaterThan(0);
      const board = plan.nodes[index - 1], exit = plan.nodes[index];
      const pickup = truckPoseAt(level.json.delivery!, level.json.rules.tickHz, (plan.startQ + board.arriveQ) * qt);
      expect(pickup.phase).toBe('loading');
      expect(Math.hypot(pickup.x - planCellCenterX(level, board.cell), pickup.y - planCellCenterY(level, board.cell))).toBeLessThan(3.2);
      const unload = truckPoseAt(level.json.delivery!, level.json.rules.tickHz, (plan.startQ + exit.arriveQ) * qt);
      expect(['unloading', 'parked']).toContain(unload.phase);
      const points = planPathPoints(level, plan);
      for (let q = board.arriveQ + 1; q < exit.arriveQ; q++) {
        const actual = truckPoseAt(level.json.delivery!, level.json.rules.tickHz, (plan.startQ + q) * qt);
        const sample = samplePlan(level, plan, q);
        expect([sample.x, sample.y]).toEqual([actual.x, actual.y]);
        expect(points.some(p => p.x === actual.x && p.y === actual.y)).toBe(true);
      }
      return world.spawnPlanThief(plan, 'Supplier');
    });
    const boarded = new Set<number>(), left = new Set<number>(); let movingTicks = 0;
    for (let tick = 0; tick < level.json.rules.horizonSec * level.json.rules.tickHz; tick++) {
      world.step();
      for (const rider of riders) if (rider.ridingTruck) {
        expect(rider.hidden).toBe(true);
        expect([rider.x, rider.y, rider.facing]).toEqual([world.truck.x, world.truck.y, world.truck.facing]);
        if (world.truck.phase === 'inbound') movingTicks++;
      }
      for (const e of world.drainEvents()) {
        if (e.kind === 'truckBoard') {
          expect(world.truck.phase).toBe('loading'); expect(boarded.has(e.thief)).toBe(false); boarded.add(e.thief);
        }
        if (e.kind === 'truckLeave') {
          expect(boarded.has(e.thief)).toBe(true); expect(left.has(e.thief)).toBe(false);
          expect(e.inside).toBe(true); expect(['unloading', 'parked']).toContain(world.truck.phase); left.add(e.thief);
        }
        if (e.kind === 'portalEnter' || e.kind === 'portalExit') expect(e.portal).not.toBe('p_truck');
      }
    }
    expect(boarded.size).toBe(riders.length); expect(left).toEqual(boarded); expect(movingTicks).toBeGreaterThan(30);
    for (const rider of riders) {
      if (rider.plan!.replanOnArrival) {
        expect(rider.breached).toBe(false); expect(rider.active).toBe(true); expect(rider.awaitingPlan).toBe(true);
        expect(level.indoor[Math.floor(rider.y) * level.w + Math.floor(rider.x)]).toBe(1);
      } else expect(rider.breached).toBe(true);
    }
  });

  it.each([0, 1, 2])('can plan a pickup at shop %i, not just the original fixed portal', stop => {
    const { level, plans } = prepare(0, stop);
    const portal = level.portals.find(p => p.truckStop === 0)!;
    for (const plan of plans) {
      const index = plan.nodes.findIndex(n => n.kind === 'portal' && n.ref === 'p_truck');
      expect(plan.nodes[index - 1].cell).toBe(portal.fromPlan);
    }
  });

  it('waits visibly when a delayed agent misses boarding, then follows the next actual ride', () => {
    const { level, world, plans } = prepare(); world.catchesEnabled = false;
    const rider = world.spawnPlanThief(plans[0], 'Late supplier');
    rider.planStartTick += level.json.delivery!.loadTicks + 100;
    let waited = false, boarded = false, unloaded = false;
    for (let tick = 0; tick < level.json.delivery!.cycleTicks * 8 && !unloaded; tick++) {
      world.step();
      if (rider.waitingForTruck) { waited = true; expect(rider.hidden).toBe(false); }
      if (rider.ridingTruck) expect([rider.x, rider.y]).toEqual([world.truck.x, world.truck.y]);
      for (const e of world.drainEvents()) {
        if (e.kind === 'truckBoard') { boarded = true; expect(world.truck.phase).toBe('loading'); }
        if (e.kind === 'truckLeave') { unloaded = true; expect(['unloading', 'parked']).toContain(world.truck.phase); }
      }
    }
    expect(waited).toBe(true); expect(boarded).toBe(true); expect(unloaded).toBe(true);
  });

  it('does not automatically teleport the player from a shop when the vehicle is absent', () => {
    const level = loadMint(), world = new SimWorld(level, 5); world.catchesEnabled = false;
    const player = world.spawnPlayer('front', 'Visitor');
    const portal = level.portals.find(p => p.truckStop !== undefined)!;
    player.x = planCellCenterX(level, portal.fromPlan); player.y = planCellCenterY(level, portal.fromPlan);
    for (let i = 0; i < 30; i++) world.step();
    expect(player.hidden).toBe(false); expect(player.portalRef).toBeNull(); expect(world.playerInTruck).toBe(false);
  });

  it('rounds every boarding/exit window to actual stationary ticks', () => {
    const level = loadMint(), { tickHz, quantumTicks: qt } = level.json.rules;
    for (const baseTick of [0, 3, 425, 899, 1201]) for (const [stop, windows] of truckWindows(level, baseTick, 300)) {
      for (const w of windows) {
        for (const q of [w.boardFrom, w.boardUntil]) {
          const p = truckPoseAt(level.json.delivery!, tickHz, baseTick + q * qt);
          expect(p.phase).toBe('loading'); expect(p.stop).toBe(stop);
        }
        for (const q of [w.exitFrom, w.exitUntil]) expect(['unloading', 'parked'])
          .toContain(truckPoseAt(level.json.delivery!, tickHz, baseTick + q * qt).phase);
      }
    }
  });
});
