import { AGENT_CHANNEL, defenseStage, gridShape, type AgentInfo, type AgentRoster } from './state';
import type { AgentRenderer } from './renderer';

interface Tile { root: HTMLElement; image: HTMLElement; name: HTMLElement; action: HTMLElement; cover: HTMLElement; ready: boolean; info: AgentInfo }

export function mountAgentBoard(host: HTMLElement) {
  const bus = new BroadcastChannel(AGENT_CHANNEL);
  host.innerHTML = '<div class="agent-summary"><span id="agent-mode"></span><span id="agent-count"></span></div><div class="agent-grid" aria-label="Live agent first-person views"></div><p class="agent-empty">Waiting for agents…</p>';
  const grid = host.querySelector<HTMLElement>('.agent-grid')!;
  const empty = host.querySelector<HTMLElement>('.agent-empty')!;
  const mode = host.querySelector<HTMLElement>('#agent-mode')!;
  const count = host.querySelector<HTMLElement>('#agent-count')!;
  const tiles = new Map<number, Tile>();
  let source = '', stage = '', epoch = '', rosterSeq = -1, received = 0, active = false, disposed = false;
  let renderer: AgentRenderer | null = null, loading = false, latest: AgentRoster | null = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const watch = () => { if (source && active && !document.hidden) bus.postMessage({ type: 'watch', source, needsLevel: !renderer }); };
  const clear = () => { for (const tile of tiles.values()) tile.root.remove(); tiles.clear(); renderer?.reset(); epoch = ''; rosterSeq = -1; received = 0; latest = null; empty.hidden = false; count.textContent = ''; };
  function syncRenderer() {
    if (!renderer || !latest) return;
    renderer.roster([...tiles.values()].map(tile => ({ info: tile.info, element: tile.root })));
    renderer.receive(latest.scene, latest.paused || latest.suspended);
    renderer.setActive(active && !document.hidden);
  }
  async function loadRenderer(packet: AgentRoster) {
    if (renderer || loading || !packet.level) return;
    loading = true; const loadingSource = source;
    try {
      const { createAgentRenderer } = await import('./renderer');
      const instance = await createAgentRenderer(grid, packet.level, id => {
        const tile = tiles.get(id); if (!tile) return;
        tile.ready = true; tile.cover.hidden = tile.info.live && !tile.info.hidden;
      });
      if (disposed || source !== loadingSource) { instance.dispose(); return; }
      renderer = instance; syncRenderer();
    } catch (error) { mode.textContent = 'Unable to load views'; console.error('[agent views]', error); }
    finally { loading = false; }
  }
  function layout(animate = false, before = new Map([...tiles].map(([id, t]) => [id, t.root.getBoundingClientRect()]))) {
    const shape = gridShape(tiles.size, grid.clientWidth, grid.clientHeight);
    grid.style.gridTemplateColumns = `repeat(${shape.columns},minmax(0,1fr))`;
    grid.style.gridTemplateRows = `repeat(${shape.rows},minmax(0,1fr))`;
    renderer?.resize();
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
    latest = packet;
    rosterSeq = packet.seq; received = performance.now();
    mode.textContent = packet.paused ? 'Paused' : packet.suspended ? 'Game in background' : stage === 'round2a' ? 'Single attacker' : 'Swarm';
    count.textContent = stage === 'round2a' ? `${packet.totalAgents} agent` : `${packet.agents.length} ways · ${packet.totalAgents} agents`;
    host.classList.toggle('dense', packet.agents.length > 12);
    empty.hidden = packet.agents.length > 0;
    empty.textContent = 'Waiting for agents…';
    const ids = new Set(packet.agents.map(a => a.id));
    const changedIds = tiles.size !== ids.size || packet.agents.some(a => !tiles.has(a.id));
    const before = changedIds ? new Map([...tiles].map(([id, tile]) => [id, tile.root.getBoundingClientRect()])) : new Map();
    let added = 0, changed = false;
    for (const [id, tile] of tiles) if (!ids.has(id)) { tile.root.remove(); tiles.delete(id); changed = true; }
    for (const info of packet.agents) {
      let tile = tiles.get(info.id);
      if (!tile) {
        const root = document.createElement('article'); root.className = 'agent-tile agent-new'; root.dataset.agent = String(info.id);
        root.innerHTML = '<div class="agent-image" role="img"></div><div class="agent-cover">Loading view…</div><div class="agent-caption"><strong></strong><span></span></div>';
        root.style.setProperty('--arrival-delay', `${Math.min(added++ * 45, 600)}ms`);
        root.addEventListener('animationend', () => root.classList.remove('agent-new'), { once: true });
        tile = { root, image: root.querySelector('.agent-image')!, name: root.querySelector('strong')!, action: root.querySelector('.agent-caption span')!, cover: root.querySelector('.agent-cover')!, ready: false, info };
        tiles.set(info.id, tile); grid.append(root); changed = true;
      }
      if (tile.info.agentId !== info.agentId) tile.ready = false;
      tile.info = info;
      if (tile.name.textContent !== info.name) tile.name.textContent = info.name;
      if (tile.action.textContent !== info.action) tile.action.textContent = info.action;
      const label = `${info.name}: ${info.active ?? 0} active of ${info.total ?? 0} agents, first-person view, ${info.action}`;
      if (tile.image.getAttribute('aria-label') !== label) tile.image.setAttribute('aria-label', label);
      tile.root.title = label; tile.root.dataset.live = String(info.live);
      tile.cover.hidden = info.live && !info.hidden && tile.ready;
      const coverText = !info.live || info.hidden ? info.action : 'Loading view…';
      if (tile.cover.textContent !== coverText) tile.cover.textContent = coverText;
    }
    if (changed) layout(true, before);
    syncRenderer(); void loadRenderer(packet);
  }
  bus.onmessage = ({ data }) => {
    if (data?.source !== source) return;
    if (data.type === 'roster' && Array.isArray(data.agents)) roster(data);
  };
  const observer = new ResizeObserver(() => layout()); observer.observe(grid);
  const timer = window.setInterval(() => {
    watch();
    if (active && received && performance.now() - received > 3500) mode.textContent = 'Connection lost · Last views';
  }, 1000);
  const visibility = () => { renderer?.setActive(active && !document.hidden); watch(); };
  document.addEventListener('visibilitychange', visibility);
  return {
    setSource(id: string) { if (source !== id) { source = id; clear(); renderer?.dispose(); renderer = null; watch(); } },
    setStage(next: string) {
      const changed = next !== stage; stage = next; active = defenseStage(stage); host.hidden = !active;
      renderer?.setActive(active && !document.hidden);
      if (changed) { clear(); mode.textContent = stage === 'round2a' ? 'Single attacker' : 'Swarm'; watch(); layout(); }
    },
    dispose() { disposed = true; clearInterval(timer); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); bus.close(); clear(); renderer?.dispose(); },
  };
}
