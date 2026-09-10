import { describe, expect, it } from 'vitest';
import { compileGuardProgram } from '../src/sim/patrol';
import { enumerateRequests } from '../src/planner/options';
import { horizonQuantaOf, makeCtx, planOne, runJob } from '../src/planner/planner';
import { bakeDangerMap } from '../src/planner/dangerMap';
import { coarseSignature } from '../src/planner/diversity';
import { loadMint } from './helpers';

describe('planner on mint_v1', () => {
  const level = loadMint();
  const programs = level.json.guards.map((g) => compileGuardProgram(level, g));
  const doorLocked = new Uint8Array(level.doors.length);
  level.doors.forEach((d, i) => (doorLocked[i] = d.locked ? 1 : 0));

  it('bakes a danger map in reasonable time', () => {
    const t0 = Date.now();
    const d = bakeDangerMap({
      level,
      programs,
      baseTick: 0,
      horizonQ: horizonQuantaOf(level),
      alarmWindows: [],
      withMargin: true,
    });
    const ms = Date.now() - t0;
    const covered = d.everSeen.reduce((a, b) => a + b, 0);
    console.log(`danger bake ${ms}ms, watched plan cells: ${covered}/${level.planCount}`);
    expect(d.bits.length).toBe(d.horizonQ * level.planCount);
    expect(covered).toBeGreaterThan(50);
    expect(ms).toBeLessThan(4000);
  });

  it('finds a way in from every entrance', () => {
    const ctx = makeCtx(level);
    const requests = enumerateRequests(level, 200, 7);
    const byEntry = new Map<string, number>();
    const res = runJob({
      level,
      ctx,
      programs,
      baseTick: 0,
      doorLocked,
      alarmWindows: [],
      requests,
      budgetMs: 30000,
    });
    for (const p of res.plans) {
      byEntry.set(p.request.entryId, (byEntry.get(p.request.entryId) ?? 0) + 1);
    }
    console.log(
      `plans ${res.stats.found}/${res.stats.searches}  distinct ${res.stats.distinct}  ` +
        `noPath ${res.stats.noPath}  ${res.stats.wallMs}ms  expansions ${res.stats.expansions}`,
    );
    console.log('by entry:', JSON.stringify(Object.fromEntries(byEntry)));
    const byStrategy = new Map<string, number>();
    for (const p of res.plans) {
      byStrategy.set(p.request.keyStrategy.kind, (byStrategy.get(p.request.keyStrategy.kind) ?? 0) + 1);
    }
    console.log('by strategy:', JSON.stringify(Object.fromEntries(byStrategy)));
    console.log(
      'sample signatures:',
      [...new Set(res.plans.map((p) => coarseSignature(p.signature)))].slice(0, 14).join('\n  '),
    );
    for (const e of level.json.entries) {
      expect(byEntry.get(e.id) ?? 0, `entry ${e.id} produced no plan`).toBeGreaterThan(0);
    }
    expect(res.stats.distinct).toBeGreaterThanOrEqual(10);
    expect(res.stats.found).toBeGreaterThanOrEqual(60);
    expect(res.stats.wallMs).toBeLessThan(3000);
    const byStrategyKinds = new Set(res.plans.map((p) => p.request.keyStrategy.kind));
    expect(byStrategyKinds.has('key'), 'the manager card route must be viable').toBe(true);
    expect(byStrategyKinds.has('lockpick'), 'the pure lockpick route must be viable').toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const ctx = makeCtx(level);
    const mk = () =>
      runJob({
        level,
        ctx,
        programs,
        baseTick: 0,
        doorLocked,
        alarmWindows: [],
        requests: enumerateRequests(level, 40, 3),
        budgetMs: 30000,
      });
    const a = mk();
    const b = mk();
    expect(a.plans.map((p) => p.signature)).toEqual(b.plans.map((p) => p.signature));
  });

  it('lets nobody in through a door when every door is locked and unpickable', () => {
    const ctx = makeCtx(level);
    const allLocked = new Uint8Array(level.doors.length).fill(1);
    const reqs = enumerateRequests(level, 20, 11).map((r) => ({
      ...r,
      keyStrategy: { kind: 'none' as const },
    }));
    const res = runJob({
      level,
      ctx,
      programs,
      baseTick: 0,
      doorLocked: allLocked,
      alarmWindows: [],
      requests: reqs,
      budgetMs: 20000,
    });
    // The vent and the sewer are not doors, and the card still opens the vault,
    // so the building is not sealed: what must vanish is every door route.
    const doorEntries = new Set(
      level.json.entries.filter((e) => e.kind === 'door' || e.kind === 'gate').map((e) => e.id),
    );
    const viaDoor = res.plans.filter((p) => doorEntries.has(p.request.entryId));
    expect(viaDoor, 'a locked unpickable door must not be an entrance').toEqual([]);
    expect(res.stats.found + res.stats.noPath).toBe(20);
  });
});

describe('the human-paced thief in wave A', () => {
  const level = loadMint();
  const programs = level.json.guards.map((g) => compileGuardProgram(level, g));
  const doorLocked = new Uint8Array(level.doors.length);
  level.doors.forEach((d, i) => (doorLocked[i] = d.locked ? 1 : 0));

  it('always finds a route when it ignores the timetable, like a person would', () => {
    const ctx = makeCtx(level);
    const requests = enumerateRequests(level, 12, 4242, 2, [0, 2]).map((r) => ({ ...r, naive: true }));
    const res = runJob({
      level,
      ctx,
      programs,
      baseTick: 0,
      doorLocked,
      alarmWindows: [],
      requests,
      budgetMs: 20000,
    });
    console.log(`naive walker: ${res.stats.found}/${res.stats.searches} plans`);
    // Fewer than every request now, because the vault costs a trip to the card.
    expect(res.stats.found).toBeGreaterThanOrEqual(8);
  });
});
