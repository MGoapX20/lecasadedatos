import '../src/professor/style.css';
import { loadLevel, fineXYToWorldX, fineXYToWorldZ } from '../src/level/loader';
import { blankCharacterPose } from '../src/render/characters';
import { THIEF_POSE_SCALE } from '../src/render/readability';
import { createAgentRenderer } from '../src/agent-views/renderer';
import { gridShape, type SceneSnapshot } from '../src/agent-views/state';

if (!import.meta.env.DEV) throw new Error('Development fixture only');
const level = await loadLevel('/levels/mint_v1.json');
const grid = document.querySelector<HTMLElement>('#grid')!;
const result = document.querySelector<HTMLOutputElement>('#result')!;
const overlap = new URLSearchParams(location.search).has('overlap');
const agentCount = overlap ? 2 : 80, wayCount = overlap ? 1 : 20;
result.textContent = overlap ? 'Loading overlapping-agent camera check…' : 'Loading 80-agent / 20-way stress check…';
const entries = Array.from({ length: wayCount }, (_, id) => {
  const element = document.createElement('article'); element.className = 'agent-tile';
  element.innerHTML = `<div class="agent-caption"><strong>Way ${id + 1}</strong><span>${overlap ? '2 overlapping agents' : '4 agents'}</span></div>`;
  grid.append(element);
  return { element, info: { id, agentId: id * 4, name: `Way ${id + 1}`, action: 'Moving', live: true, hidden: false } };
});
const shape = gridShape(wayCount, grid.clientWidth, grid.clientHeight);
grid.style.gridTemplateColumns = `repeat(${shape.columns}, minmax(0, 1fr))`;
grid.style.gridTemplateRows = `repeat(${shape.rows}, minmax(0, 1fr))`;
const renderer = await createAgentRenderer(grid, level.json, () => {});
renderer.roster(entries);
const cells = Array.from(level.walk.keys()).filter(i => level.walk[i] && level.indoor[i]);
let tick = 0;
const send = () => {
  const scene: SceneSnapshot = { tick: tick++, guards: [], doors: [], cameras: [], keys: [], hole: false, power: true, truck: null, van: null,
    thieves: Array.from({ length: agentCount }, (_, id) => {
      const spawn = level.json.entries.find(entry => entry.id === 'front')!.spawn;
      const cell = overlap ? spawn[1] * level.w + spawn[0] : cells[id * 17 % cells.length];
      return { id, pose: { ...blankCharacterPose(), visible: true, scale: THIEF_POSE_SCALE, moving: .7,
        phase: id * .65 + tick * .25, x: fineXYToWorldX(level, cell % level.w + .5), z: fineXYToWorldZ(level, Math.floor(cell / level.w) + .5), facingRad: tick * .015 + (overlap ? 0 : id) } };
    }) };
  renderer.receive(scene, false);
};
send(); renderer.setActive(true);
const timer = setInterval(send, 100);
const started = performance.now();
const report = setInterval(() => {
  const stats = renderer.metrics();
  result.textContent = `Synthetic test: ${agentCount} agents → ${stats.feeds} ways · ${stats.cameraRenders} updates · max ${stats.maxPerFrame}/frame · CPU p95 ${stats.p95RenderMs.toFixed(1)}ms · ${((performance.now() - started) / 1000).toFixed(0)}s`;
  if (performance.now() - started >= 20000) { clearInterval(timer); clearInterval(report); renderer.setActive(false); result.textContent += ' · Complete'; }
}, 1000);
window.addEventListener('pagehide', () => { clearInterval(timer); clearInterval(report); renderer.dispose(); });
