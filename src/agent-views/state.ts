import type { Thief } from '../sim/world';

export const AGENT_CHANNEL = 'casa.agent-views.v1';
export const defenseStage = (stage: string) => stage === 'round2a' || stage === 'round2b';
export interface AgentInfo { id: number; name: string; action: string; live: boolean; hidden: boolean }
export interface AgentRoster {
  type: 'roster'; source: string; epoch: string; seq: number; stage: string;
  paused: boolean; suspended: boolean; agents: AgentInfo[];
}
export interface AgentFrame {
  type: 'frame'; source: string; epoch: string; seq: number; id: number; image: Blob;
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
