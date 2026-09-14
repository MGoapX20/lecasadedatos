import { AGENT_CHANNEL, defenseStage, gridShape, type AgentFrame, type AgentInfo, type AgentRoster } from './state';

interface Tile { root: HTMLElement; canvas: HTMLCanvasElement; name: HTMLElement; action: HTMLElement; cover: HTMLElement; seq: number; info: AgentInfo }

export function mountAgentBoard(host: HTMLElement) {
  const bus = new BroadcastChannel(AGENT_CHANNEL);
  host.innerHTML = '<div class="agent-summary"><span id="agent-mode"></span><span id="agent-count"></span></div><div class="agent-grid" aria-label="Live agent first-person views"></div><p class="agent-empty">Waiting for agents…</p>';
  const grid = host.querySelector<HTMLElement>('.agent-grid')!;
  const empty = host.querySelector<HTMLElement>('.agent-empty')!;
  const mode = host.querySelector<HTMLElement>('#agent-mode')!;
  const count = host.querySelector<HTMLElement>('#agent-count')!;
  const tiles = new Map<number, Tile>();
  let source = '', stage = '', epoch = '', rosterSeq = -1, received = 0, active = false, disposed = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const watch = () => { if (source && active && !document.hidden) bus.postMessage({ type: 'watch', source }); };
  const clear = () => { tiles.clear(); grid.replaceChildren(); epoch = ''; rosterSeq = -1; received = 0; empty.hidden = false; count.textContent = ''; };
  function layout(animate = false, before = new Map([...tiles].map(([id, t]) => [id, t.root.getBoundingClientRect()]))) {
    const shape = gridShape(tiles.size, grid.clientWidth, grid.clientHeight);
    grid.style.gridTemplateColumns = `repeat(${shape.columns},minmax(0,1fr))`;
    grid.style.gridTemplateRows = `repeat(${shape.rows},minmax(0,1fr))`;
    if (animate && !reduced.matches) for (const [id, tile] of tiles) {
      if (tile.root.classList.contains('agent-new')) continue;
      const old = before.get(id), rect = tile.root.getBoundingClientRect();
      if (!old?.width || !rect.width || !rect.height) continue;
      tile.root.animate([
        { transform: `translate(${old.x - rect.x}px,${old.y - rect.y}px) scale(${old.width / rect.width},${old.height / rect.height})` },
        { transform: 'none' },
      ], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
  function roster(packet: AgentRoster) {
    if (!active || packet.stage !== stage || (packet.epoch === epoch && packet.seq <= rosterSeq)) return;
    if (packet.epoch !== epoch) { clear(); epoch = packet.epoch; }
    rosterSeq = packet.seq; received = performance.now();
    mode.textContent = packet.paused ? 'Paused' : packet.suspended ? 'Game in background' : stage === 'round2a' ? 'Single attacker' : 'Swarm';
    const live = packet.agents.filter(a => a.live).length;
    count.textContent = `${live} active / ${packet.agents.length} agents`;
    host.classList.toggle('dense', packet.agents.length > 12);
    empty.hidden = packet.agents.length > 0;
    empty.textContent = 'Waiting for agents…';
    const before = new Map([...tiles].map(([id, tile]) => [id, tile.root.getBoundingClientRect()]));
    let added = 0, changed = false;
    const ids = new Set(packet.agents.map(a => a.id));
    for (const [id, tile] of tiles) if (!ids.has(id)) { tile.root.remove(); tiles.delete(id); changed = true; }
    for (const info of packet.agents) {
      let tile = tiles.get(info.id);
      if (!tile) {
        const root = document.createElement('article'); root.className = 'agent-tile agent-new'; root.dataset.agent = String(info.id);
        root.innerHTML = '<canvas></canvas><div class="agent-cover">Connecting…</div><div class="agent-caption"><strong></strong><span></span></div>';
        root.style.setProperty('--arrival-delay', `${Math.min(added++ * 45, 600)}ms`);
        root.addEventListener('animationend', () => root.classList.remove('agent-new'), { once: true });
        const canvas = root.querySelector('canvas')!; canvas.setAttribute('role', 'img');
        tile = { root, canvas, name: root.querySelector('strong')!, action: root.querySelector('.agent-caption span')!, cover: root.querySelector('.agent-cover')!, seq: -1, info };
        tiles.set(info.id, tile); grid.append(root); changed = true;
      }
      tile.info = info; tile.name.textContent = info.name;
      tile.action.textContent = info.action;
      tile.canvas.setAttribute('aria-label', `${info.name}: first-person view, ${info.action}`);
      tile.root.dataset.live = String(info.live);
      tile.cover.hidden = info.live && !info.hidden && tile.seq >= 0;
      tile.cover.textContent = !info.live || info.hidden ? info.action : 'Connecting…';
    }
    if (changed) layout(true, before);
  }
  async function frame(packet: AgentFrame) {
    const tile = tiles.get(packet.id);
    if (!active || packet.epoch !== epoch || !tile || packet.seq <= tile.seq || !(packet.image instanceof Blob)) return;
    tile.seq = packet.seq;
    try {
      const bitmap = await createImageBitmap(packet.image);
      if (!disposed && active && packet.epoch === epoch && tiles.get(packet.id) === tile && tile.seq === packet.seq) {
        tile.canvas.width = bitmap.width; tile.canvas.height = bitmap.height;
        tile.canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        tile.cover.hidden = tile.info.live && !tile.info.hidden;
      }
      bitmap.close();
    } catch { /* A missed frame is replaced by the next one. */ }
  }
  bus.onmessage = ({ data }) => {
    if (data?.source !== source) return;
    if (data.type === 'roster' && Array.isArray(data.agents)) roster(data);
    if (data.type === 'frame') void frame(data);
  };
  const observer = new ResizeObserver(() => layout()); observer.observe(grid);
  const timer = window.setInterval(() => {
    watch();
    if (active && received && performance.now() - received > 3500) mode.textContent = 'Connection lost · Last views';
  }, 1000);
  document.addEventListener('visibilitychange', watch);
  return {
    setSource(id: string) { if (source !== id) { source = id; clear(); watch(); } },
    setStage(next: string) {
      const changed = next !== stage; stage = next; active = defenseStage(stage); host.hidden = !active;
      if (changed) { clear(); mode.textContent = stage === 'round2a' ? 'Single attacker' : 'Swarm'; watch(); layout(); }
    },
    dispose() { disposed = true; clearInterval(timer); observer.disconnect(); document.removeEventListener('visibilitychange', watch); bus.close(); clear(); },
  };
}
