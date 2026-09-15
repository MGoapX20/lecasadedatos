import type { PhaseId } from '../game/missions';
import type { SimEvent } from '../sim/events';

export const PROTOCOL = 2;
export const DISCOVERY = 'casa.red-team.discovery.v2';
export const channelName = (source: string): string =>
  `casa.red-team.v2.${source}`;
export type EntryId = 'front' | 'side' | 'dock' | 'vent' | 'sewer';
export type GameState =
  | 'attract'
  | 'brief1'
  | 'round1'
  | 'r1result'
  | 'brief2'
  | 'round2a'
  | 'aiThink'
  | 'round2b'
  | 'results'
  | 'presenter';
export interface JournalEvent {
  id: number;
  tick: number;
  stage: GameState;
  event: SimEvent;
}
interface SnapshotBase {
  v: 2;
  source: string;
  run: string;
  seq: number;
  sentAt: number;
  target: number;
  state: GameState;
  stageMs: number;
  tick: number;
  paused: boolean;
  suspended?: boolean;
  language: 'en' | 'he';
  operator: string;
}
export interface StandbySnapshot extends SnapshotBase {
  state: Exclude<GameState, 'round1' | DefenseStage>;
}
export type DefenseStage = 'brief2' | 'round2a' | 'aiThink' | 'round2b';
export const isDefenseStage = (state: string): state is DefenseStage =>
  ['brief2', 'round2a', 'aiThink', 'round2b'].includes(state);
export const isLiveStage = (state: string): boolean => state === 'round1' || isDefenseStage(state);

export type IncidentLevel = 'info' | 'warning' | 'critical' | 'success';
export type AgentStatus = 'queued' | 'approach' | 'inside' | 'waiting' | 'transit' | 'truckWaiting' | 'truckRiding' | 'picking' | 'blocked' | 'caught' | 'held' | 'expired' | 'breached' | 'extracting' | 'extracted';
export interface DefenseAgent {
  id: number; name: string; entry: string; status: AgentStatus; inside: boolean;
  card: boolean; disguised: boolean;
}
export interface DefenseLog {
  id: number; tick: number; atMs: number; level: IncidentLevel;
  code: string; source: string; actor?: number; entry?: string;
}
export interface DefenseSnapshot extends SnapshotBase {
  state: DefenseStage;
  defense: {
    epoch: string; nowMs: number;
    ended: 'complete' | 'timeout' | 'caught' | 'held' | 'breached' | null;
    plannedAgents: number; planningReady: boolean;
    agents: DefenseAgent[];
    active: number; queued: number; inside: number; caught: number; held: number; breached: number;
    alarm: boolean; camerasDown: boolean; locksLeft: number;
    guards: { id: string; state: string; present: boolean }[];
    doors: { id: string; locked: boolean; bypassed: boolean }[];
    logs: DefenseLog[]; totalEvents: number; eventsPerSecond: number; history: number[];
    capMs: number;
  };
}
export interface ThiefSnapshot extends SnapshotBase {
  professor?: { phases: import('../game/missions').Phase[]; guide: string | null };
  state: 'round1';
  phase: PhaseId | null;
  objectives: { id: string; state: 'hidden' | 'open' | 'done' }[];
  focusEntry: EntryId;
  player: null | {
    inside: boolean;
    hidden: boolean;
    breached: boolean;
    carrying: boolean;
    disguised: boolean;
    card: boolean;
    caught: number;
    respawning: boolean;
  };
  security: {
    alarm: boolean;
    camerasDown: boolean;
    locksLeft: number;
    doors: { id: string; locked: boolean }[];
    guards: { id: string; state: string; x: number; y: number }[];
  };
  interaction: null | {
    kind: 'lockpick' | 'wire' | 'drill' | 'truck';
    progress: number;
    heat: number;
    jammed: boolean;
  };
  exfil: {
    hole: boolean;
    van: boolean;
    loads: number;
    needed: number;
    complete: boolean;
    carrying: number;
    channelProgress: number;
  };
  events: JournalEvent[];
}

export type Snapshot = ThiefSnapshot | DefenseSnapshot | StandbySnapshot;

export type WireMessage =
  | { type: 'hello'; v: 2 }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'offline'; source: string };
export interface SourceInfo {
  source: string;
  operator: string;
  state: GameState;
  sentAt: number;
}
export const isSnapshot = (x: unknown): x is Snapshot => {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<Snapshot>;
  return (
    s.v === PROTOCOL &&
    typeof s.source === 'string' &&
    typeof s.run === 'string' &&
    Number.isFinite(s.seq) &&
    typeof s.sentAt === 'number' &&
    typeof s.language === 'string' &&
    typeof s.operator === 'string' &&
    [
      'attract',
      'brief1',
      'round1',
      'r1result',
      'brief2',
      'round2a',
      'aiThink',
      'round2b',
      'results',
      'presenter',
    ].includes(s.state ?? '') &&
    (s.state !== 'round1' ||
      (Array.isArray(s.events) &&
        Array.isArray(s.objectives) &&
        !!s.security &&
        !!s.exfil)) &&
    (!isDefenseStage(s.state ?? '') || ('defense' in s && !!s.defense &&
      Array.isArray(s.defense.agents) && Array.isArray(s.defense.logs)))
  );
};

/** A pure receiver reducer: old/foreign packets never rewind the display. */
export class SnapshotInbox {
  latest: Snapshot | null = null;
  receivedAt = 0;
  constructor(readonly source: string) {}
  accept(value: unknown, now: number): boolean {
    if (!isSnapshot(value) || value.source !== this.source) return false;
    if (
      this.latest &&
      value.run === this.latest.run &&
      value.seq <= this.latest.seq
    )
      return false;
    if (
      this.latest &&
      value.run !== this.latest.run &&
      value.sentAt < this.latest.sentAt
    )
      return false;
    this.latest = value;
    this.receivedAt = now;
    return true;
  }
  stale(now: number): boolean {
    return !this.latest || now - this.receivedAt > 3500;
  }
}
