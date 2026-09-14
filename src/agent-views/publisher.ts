import type { GameFlow } from '../game/flow';
import type { WorldView } from '../render/worldView';
import { AGENT_CHANNEL, defenseStage, wayViews, type AgentRoster } from './state';

/** The game publishes compact transforms only. Rendering belongs to the spectator page. */
export function mountAgentViews(flow: GameFlow, view: WorldView, source: () => string) {
  const bus = new BroadcastChannel(AGENT_CHANNEL);
  const selected = new Map<number, number>();
  let until = 0, next = 0, seq = 0, sendLevel = true;
  let epoch = crypto.randomUUID(), previousStage = '', previousTick = -1;
  bus.onmessage = ({ data }) => {
    if (data?.type !== 'watch' || data.source !== source()) return;
    until = performance.now() + 3500;
    if (data.needsLevel) sendLevel = true;
  };
  function update(now: number) {
    if (flow.state !== previousStage || flow.world.tick < previousTick) {
      epoch = crypto.randomUUID(); selected.clear(); next = 0; sendLevel = true;
      previousStage = flow.state;
    }
    previousTick = flow.world.tick;
    if (now > until || now < next || !defenseStage(flow.state)) return;
    next = now + 100;
    const packet: AgentRoster = { type: 'roster', source: source(), epoch, seq: ++seq,
      stage: flow.state, paused: flow.paused, suspended: document.hidden,
      agents: wayViews(flow.agentViewWays, flow.world.thieves, selected),
      totalAgents: flow.world.thieves.filter(t => t.kind === 'plan').length,
      scene: view.captureAgentScene(flow.world),
      ...(sendLevel ? { level: flow.world.level.json } : {}) };
    bus.postMessage(packet); sendLevel = false;
  }
  window.addEventListener('pagehide', e => { if (!e.persisted) bus.close(); });
  return { update };
}
