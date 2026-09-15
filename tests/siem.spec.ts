import { beforeAll, describe, expect, it } from 'vitest';
import { MissionTracker } from '../src/game/missions';
import { Session } from '../src/game/session';
import { SnapshotProjector, type ProjectionSource } from '../src/companion/snapshot';
import { frameKey, renderSnapshot, sceneId } from '../src/companion/scenes';
import { isSnapshot, type DefenseSnapshot } from '../src/companion/protocol';
import { makeCtx, runJob } from '../src/planner/planner';
import { enumerateSwarmRequests } from '../src/planner/options';
import { planningSnapshot } from '../src/planner/snapshot';
import type { Plan } from '../src/planner/types';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

const level = loadMint();
let plans: Plan[];
beforeAll(() => {
  const world = new SimWorld(level, 5);
  const { nowTick, guardPrograms, ...dynamic } = planningSnapshot(world);
  plans = runJob({ level, ctx: makeCtx(level), baseTick: nowTick, programs: guardPrograms,
    ...dynamic, requests: enumerateSwarmRequests(level, 40, 777), budgetMs: 20000 }).plans;
  expect(plans.length).toBeGreaterThan(10);
});
function fixture(state: 'round2a' | 'round2b' = 'round2b') {
  const world = new SimWorld(level, 5), session = new Session(); session.reset('Tokyo');
  const flow: ProjectionSource = { world, session, state, paused: false, missions: new MissionTracker(),
    displayState: { elapsedMs: 0, ways: [], replanning: false, replanCount: 0 },
    defenseDisplayState: { revision: 1, ended: null, plannedAgents: 0, planningReady: false } };
  const projector = new SnapshotProjector('test', () => 0, 'boot');
  const capture = () => projector.capture(flow, 1000, 'en') as DefenseSnapshot;
  const drain = () => { const events = world.drainEvents(); events.forEach(e => projector.note(flow, e)); return events; };
  const step = () => { world.step(); drain(); return capture(); };
  capture();
  return { flow, world, session, projector, capture, drain, step };
}

