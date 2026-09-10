import type { GameFlow } from '../game/flow';
import type { SimEvent } from '../sim/events';
import type {
  EntryId,
  JournalEvent,
  Snapshot,
  ThiefSnapshot,
} from './protocol';

export type ProjectionSource = Pick<
  GameFlow,
  'state' | 'world' | 'session' | 'missions' | 'paused' | 'displayState'
>;

/** No DOM, renderer, or changes to the simulation: this is only a projection. */
export class SnapshotProjector {
  private journal: JournalEvent[] = [];
  private eventId = 0;
  private sequence = 0;
  private visit = -1;
  private target = 0;
  private boot = '';
  constructor(
    public source: string,
    private readonly nextTarget: () => number,
    boot = String(Date.now()),
  ) {
    this.boot = boot;
  }

  private syncVisit(flow: ProjectionSource): void {
    if (flow.session.visit === this.visit) return;
    this.visit = flow.session.visit;
    this.target = this.nextTarget();
    this.journal = [];
    this.eventId = 0;
  }
  note(flow: ProjectionSource, event: SimEvent): void {
    this.syncVisit(flow);
    // Only the visitor's thief round belongs on this display.
    if (flow.state !== 'round1') return;
    this.journal.push({
      id: ++this.eventId,
      tick: flow.world.tick,
      stage: flow.state,
      event: { ...event },
    });
    if (this.journal.length > 48)
      this.journal.splice(0, this.journal.length - 48);
  }
  capture(
    flow: ProjectionSource,
    now: number,
    language: 'en' | 'he',
  ): Snapshot {
    this.syncVisit(flow);
    const base = {
      v: 2 as const,
      source: this.source,
      run: `${this.boot}:${this.visit}`,
      seq: ++this.sequence,
      sentAt: now,
      target: this.target,
      stageMs: 0,
      tick: 0,
      paused: flow.paused,
      language,
      operator: flow.session.codename,
    };
    // Idle heartbeats never inspect the world, missions, agents, or planner.
    if (flow.state !== 'round1') return { ...base, state: flow.state };
    const w = flow.world;
    const level = w.level;
    const p = w.player;
    const phases = flow.missions.phases;
    const objectives = phases.flatMap((x) =>
      x.objectives.map((o) => ({ id: o.id, state: o.state })),
    );
    const used = objectives.find(
      (o) => o.id.startsWith('foothold.') && o.state === 'done',
    );
    let focus = (used?.id.split('.')[1] ?? 'front') as EntryId;
    if (!used && p) {
      const discovered = objectives
        .filter((o) => o.id.startsWith('foothold.') && o.state !== 'hidden')
        .map((o) => o.id.split('.')[1]);
      const nearest = level.json.entries
        .filter((e) => discovered.includes(e.id))
        .sort(
          (a, b) =>
            Math.hypot(a.spawn[0] - p.x, a.spawn[1] - p.y) -
            Math.hypot(b.spawn[0] - p.x, b.spawn[1] - p.y),
        )[0];
      if (nearest) focus = nearest.id as EntryId;
    }
    if (w.activePick && !p?.breached && !used) focus = 'side';
    if (w.playerInTruck) focus = 'dock';
    if (p?.portalRef?.def.id === 'p_vent') focus = 'vent';
    if (p?.portalRef?.def.id === 'p_sewer') focus = 'sewer';
    const interaction: ThiefSnapshot['interaction'] = w.activeDrill
      ? {
          kind: 'drill',
          progress: w.activeDrill.progress,
          heat: w.activeDrill.heat,
          jammed: w.activeDrill.jammed,
        }
      : w.activeWire
        ? {
            kind: 'wire',
            progress:
              w.activeWire.wires.filter((x) => x.live && x.cut).length /
              Math.max(1, w.activeWire.wires.filter((x) => x.live).length),
            heat: 0,
            jammed: w.activeWire.jammed,
          }
        : w.activePick
          ? {
              kind: 'lockpick',
              progress: w.activePick.progress,
              heat: w.activePick.marker,
              jammed:
                w.activePick.lastResult === 'miss' &&
                w.activePick.flashTicks > 0,
            }
          : w.playerInTruck
            ? {
                kind: 'truck',
                progress: w.truck.phase === 'unloading' ? 1 : 0.5,
                heat: 0,
                jammed: false,
              }
            : null;
    const raw = flow.displayState;
    return {
      ...base,
      state: flow.state,
      stageMs: raw.elapsedMs,
      tick: w.tick,
      phase: flow.missions.activePhase?.id ?? 'recon',
      objectives,
      focusEntry: focus,
      player: p
        ? {
            inside: !!level.indoor[Math.floor(p.y) * level.w + Math.floor(p.x)],
            hidden: p.hidden,
            breached: p.breached,
            carrying: p.carrying,
            disguised: w.isDisguised(p),
            card: level.json.keycards.some(
              (k) => (k.kind ?? 'card') === 'card' && p.keys.has(k.id),
            ),
            caught: p.caughtCount,
            respawning: p.respawnIn > 0,
          }
        : null,
      security: {
        alarm: w.alarmActive,
        camerasDown: w.camerasDown,
        locksLeft: w.chief.locksLeft,
        doors: level.doors.map((d, i) => ({
          id: d.id,
          locked: !!w.doorLocked[i],
        })),
        guards: w.guards.map((g) => ({
          id: g.id,
          state: g.state,
          x: g.x,
          y: g.y,
        })),
      },
      interaction,
      exfil: {
        hole: w.holeOpen,
        van: w.van.parked,
        loads: w.loadsOut,
        needed: w.loadsNeeded,
        complete: w.exfilDone,
        channelProgress: w.exfilChannelProgress,
        carrying: w.thieves.filter((t) => t.active && t.carrying).length,
      },
      events: this.journal.map((e) => ({ ...e, event: { ...e.event } })),
    };
  }
}
