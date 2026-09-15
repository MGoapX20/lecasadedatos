import { expect, it } from 'vitest';
import { loadMint } from './helpers';
import { SimWorld } from '../src/sim/world';
import { makeCtx, runJob } from '../src/planner/planner';
import { planningSnapshot } from '../src/planner/snapshot';
import { enumerateRequests, enumerateSwarmRequests } from '../src/planner/options';
import { setKeycardCell } from '../src/level/keycard';
import { TIMERS } from '../src/config';

it.each([
  { outcome: 'breached', card: [48, 45] },
  { outcome: 'blocked', card: [46, 63] },
])('finds playable swarm routes after the first attacker is $outcome', ({ outcome, card }) => {
  const level = loadMint(); setKeycardCell(level, 0, card[1] * level.w + card[0]);
  const world = new SimWorld(level, 1234), ctx = makeCtx(level);
  world.catchesEnabled = false; world.respawnEnabled = false;
  const plan = (requests: ReturnType<typeof enumerateRequests>) => {
    const { nowTick, guardPrograms, ...snapshot } = planningSnapshot(world);
    return runJob({ level, ctx, programs: guardPrograms, baseTick: nowTick, ...snapshot, requests, budgetMs: 20000 });
  };
  const walkers = plan(enumerateRequests(level, 24, 4242, 1, [0, 2, 4])).plans;
  const maxQ = Math.floor((TIMERS.round2ACap - 7000) * (level.json.rules.tickHz / 1000 / level.json.rules.quantumTicks) * .75);
  const fits = walkers.filter(p => p.endQ <= maxQ);
  const rank = (id: string) => ['door', 'gate'].includes(level.json.entries.find(e => e.id === id)!.kind) ? 0 : 1;
  const chosen = [...(fits.length ? fits : walkers)].sort((a,b) => rank(a.request.entryId)-rank(b.request.entryId) || a.endQ-b.endQ)[0];
  expect(chosen).toBeDefined();
  const thief = world.spawnPlanThief(chosen, 'Berlin'); thief.planRate = .75;
  if (outcome === 'blocked') level.doors.forEach((door, i) => { if (door.lockableByChief) world.lockDoor(i, true, true); });
  let blocked = false;
  for (let i = 0; i < 1000 && !thief.breached; i++) {
    world.step(); world.drainEvents();
    if (thief.blockedTicks > level.json.rules.tickHz * 3) {
      world.abandonThief(thief, 'blocked'); blocked = true; break;
    }
  }
  expect(thief.breached).toBe(outcome === 'breached');
  expect(blocked).toBe(outcome === 'blocked');
  for (let i = 0; i < TIMERS.round2AResult / 1000 * level.json.rules.tickHz; i++) { world.step(); world.drainEvents(); }
  world.clearThieves();
  const job = plan(enumerateSwarmRequests(level, 80, 777));
  expect(job.stats.found).toBeGreaterThan(10);
  expect(job.stats.distinct).toBeGreaterThan(3);
  world.catchesEnabled = true;
  job.plans.forEach(p => world.spawnPlanThief(p, `AI ${p.agentId}`));
  let breaches = 0;
  for (let i = 0; i < TIMERS.round2BCap / 1000 * level.json.rules.tickHz; i++) {
    world.step();
    breaches += world.drainEvents().filter(event => event.kind === 'breach').length;
  }
  expect(breaches, 'routes must still work when replayed after wave A').toBeGreaterThan(0);
});
