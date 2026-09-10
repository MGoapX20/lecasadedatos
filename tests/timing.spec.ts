import { describe, expect, it } from 'vitest';
import { compileGuardProgram } from '../src/sim/patrol';
import { enumerateRequests, SWARM_DELAYS } from '../src/planner/options';
import { makeCtx, runJob } from '../src/planner/planner';
import { SimWorld } from '../src/sim/world';
import { TIMERS } from '../src/config';
import { loadMint } from './helpers';

describe('swarm timing within the round', () => {
  const level = loadMint();
  const programs = level.json.guards.map((g) => compileGuardProgram(level, g));
  const doorLocked = new Uint8Array(level.doors.length);
  level.doors.forEach((d, i) => (doorLocked[i] = d.locked ? 1 : 0));

  it('breaches early and often inside the round the visitor plays', () => {
    const ctx = makeCtx(level);
    const job = runJob({
      level, ctx, programs, baseTick: 0, doorLocked, alarmWindows: [],
      requests: enumerateRequests(level, 60, 777, 1, SWARM_DELAYS),
      budgetMs: 20000,
    });
    const ends = job.plans.map((p) => p.endQ * level.json.rules.quantumTicks / level.json.rules.tickHz).sort((a,b)=>a-b);
    const delays = job.plans.map((p) => p.request.startDelayQ).sort((a,b)=>a-b);
    console.log('breach seconds sorted:', ends.map(e=>e.toFixed(0)).join(','));
    console.log('min/median/max breach sec:', ends[0]?.toFixed(1), ends[Math.floor(ends.length/2)]?.toFixed(1), ends[ends.length-1]?.toFixed(1));
    console.log('start delays quanta:', [...new Set(delays)].join(','));
    const world = new SimWorld(level, 5);
    world.respawnEnabled = false;
    job.plans.forEach((p, i) => world.spawnPlanThief(p, `#${i}`));

    // Measure the round the visitor actually plays, not a round number.
    const capTicks = Math.round((TIMERS.round2BCap / 1000) * level.json.rules.tickHz);
    let breaches = 0, caught = 0, firstBreach = -1;
    const breachTicks: number[] = [];
    for (let t = 0; t < capTicks; t++) {
      world.step();
      for (const e of world.drainEvents()) {
        if (e.kind === 'breach') { breaches++; if (firstBreach < 0) firstBreach = t; breachTicks.push(t); }
        if (e.kind === 'caught') caught++;
      }
    }
    const firstBreachSec = firstBreach / level.json.rules.tickHz;
    const medianSec = breachTicks.length
      ? breachTicks[Math.floor(breachTicks.length / 2)] / level.json.rules.tickHz : -1;
    console.log(
      `plans ${job.plans.length}, breaches ${breaches}, caught ${caught}, ` +
      `firstBreach ${firstBreachSec.toFixed(1)}s, median ${medianSec.toFixed(1)}s`,
    );
    // The building's travel distances and corridor windows put the earliest
    // possible break-in around 27s, which gives the round its shape: the
    // visitor holds for about half of it, then the counter runs away.
    expect(breaches, 'the swarm must actually break in on screen').toBeGreaterThan(10);
    expect(firstBreachSec, 'the first breach must land inside the round').toBeLessThan(34);
    expect(firstBreachSec, 'but not so early the visitor never gets a turn').toBeGreaterThan(8);
  });
});
