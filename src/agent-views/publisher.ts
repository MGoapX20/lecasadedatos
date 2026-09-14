import { PerspectiveCamera, SRGBColorSpace, Vector4, WebGLRenderTarget } from 'three';
import type { GameFlow } from '../game/flow';
import type { Stage } from '../render/renderer';
import type { WorldView } from '../render/worldView';
import { AGENT_CHANNEL, agentInfo, defenseStage, type AgentFrame, type AgentRoster } from './state';

/** Demand-driven camera feeds from the real scene; never advances or changes the simulation. */
export function mountAgentViews(flow: GameFlow, stage: Stage, view: WorldView, source: () => string) {
  const bus = new BroadcastChannel(AGENT_CHANNEL);
  const camera = new PerspectiveCamera(82, 16 / 9, .08, 130);
  let target: WebGLRenderTarget | null = null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  let pixels = new Uint8Array(0), flipped = new Uint8ClampedArray(0);
  let until = 0, nextRoster = 0, nextFrame = 0, cursor = 0, seq = 0, pending = 0;
  let epoch = crypto.randomUUID(), previousStage = '', previousTick = -1, disposed = false;
  bus.onmessage = ({ data }) => {
    if (data?.type === 'watch' && data.source === source()) until = performance.now() + 3500;
  };
  function update(now: number) {
    if (disposed) return;
    if (flow.state !== previousStage || flow.world.tick < previousTick) {
      epoch = crypto.randomUUID(); cursor = 0; nextRoster = 0;
      previousStage = flow.state;
    }
    previousTick = flow.world.tick;
    if (now > until) { target?.dispose(); target = null; return; }
    const agents = defenseStage(flow.state) ? flow.world.thieves.filter(t => t.kind === 'plan') : [];
    if (now >= nextRoster) {
      const packet: AgentRoster = { type: 'roster', source: source(), epoch, seq: ++seq,
        stage: flow.state, paused: flow.paused, suspended: document.hidden, agents: agents.map(agentInfo) };
      bus.postMessage(packet); nextRoster = now + 180;
    }
    const visible = agents.filter(t => { const a = agentInfo(t); return a.live && !a.hidden; });
    if (!visible.length || now < nextFrame || pending >= 2) return;
    nextFrame = now + (visible.length === 1 ? 66 : 0);
    // Spread cameras over frames so opening a swarm never causes a full extra scene render per agent at once.
    const started = performance.now();
    for (let n = 0; n < Math.min(3, visible.length) && pending < 2; n++) {
      const t = visible[cursor++ % visible.length];
      const width = agents.length <= 1 ? 768 : agents.length <= 9 ? 384 : 256;
      const height = width * 9 / 16;
      if (!target || target.width !== width) {
        target?.dispose(); target = new WebGLRenderTarget(width, height, { stencilBuffer: true });
        target.texture.colorSpace = SRGBColorSpace;
        canvas.width = width; canvas.height = height;
        pixels = new Uint8Array(width * height * 4); flipped = new Uint8ClampedArray(pixels.length);
      }
      const renderer = stage.renderer;
      const previousTarget = renderer.getRenderTarget();
      const viewport = renderer.getViewport(new Vector4()), scissor = renderer.getScissor(new Vector4());
      const scissorTest = renderer.getScissorTest(), autoClear = renderer.autoClear;
      const shadowUpdate = renderer.shadowMap.autoUpdate;
      try {
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(target); renderer.setViewport(0, 0, width, height);
        renderer.setScissorTest(false); renderer.autoClear = true;
        view.withAgentView(t, (x, eye, z) => {
          const facing = t.facing * Math.PI / 180;
          camera.position.set(x, eye, z);
          camera.lookAt(x + Math.cos(facing), eye - .06, z + Math.sin(facing));
          renderer.render(stage.scene, camera);
        });
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      } finally {
        renderer.setRenderTarget(previousTarget); renderer.setViewport(viewport); renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest); renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = shadowUpdate;
      }
      const stride = width * 4;
      for (let row = 0; row < height; row++) flipped.set(pixels.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride);
      context.putImageData(new ImageData(flipped, width, height), 0, 0);
      const frameEpoch = epoch, frameSource = source(), frameSeq = ++seq;
      pending++;
      canvas.toBlob(image => {
        pending--;
        if (!image || disposed || frameEpoch !== epoch || performance.now() > until) return;
        const frame: AgentFrame = { type: 'frame', source: frameSource, epoch: frameEpoch, seq: frameSeq, id: t.id, image };
        bus.postMessage(frame);
      }, 'image/jpeg', .8);
      if (performance.now() - started > 8) break;
    }
  }
  window.addEventListener('pagehide', e => {
    if (!e.persisted) { disposed = true; target?.dispose(); bus.close(); }
  });
  return { update };
}
