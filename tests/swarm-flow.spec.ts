import { expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera } from 'three';
import { GameFlow, type FlowDeps } from '../src/game/flow';
import type { JobOptions, PlanResult } from '../src/planner/client';
import { makeCtx, runJob } from '../src/planner/planner';
import { planningFixture } from './planning-fixture';
import { TIMERS } from '../src/config';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const api = (values: Record<string, unknown> = {}) => new Proxy(values, {
  get(target, key: string) { return target[key] ??= vi.fn(); },
});

function fixture() {
  const level = planningFixture(); level.doors[0].locked = false;
  const jobs: { opts: JobOptions; resolve: (result: PlanResult) => void; reject: (error: Error) => void }[] = [];
  let ready!: () => void;
  const readiness = new Promise<void>(resolve => { ready = resolve; });
  const overlay = api({ defense: api({ hit: () => ({ ui: false, alarm: false }) }), langToggle: api(), alarmButton: api() });
  const input = { onPresenterHotkey: vi.fn(), idle: false, state: {
    pointer: { x: 0, y: 0, click: { pressed: false } }, start: { pressed: false }, alarm: { pressed: false },
  } };
  const deps = {
    level, overlay, stage: api(), audio: api(), canvas: { clientWidth: 1280, clientHeight: 720 },
    director: api({ camera: new PerspectiveCamera() }),
    view: api({ building: { root: new Group(), doors: new Map() }, trails: api(), ribbons: api() }),
    input,
    planner: { whenReady: () => readiness, plan: (opts: JobOptions) => ({ jobId: jobs.length + 1,
      promise: new Promise<PlanResult>((resolve, reject) => jobs.push({ opts, resolve, reject })), cancel: vi.fn() }) },
  } as unknown as FlowDeps;
  const flow = new GameFlow(deps); flow.adminAssisted = true; flow.world.tick = 233;
  const finish = (index: number, empty = false) => {
    const { opts, resolve } = jobs[index];
    const job = runJob({ ...opts, level, ctx: makeCtx(level), programs: opts.guardPrograms, baseTick: opts.nowTick,
      budgetMs: 1000, requests: empty ? [] : opts.requests.slice(0, 1) });
    expect(job.plans.length).toBe(empty ? 0 : 1);
    resolve({ plans: job.plans, stats: job.stats, cancelled: false });
  };
  return { flow, jobs, finish, ready, overlay, input };
}

async function startSwarm() {
  const context = fixture();
  context.flow.enter('aiThink'); context.finish(0); await settle();
  context.flow.skipStage(); context.flow.update(1);
  expect(context.flow.world.thieves).toHaveLength(1);
  return context;
}

it('updates entrance pressure from live attackers, catches and the wave ending', async () => {
  const { flow, overlay } = await startSwarm();
  const actor = flow.world.thieves[0];
  actor.planStartTick = flow.world.tick - 1;
  flow.update(200);
  expect(overlay.setWays).toHaveBeenLastCalledWith([
    expect.objectContaining({ entryId: actor.entryId, active: 1, stopped: 0, breached: 0 }),
  ], 'WAYS IN');
  actor.caught = true; actor.active = false;
  flow.update(200);
  expect(overlay.setWays).toHaveBeenLastCalledWith([
    expect.objectContaining({ active: 0, stopped: 1, tone: 'stopped' }),
  ], 'WAYS IN');
});

it('requests a continuation for an unloaded stowaway without retiring it or ending the wave', async () => {
  const { flow, jobs, finish } = await startSwarm();
  const thief = flow.world.thieves[0];
  thief.plan = null; thief.hidden = false; thief.awaitingPlan = true; thief.waiting = true;
  flow.update(100);
  expect(jobs).toHaveLength(2);
  expect(thief.active).toBe(true); expect(thief.breached).toBe(false);
  expect(flow.defenseDisplayState.ended).toBeNull();
  expect(jobs[1].opts.requests[0].startPlanCell).toBeDefined();
  finish(1, true); await settle();
  expect(thief.awaitingPlan).toBe(true);
  expect(flow.displayState.replanCount).toBe(0); // No fabricated "routes adapted" incident for an empty search.
  flow.world.tick += flow.world.level.json.rules.tickHz * 2;
  flow.update(100);
  expect(jobs).toHaveLength(3);
  finish(2); await settle();
  expect(thief.awaitingPlan).toBe(false); expect(thief.plan).not.toBeNull();
  expect(flow.displayState.replanCount).toBe(1);
});

