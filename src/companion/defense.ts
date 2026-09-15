import { TIMERS } from '../config';
import type { SimEvent } from '../sim/events';
import type { Thief } from '../sim/world';
import type { AgentStatus, DefenseAgent, DefenseLog, DefenseSnapshot, IncidentLevel } from './protocol';
import type { ProjectionSource } from './snapshot';

const JOURNAL_LIMIT = 160;
const finished = new Set<AgentStatus>(['caught', 'held', 'expired', 'breached', 'extracting', 'extracted']);
export const agentUnresolved = (a: DefenseAgent): boolean => !finished.has(a.status) && a.status !== 'queued';

/** A read-only SIEM projection. Every row is an event or an observed state change. */
export class DefenseProjector {
  private epoch = '';
  private generation = 0;
  private lastTick = -1;
  private startTick = 0;
  private logs: DefenseLog[] = [];
  private total = 0;
  private buckets = new Map<number, number>();
  private actors = new Map<number, { status: AgentStatus; inside: boolean }>();
  private powerDown = false;
  private retired = new Map<number, 'held' | 'expired'>();
  private replans = 0;
  private ready = false;

  private sync(f: ProjectionSource): void {
    const key = `${f.session.visit}:${f.state}:${f.defenseDisplayState?.revision ?? 0}`;
    if (key !== this.epoch || f.world.tick < this.lastTick) {
      this.epoch = key;
      this.generation++;
      this.startTick = f.world.tick;
      this.logs = [];
      this.total = 0;
      this.buckets.clear();
      this.actors.clear();
      this.retired.clear();
      this.powerDown = f.world.camerasDown;
      this.replans = f.displayState.replanCount ?? 0;
      this.ready = false;
    }
    this.lastTick = f.world.tick;
  }
  private now(f: ProjectionSource): number {
    return (f.world.tick - this.startTick) * 1000 / f.world.level.json.rules.tickHz;
  }
  private add(f: ProjectionSource, code: string, level: IncidentLevel, source: string, actor?: number): void {
    const atMs = this.now(f);
    const entry = actor === undefined ? undefined : f.world.thieves.find(t => t.id === actor)?.entryId;
    this.logs.push({ id: ++this.total, tick: f.world.tick, atMs, code, level, source, actor, entry });
    if (this.logs.length > JOURNAL_LIMIT) this.logs.shift();
    const bucket = Math.floor(atMs / 1000);
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + 1);
  }
  note(f: ProjectionSource, e: SimEvent): void {
    this.sync(f);
    if (f.state !== 'round2a' && f.state !== 'round2b') return;
    const actor = 'thief' in e ? e.thief : undefined;
    const add = (code: string, level: IncidentLevel, source = 'sensor') => this.add(f, code, level, source, actor);
    const door = 'door' in e ? f.world.level.doors[e.door]?.id ?? String(e.door) : '';
    switch (e.kind) {
      case 'guardOrdered': add('guard.ordered', 'info', e.guard); break;
      case 'spotted': add('guard.spotted', 'warning', e.guard); break;
      case 'caught': add('agent.caught', 'success', e.guard); break;
      case 'breach': add('data.breach', 'critical', 'vault'); break;
      case 'alarm': add(e.source === 'chief' ? 'alarm.chief' : 'alarm.camera', 'warning', e.source); break;
      case 'doorLocked': add(e.locked ? 'door.locked' : 'door.unlocked', e.locked ? 'success' : 'info', door); break;
      case 'lockpickStart': add('access.pick', 'warning', door); break;
      case 'lockpickEnd': add('access.open', 'critical', door); break;
      case 'badged': add('access.badged', 'warning', door); break;
      case 'pickup': {
        const kind = f.world.level.json.keycards.find(k => k.id === e.key)?.kind ?? 'card';
        if (kind === 'card') add('identity.card', 'critical', e.key);
        break;
      }
      case 'disguised': add('identity.uniform', 'warning', 'identity'); break;
      // Power is observed in capture too: admin power controls have no SimEvent.
      case 'powerCut':
        if (!this.powerDown && f.world.camerasDown) add('monitor.offline', 'critical', 'cameras');
        this.powerDown = f.world.camerasDown;
        break;
      case 'portalEnter': add('transit.start', 'warning', e.portal); break;
      case 'portalExit': add('transit.end', 'warning', e.portal); break;
      case 'truckBoard': add('truck.board', 'warning', 'supplier'); break;
      case 'truckLeave': add(e.inside ? 'truck.inside' : 'truck.leave', 'warning', 'supplier'); break;
      case 'holeOpen': add('boundary.open', 'critical', 'perimeter'); break;
      case 'loadTaken': add('data.staged', 'critical', 'vault'); break;
      case 'loadDelivered': add('data.delivered', 'critical', 'egress'); break;
      case 'noise': add('noise', 'warning', `${Math.round(e.x)},${Math.round(e.y)}`); break;
      case 'thiefDone':
        if (e.reason === 'blocked' || e.reason === 'expired') this.retired.set(e.thief, e.reason === 'blocked' ? 'held' : 'expired');
        if (e.reason === 'blocked') add('agent.held', 'success', 'access-control');
        if (e.reason === 'expired') add('agent.expired', 'info', 'session');
        break;
    }
  }
  private agent(f: ProjectionSource, t: Thief): DefenseAgent {
    const inside = !!f.world.level.indoor[Math.floor(t.y) * f.world.level.w + Math.floor(t.x)];
    const node = t.plan?.nodes[t.nodeIdx];
    const status: AgentStatus = t.caught ? 'caught'
      : t.breached ? t.active && t.exfilIdx >= 0 ? 'extracting' : !t.active && t.exfilIdx >= 0 ? 'extracted' : 'breached'
      : !t.active ? this.retired.get(t.id) ?? 'expired'
      : t.ridingTruck ? 'truckRiding' : t.waitingForTruck ? 'truckWaiting'
      : t.hidden ? node?.kind === 'portal' ? 'transit' : 'queued'
      : t.blockedByDoor >= 0 ? 'blocked'
      : t.lockpickDoor >= 0 || node?.kind === 'lockpick' ? 'picking'
      : t.waiting ? 'waiting' : inside ? 'inside' : 'approach';
    return { id: t.id, name: t.codename, entry: t.entryId, status, inside,
      card: f.world.level.json.keycards.some(k => (!k.kind || k.kind === 'card') && t.keys.has(k.id)),
      disguised: f.world.isDisguised(t) };
  }
  capture(f: ProjectionSource): DefenseSnapshot['defense'] {
    this.sync(f);
    const w = f.world, live = f.state === 'round2a' || f.state === 'round2b';
    const agents = live ? w.thieves.filter(t => t.kind === 'plan').map(t => this.agent(f, t)) : [];
    for (const a of agents) {
      const previous = this.actors.get(a.id);
      if (!previous || previous.status !== a.status) {
        if (['queued', 'approach', 'waiting', 'truckWaiting', 'blocked'].includes(a.status))
          this.add(f, `agent.${a.status}`, a.status === 'blocked' ? 'warning' : 'info', a.entry, a.id);
      }
      if (a.inside && !previous?.inside && agentUnresolved(a))
        this.add(f, 'agent.inside', 'warning', a.entry, a.id);
      this.actors.set(a.id, { status: a.status, inside: a.inside });
    }
    if (w.camerasDown !== this.powerDown) {
      this.add(f, w.camerasDown ? 'monitor.offline' : 'monitor.online', w.camerasDown ? 'critical' : 'success', 'cameras');
      this.powerDown = w.camerasDown;
    }
    const replans = f.displayState.replanCount ?? 0;
    if (live && replans > this.replans) this.add(f, 'routes.replanned', 'warning', 'planner');
    this.replans = replans;
    const ready = !!f.defenseDisplayState?.planningReady;
    if (f.state === 'aiThink' && ready && !this.ready) this.add(f, 'plans.ready', 'info', 'planner');
    this.ready = ready;
    const nowMs = this.now(f), second = Math.floor(nowMs / 1000);
    for (const bucket of this.buckets.keys()) if (bucket < second - 29) this.buckets.delete(bucket);
    const history = Array.from({ length: 30 }, (_, i) => this.buckets.get(second - 29 + i) ?? 0);
    const verdict = f.session.round2?.waveA;
    const ended = f.state === 'round2b' ? f.defenseDisplayState?.ended ?? null
      : f.state === 'round2a' && verdict && verdict !== 'pending' ? verdict : null;
    return { epoch: `${this.epoch}:${this.generation}`, ended, nowMs,
      plannedAgents: f.state === 'aiThink' ? f.defenseDisplayState?.plannedAgents ?? 0 : agents.length,
      planningReady: ready, agents,
      active: agents.filter(agentUnresolved).length,
      queued: agents.filter(a => a.status === 'queued').length,
      inside: agents.filter(a => a.inside && agentUnresolved(a)).length,
      caught: agents.filter(a => a.status === 'caught').length,
      held: agents.filter(a => a.status === 'held').length,
      breached: agents.filter(a => ['breached', 'extracting', 'extracted'].includes(a.status)).length,
      alarm: w.alarmActive, camerasDown: w.camerasDown, locksLeft: w.chief.locksLeft,
      guards: w.guards.map(g => ({ id: g.id, state: g.state, present: g.present })),
      doors: w.level.doors.map((d, i) => ({ id: d.id, locked: !!w.doorLocked[i], bypassed: !!w.doorPickedOpen[i] })),
      logs: this.logs.map(log => ({ ...log })), totalEvents: this.total,
      eventsPerSecond: history.slice(-5).reduce((a, b) => a + b, 0) / 5, history,
      capMs: f.state === 'round2a' ? TIMERS.round2ACap : f.state === 'round2b' ? TIMERS.round2BCap : 0 };
  }
}
