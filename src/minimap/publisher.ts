import type { GameFlow } from '../game/flow';
import { mapSnapshot, minimapChannel } from './snapshot';

/** Read-only observer: only discovery and subscription messages are accepted. */
export function mountMinimap(flow: GameFlow, source: () => string) {
  const bus = new BroadcastChannel(minimapChannel());
  let until = 0, next = 0;
  const announce = () => bus.postMessage({ type:'source', id:source(), stage:flow.state });
  bus.onmessage = ({data}) => {
    if (data?.type === 'discover') announce();
    if (data?.type === 'watch' && data.id === source()) { until = performance.now()+4000; next=0; }
  };
  window.addEventListener('pagehide', e => { if (!e.persisted) bus.close(); });
  return { update(now: number) {
    if (now > until || now < next) return;
    next = now+200;
    bus.postMessage({ type:'map', id:source(), stage:flow.state, paused:flow.paused,
      suspended:document.hidden, sentAt:Date.now(), map:mapSnapshot(flow.world) });
  } };
}
