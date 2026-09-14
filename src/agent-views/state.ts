import type { Thief } from '../sim/world';
import type { CharacterPose } from '../render/characters';
import type { LevelJson } from '../level/schema';

export const AGENT_CHANNEL = 'casa.agent-views.v2';
export const defenseStage = (stage: string) => stage === 'round2a' || stage === 'round2b';
export interface AgentInfo { id: number; name: string; action: string; live: boolean; hidden: boolean; agentId?: number; total?: number; active?: number }
export interface ViewWay { id: number; name: string; agentIds: number[] }
export interface ObjectPose { position: number[]; quaternion: number[]; scale: number[]; visible: boolean }
export interface SceneSnapshot {
  tick: number; thieves: { id: number; pose: CharacterPose }[]; guards: CharacterPose[];
  doors: [number, number][]; cameras: [number, number][];
  keys: [number, ObjectPose, ObjectPose][]; hole: boolean; power: boolean;
  truck: ObjectPose | null; van: ObjectPose | null;
}
export interface AgentRoster {
  type: 'roster'; source: string; epoch: string; seq: number; stage: string;
  paused: boolean; suspended: boolean; agents: AgentInfo[];
  totalAgents: number; scene: SceneSnapshot; level?: LevelJson;
}

/** Match the game's way rows, retaining a live representative until it finishes. */
export function wayViews(ways: ViewWay[], thieves: Thief[], selected: Map<number, number>): AgentInfo[] {
  const byId = new Map(thieves.map(t => [t.id, t]));
  return ways.map(way => {
    const members = way.agentIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    const live = members.filter(t => agentInfo(t).live);
    const previous = live.find(t => t.id === selected.get(way.id));
    const representative = previous && !previous.hidden ? previous : live.find(t => !t.hidden) ?? live[0]
      ?? members.find(t => t.breached) ?? members[0];
    if (representative) selected.set(way.id, representative.id);
    const info = representative ? agentInfo(representative) : { action: 'No active agents', live: false, hidden: false };
    return { ...info, id: way.id, agentId: representative?.id, name: way.name, total: members.length, active: live.length };
  });
}

export function agentInfo(t: Thief): AgentInfo {
  const live = t.active && !t.caught && !t.retired && !t.breached;
  const node = t.plan?.nodes[t.nodeIdx];
  const action = t.caught ? 'Caught' : t.breached ? 'Vault reached' : !live ? 'Held'
    : t.hidden ? (node?.kind === 'portal' ? 'In transit' : 'Waiting to enter')
    : t.blockedByDoor >= 0 ? 'Blocked at door'
    : t.lockpickDoor >= 0 || node?.kind === 'lockpick' ? 'Picking lock'
    : t.waiting || node?.kind === 'wait' ? 'Waiting'
    : 'Moving';
  return { id: t.id, name: t.codename.startsWith('#') ? `Agent ${t.codename}` : t.codename || `Agent ${t.id}`, action, live, hidden: t.hidden };
}

/** Keep every feed on screen, choosing the largest possible 16:9 view. */
export function gridShape(count: number, width: number, height: number) {
  let columns = 1, best = -1;
  for (let c = 1; c <= Math.max(1, count); c++) {
    const r = Math.ceil(count / c) || 1;
    const score = Math.min((width - (c - 1) * 10) / c, (height - (r - 1) * 10) / r * 16 / 9);
    if (score > best) { best = score; columns = c; }
  }
  return { columns, rows: Math.ceil(count / columns) || 1 };
}