it('holds the completed swarm popup before results and freezes the world and score', async () => {
  const { flow, overlay } = await startSwarm();
  const thief = flow.world.thieves[0]; thief.active = false; thief.caught = true;
  flow.update(1);
  expect(flow.state).toBe('round2b');
  expect(overlay.swarmResult).toHaveBeenLastCalledWith({ reason: 'Every attacker has finished their run.', breaches: 0, caught: 1, progress: 0 });
  expect(flow.defenseDisplayState.ended).toBe('complete');
  const tick = flow.world.tick, held = flow.session.round2.heldMs;
  flow.tickSim(); flow.update(TIMERS.round2BResult - 1);
  expect(flow.state).toBe('round2b');
  expect(flow.world.tick).toBe(tick);
  expect(flow.session.round2.heldMs).toBe(held);
  flow.update(1);
  expect(flow.state).toBe('results');
  expect(overlay.swarmResult).toHaveBeenLastCalledWith(null);
});

it('waits for a breached attacker to finish walking out before concluding the swarm', async () => {
  const { flow, overlay } = await startSwarm();
  const thief = flow.world.thieves[0];
  thief.breached = true; thief.retired = true; thief.carrying = true; thief.exfilIdx = 0;
  flow.update(1000);
  expect(overlay.swarmResult).toHaveBeenLastCalledWith(null);
  expect(overlay.hud2).toHaveBeenLastCalledWith(expect.objectContaining({ thieves: 1 }));
  thief.active = false; thief.carrying = false;
  flow.update(1);
  expect(overlay.swarmResult).toHaveBeenLastCalledWith(expect.objectContaining({ breaches: 1, progress: 0 }));
});

it('explains the time limit and preserves the ending even when the idle timer also expires', async () => {
  const { flow, overlay, input } = await startSwarm(); input.idle = true;
  flow.update(TIMERS.round2BCap + 1);
  expect(flow.state).toBe('round2b');
  expect(overlay.swarmResult).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'Time is up. The defense round has ended.' }));
  const tick = flow.world.tick; flow.tickSim();
  expect(flow.world.tick).toBe(tick);
  flow.update(TIMERS.round2BResult);
  expect(flow.state).toBe('results');
});

it('lets a hands-off observer watch the longer approach without the idle reset cutting it off', async () => {
  const { flow, input, overlay } = await startSwarm(); input.idle = true;
  flow.update(TIMERS.idleGameplay + 1);
  expect(flow.state).toBe('round2b');
  expect(overlay.swarmResult).toHaveBeenLastCalledWith(null);
  flow.update(TIMERS.round2BCap - TIMERS.idleGameplay);
  expect(flow.state).toBe('round2b');
  expect(overlay.swarmResult).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'Time is up. The defense round has ended.' }));
});

it('pauses the ending hold, honors disabled timers, and clears it on reset', async () => {
  const { flow, overlay } = await startSwarm(); flow.world.thieves[0].active = false;
  flow.update(1); flow.paused = true; flow.update(10_000);
  expect(flow.state).toBe('round2b');
  flow.paused = false; flow.setAdminOption('timers', false); flow.update(10_000);
  expect(overlay.swarmResult).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0 }));
  flow.enter('aiThink');
  expect(overlay.swarmResult).toHaveBeenLastCalledWith(null);
  flow.setAdminOption('timers', true);
  flow.enter('round2a'); const tick = flow.world.tick; flow.tickSim();
  expect(flow.world.tick).toBeGreaterThan(tick);
});

it('waits for a slow planner, then reveals routes against the unchanged simulation clock', async () => {
  const { flow, jobs, finish } = fixture(); flow.enter('aiThink');
  for (let i = 0; i < 280; i++) { flow.tickSim(); flow.update(50); }
  expect(flow.state).toBe('aiThink');
  expect(flow.world.tick).toBe(233);
  expect(flow.world.thieves).toHaveLength(0);
  expect(jobs[0].opts.nowTick).toBe(235);
  finish(0); await settle();
  flow.update(1);
  expect(flow.state).toBe('aiThink');
  expect(flow.displayState.ways).toHaveLength(1);
  flow.update(4500);
  expect(flow.state).toBe('round2b');
  expect(flow.world.tick).toBe(233);
});

