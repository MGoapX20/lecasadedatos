import { describe, expect, it } from 'vitest';
import { compileGuardProgram, poseAt } from '../src/sim/patrol';
import { samplePlan } from '../src/sim/planFollow';
import { cameraFacingAt, seesPoint } from '../src/sim/vision';
import { enumerateRequests } from '../src/planner/options';
import { makeCtx, runJob } from '../src/planner/planner';
import { SimWorld } from '../src/sim/world';
import { computeOpaqueWithDoors } from '../src/level/loader';
import { loadMint } from './helpers';

describe('plans survive contact with the simulation', () => {
  const level = loadMint();
  const programs = level.json.guards.map((g) => compileGuardProgram(level, g));
  const doorLocked = new Uint8Array(level.doors.length);
  level.doors.forEach((d, i) => (doorLocked[i] = d.locked ? 1 : 0));
  const ctx = makeCtx(level);
  const job = runJob({
    level,
    ctx,
    programs,
    baseTick: 0,
    doorLocked,
    alarmWindows: [],
    requests: enumerateRequests(level, 120, 21),
    budgetMs: 20000,
  });

  it('produced plans to check', () => {
    expect(job.plans.length).toBeGreaterThan(40);
  });

  it('keeps agents out of every guard and camera cone, tick by tick', () => {
    const qt = level.json.rules.quantumTicks;
    // Sight must be judged against the same shut doors the planner baked.
    const opaque = computeOpaqueWithDoors(level, doorLocked, new Uint8Array(level.cellCount));
    let seenTicks = 0;
    let totalTicks = 0;
    let seenPlans = 0;
    // A stolen uniform and a cut fuse deliberately change what "seen" means, so
    // they are checked by their own rules in the sim, not against this one.
    const plain = job.plans.filter(
      (p) => p.request.keyStrategy.kind !== 'uniform' && p.request.keyStrategy.kind !== 'power',
    );
    for (const plan of plain) {
      const endTick = plan.nodes[plan.nodes.length - 1].arriveQ * qt;
      let planSeen = false;
      let hint = 1;
      for (let tick = 0; tick <= endTick; tick++) {
        const s = samplePlan(level, plan, tick / qt, hint);
        hint = s.nodeIdx;
        if (s.phase !== 'active' || s.hidden) continue;
        totalTicks++;
        let seen = false;
        for (let gi = 0; gi < programs.length && !seen; gi++) {
          const pose = poseAt(programs[gi], tick);
          if (!pose.present) continue;
          const def = level.json.guards[gi];
          seen = seesPoint(
            opaque, level.w, level.h,
            pose.x, pose.y, pose.facingDeg,
            def.vision.fovDeg, def.vision.range / level.cellSize, s.x, s.y,
          );
        }
        for (const c of level.json.cameras) {
          if (seen) break;
          seen = seesPoint(
            opaque, level.w, level.h,
            c.cell[0] + 0.5, c.cell[1] + 0.5,
            cameraFacingAt(c.facingDeg, c.sweep, tick),
            c.fovDeg, c.range / level.cellSize, s.x, s.y,
          );
        }
        if (seen) {
          seenTicks++;
          planSeen = true;
        }
      }
      if (planSeen) seenPlans++;
    }
    const tickRate = seenTicks / Math.max(1, totalTicks);
    const planRate = seenPlans / Math.max(1, plain.length);
    console.log(
      `exposed ticks ${seenTicks}/${totalTicks} (${(tickRate * 100).toFixed(2)}%), ` +
        `plans ever exposed ${seenPlans}/${plain.length} (${(planRate * 100).toFixed(1)}%)`,
    );
    expect(tickRate).toBeLessThan(0.02);
    expect(planRate).toBeLessThan(0.2);
  });

  it('reaches the vault when a small team runs the plans for real', () => {
    const world = new SimWorld(level, 5);
    world.respawnEnabled = false;
    const picked = job.plans.slice(0, 8);
    picked.forEach((p, i) => world.spawnPlanThief(p, `agent-${i}`));
    let breaches = 0;
    const horizonTicks = level.json.rules.horizonSec * level.json.rules.tickHz;
    for (let t = 0; t < horizonTicks; t++) {
      world.step();
      for (const e of world.drainEvents()) if (e.kind === 'breach') breaches++;
    }
    console.log(`live run: ${breaches} of ${picked.length} agents reached the vault`);
    expect(breaches).toBeGreaterThan(0);
  });
});