describe('defense control room telemetry', () => {
  it('shows actual truck waiting, riding and unloading without calling the loading bay a vault breach', () => {
    const f = fixture(); f.world.catchesEnabled = false;
    const plan = plans.find(p => p.request.entryId === 'dock')!; expect(plan).toBeDefined();
    const thief = f.world.spawnPlanThief(plan, 'Stowaway');
    let sawWaiting = false, sawRide = false, unloaded = false;
    for (let i = 0; i < 1400 && !unloaded; i++) {
      const s = f.step(), status = s.defense.agents[0].status;
      if (status === 'truckWaiting') sawWaiting = true;
      if (status === 'truckRiding') {
        sawRide = true; expect(thief.ridingTruck).toBe(true);
        expect(renderSnapshot(s)).toContain('STOWED IN TRUCK');
      }
      unloaded = s.defense.logs.some(e => e.code === 'truck.inside');
      if (unloaded) {
        expect(s.defense.breached).toBe(0);
        expect(s.defense.logs.filter(e => e.code === 'truck.board')).toHaveLength(1);
        expect(s.defense.logs.filter(e => e.code === 'truck.inside')).toHaveLength(1);
      }
    }
    expect(sawWaiting).toBe(true); expect(sawRide).toBe(true); expect(unloaded).toBe(true);
  });
  it('starts with one real session and separates scheduled agents from active threats', () => {
    const f = fixture('round2a'); f.world.spawnPlanThief(plans[0], 'One');
    const before = f.capture();
    expect(before.defense.agents).toHaveLength(1);
    expect(before.defense.queued).toBe(1); expect(before.defense.active).toBe(0);
    expect(renderSnapshot(before)).toContain('data-mode="single"');
    for (let i = 0; i < 300 && !f.capture().defense.active; i++) f.step();
    expect(f.capture().defense.active).toBe(1);
    expect(f.capture().defense.logs.some(e => e.code === 'agent.approach')).toBe(true);
  });

  it('tracks a real multi-entry swarm and logs exactly the catches, breaches and deliveries emitted by the world', () => {
    const f = fixture(); plans.forEach(p => f.world.spawnPlanThief(p, `AI ${p.agentId}`));
    f.capture();
    const emitted = { breach: 0, caught: 0, loadDelivered: 0 };
    const seen = new Map<number, string>(); let maxActive = 0, maxInside = 0;
    for (let i = 0; i < 1200; i++) {
      f.world.step();
      for (const e of f.drain()) if (e.kind in emitted) emitted[e.kind as keyof typeof emitted]++;
      const s = f.capture(); maxActive = Math.max(maxActive, s.defense.active); maxInside = Math.max(maxInside, s.defense.inside);
      s.defense.logs.forEach(e => seen.set(e.id, e.code));
      expect(s.defense.breached).toBe(f.world.thieves.filter(t => t.breached).length);
      expect(s.defense.caught).toBe(f.world.thieves.filter(t => t.caught).length);
    }
    expect(maxActive).toBeGreaterThan(10); expect(maxInside).toBeGreaterThan(5);
    const count = (code: string) => [...seen.values()].filter(v => v === code).length;
    expect(count('data.breach')).toBe(emitted.breach);
    expect(count('agent.caught')).toBe(emitted.caught);
    expect(count('data.delivered')).toBe(emitted.loadDelivered);
    expect(emitted.breach).toBeGreaterThan(5); expect(emitted.loadDelivered).toBeGreaterThan(0);
    expect(new Set(f.capture().defense.agents.map(a => a.entry)).size).toBe(5);
  });

  it('reflects actual security controls, records door holds separately from timeout, and detaches snapshots', () => {
    const f = fixture();
    const held = f.world.spawnPlanThief(plans[0], 'Held');
    const expired = f.world.spawnPlanThief(plans[1], 'Expired');
    f.capture();
    f.world.abandonThief(held, 'blocked'); f.world.abandonThief(expired, 'expired'); f.drain();
    f.world.setPowerEnabled(false);
    const lock = level.doors.findIndex(d => d.lockableByChief && !f.world.doorLocked[level.doorIndex.get(d.id)!]);
    expect(f.world.lockDoor(lock, true, true)).toBe(true); f.drain();
    const s = f.capture();
    expect(s.defense.held).toBe(1); expect(s.defense.caught).toBe(0); expect(s.defense.active).toBe(0);
    expect(s.defense.agents.find(a => a.id === expired.id)?.status).toBe('expired');
    expect(s.defense.camerasDown).toBe(true); expect(s.defense.doors[lock].locked).toBe(true);
    expect(s.defense.logs.filter(e => e.code === 'monitor.offline')).toHaveLength(1);
    expect(s.defense.logs.some(e => e.code === 'door.locked')).toBe(true);
    s.defense.logs[0].code = 'tampered'; s.defense.guards[0].state = 'tampered';
    expect(f.capture().defense.logs[0].code).not.toBe('tampered'); expect(f.world.guards[0].state).not.toBe('tampered');
    f.world.setPowerEnabled(true);
    expect(f.capture().defense.logs.at(-1)?.code).toBe('monitor.online');
  });

  it('shows real guard dispatches and only reports new completed replans', () => {
    const f = fixture();
    const destination = level.walk.findIndex((walk, cell) => !!walk && !!level.indoor[cell]);
    const guard = f.world.orderNearestGuardTo(destination);
    expect(guard).not.toBeNull(); f.drain();
    const first = f.capture();
    expect(first.defense.logs.at(-1)).toMatchObject({ code: 'guard.ordered', source: guard!.id });
    expect(first.defense.guards.find(g => g.id === guard!.id)?.state).toBe('return');
    f.flow.displayState.replanCount++;
    const second = f.capture();
    expect(second.defense.logs.filter(e => e.code === 'routes.replanned')).toHaveLength(1);
    expect(f.capture().defense.totalEvents).toBe(second.defense.totalEvents);
  });

  it('does not manufacture activity on a heartbeat or while paused; clock and journal follow simulation ticks', () => {
    const f = fixture(); f.world.spawnPlanThief(plans[0], 'One'); const first = f.capture();
    f.flow.paused = true;
    for (let i = 0; i < 30; i++) expect(f.capture().defense).toEqual(first.defense);
    f.flow.paused = false;
    f.world.tick += 120;
    const later = f.capture();
    expect(later.defense.totalEvents).toBe(first.defense.totalEvents);
    expect(later.defense.eventsPerSecond).toBe(0);
    expect(later.defense.nowMs).toBe(6000);
  });

  it('clears old incidents on stage/revision/visit changes and shows actual planning progress without active attackers', () => {
    const f = fixture('round2a'); f.world.spawnPlanThief(plans[0], 'One'); f.capture();
    f.flow.state = 'aiThink';
    Object.assign(f.flow.defenseDisplayState!, { revision: 2, ended: null, plannedAgents: 27, planningReady: true });
    const thinking = f.capture();
    expect(thinking.defense.active).toBe(0); expect(thinking.defense.agents).toEqual([]);
    expect(thinking.defense.plannedAgents).toBe(27); expect(thinking.defense.logs).toHaveLength(1);
    expect(renderSnapshot(thinking)).toContain('27 agents ready');
    f.flow.state = 'round2b'; f.flow.defenseDisplayState!.revision++;
    const swarm = f.capture(); expect(swarm.defense.logs.every(e => e.code !== 'plans.ready')).toBe(true);
    f.world.triggerAlarm('chief', 40, 40); f.drain();
    const old = f.capture(); expect(old.defense.logs.some(e => e.code === 'alarm.chief')).toBe(true);
    f.flow.defenseDisplayState!.revision++;
    expect(f.capture().defense.epoch).not.toBe(old.defense.epoch);
    expect(f.capture().defense.logs.some(e => e.code === 'alarm.chief')).toBe(false);
    f.session.reset('Berlin'); expect(f.capture().run).not.toBe(old.run);
    expect(frameKey(swarm)).not.toBe(frameKey(thinking));
  });

  it('bounds the journal but keeps true event volume, and shows only recent real alerts', () => {
    const f = fixture();
    for (let i = 0; i < 190; i++) f.projector.note(f.flow, { kind: 'guardOrdered', guard: 'g1' });
    f.projector.note(f.flow, { kind: 'breach', thief: 10, x: 40, y: 20, tick: 0 });
    let s = f.capture();
    expect(s.defense.logs).toHaveLength(160); expect(s.defense.totalEvents).toBe(191);
    expect(s.defense.eventsPerSecond).toBe(191 / 5);
    expect(renderSnapshot(s)).toContain('data-key="alert-191"');
    f.world.tick += 100; s = f.capture();
    expect(renderSnapshot(s)).not.toContain('data-key="alert-191"');
    expect(s.defense.logs.at(-1)?.code).toBe('data.breach');
  });

  it('renders every defense stage in both languages, freezes endings, and escapes all event text', () => {
    const f = fixture();
    for (const state of ['brief2', 'round2a', 'aiThink', 'round2b'] as const) {
      f.flow.state = state;
      const s = f.capture();
      expect(isSnapshot(s)).toBe(true); expect(sceneId(s)).toMatch(/^defense-/);
      for (let target = 0; target < 6; target++) for (const language of ['en', 'he'] as const) {
        const html = renderSnapshot({ ...s, target, language });
        expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
        expect(html).toContain('SIEM'); expect(html).not.toContain('fictional-browser');
      }
    }
    f.projector.note(f.flow, { kind: 'guardOrdered', guard: '<img src=x>' });
    f.projector.note(f.flow, { kind: 'breach', thief: 7, x: 0, y: 0, tick: 0 });
    expect(renderSnapshot(f.capture())).toContain('&lt;img');
    expect(renderSnapshot(f.capture())).not.toContain('<img');
    f.flow.defenseDisplayState!.ended = 'complete';
    const ended = renderSnapshot(f.capture());
    expect(ended).toContain('SWARM ENDED'); expect(ended).toContain('data-ended="true"');
    expect(ended).not.toContain('class="siem-alert"');
    f.flow.defenseDisplayState!.ended = null; f.flow.paused = true;
    expect(renderSnapshot(f.capture())).not.toContain('class="siem-alert"');
  });
});