it('queues a skip until actual routes arrive instead of starting an empty swarm', async () => {
  const { flow, finish } = fixture(); flow.enter('aiThink'); flow.skipStage();
  expect(flow.state).toBe('aiThink');
  finish(0); await settle();
  expect(flow.state).toBe('round2b');
});

it('gives the handoff time to read before revealing routes and counting down a ready swarm', async () => {
  const { flow, finish, overlay } = fixture();
  flow.session.round2.waveA = 'caught';
  flow.enter('aiThink'); finish(0); await settle();
  flow.update(TIMERS.aiHandoff - 1);
  expect(overlay.swarmHandoff).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'Good job. You stopped one attacker.' }));
  expect(overlay.think).toHaveBeenLastCalledWith(expect.objectContaining({ ways: 0 }));
  expect(flow.world.thieves).toHaveLength(0);
  flow.update(1);
  expect(overlay.swarmHandoff).toHaveBeenLastCalledWith(null);
  flow.update(900);
  expect(overlay.think).toHaveBeenLastCalledWith(expect.objectContaining({ ways: 1 }));
  flow.update(420);
  for (const seconds of [3, 2, 1]) {
    expect(overlay.swarmCountdown).toHaveBeenLastCalledWith({ seconds, agents: 1 });
    expect(flow.state).toBe('aiThink');
    flow.update(1000);
  }
  flow.update(1);
  expect(flow.state).toBe('round2b');
  expect(flow.world.tick).toBe(233);
});

it.each([
  ['held', 'Good job. You blocked one attacker.'],
  ['breached', 'One attacker found a way through.'],
  ['timeout', 'That was the single-attacker challenge.'],
  ['pending', 'That was the single-attacker challenge.'],
] as const)('acknowledges the actual single-attacker outcome: %s', (outcome, result) => {
  const { flow, overlay } = fixture();
  flow.session.round2.waveA = outcome; flow.enter('aiThink');
  expect(overlay.swarmHandoff).toHaveBeenLastCalledWith({ result, progress: 0 });
});

it('pauses the handoff clock and animation, and starts it fresh on a stage reset', async () => {
  const { flow, finish, overlay } = fixture(); flow.enter('aiThink');
  finish(0); await settle(); flow.update(1000);
  flow.paused = true; flow.update(20_000);
  expect(flow.displayState.elapsedMs).toBe(1000);
  expect(overlay.setThinkPaused).toHaveBeenLastCalledWith(true);
  flow.paused = false; flow.update(1000);
  expect(overlay.setThinkPaused).toHaveBeenLastCalledWith(false);
  flow.setAdminOption('timers', false); flow.update(20_000);
  expect(flow.displayState.elapsedMs).toBe(2000);
  expect(overlay.setThinkPaused).toHaveBeenLastCalledWith(true);
  flow.enter('aiThink');
  expect(overlay.swarmHandoff).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0 }));
  expect(overlay.swarmCountdown).toHaveBeenLastCalledWith(null);
});

it('tries a broader search and reports a genuinely empty result without an empty round', async () => {
  const { flow, jobs, finish, overlay } = fixture(); flow.enter('aiThink');
  finish(0, true); await settle();
  expect(jobs).toHaveLength(2);
  expect(jobs[1].opts.requests.length).toBeGreaterThan(jobs[0].opts.requests.length);
  finish(1, true); await settle();
  flow.update(TIMERS.aiHandoff);
  expect(overlay.think).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'No route found through these defenses.' }));
  flow.update(3501);
  expect(flow.state).toBe('results');
});

it('ignores old completions after the thinking stage is reset', async () => {
  const { flow, jobs, finish } = fixture(); flow.enter('aiThink'); flow.enter('aiThink');
  finish(0); await settle();
  expect(jobs).toHaveLength(2);
  expect(flow.displayState.ways).toHaveLength(0);
  finish(1); await settle();
  expect(flow.displayState.ways).toHaveLength(1);
});

it('does not let delayed attract preparation cancel the defense search', async () => {
  const { flow, jobs, ready } = fixture(); flow.enter('aiThink');
  ready(); await settle();
  expect(jobs).toHaveLength(1);
  expect(flow.state).toBe('aiThink');
});

it('recovers from a worker error with a new search', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { flow, jobs, finish } = fixture(); flow.enter('aiThink');
    jobs[0].reject(new Error('worker failed')); await settle();
    expect(jobs).toHaveLength(2);
    finish(1); await settle(); flow.skipStage();
    expect(flow.state).toBe('round2b');
  } finally { error.mockRestore(); }
});
