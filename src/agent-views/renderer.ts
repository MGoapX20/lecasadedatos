import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  PointLight, Scene, SRGBColorSpace, WebGLRenderer, WebGLRenderTarget, type Material } from 'three';
import { buildLevel } from '../level/loader';
import type { LevelJson } from '../level/schema';
import { loadModels } from '../render/models';
import { WorldView } from '../render/worldView';
import type { AgentInfo, SceneSnapshot } from './state';

interface Feed { target: WebGLRenderTarget; quad: Mesh<PlaneGeometry, MeshBasicMaterial>; info: AgentInfo; element: HTMLElement; ready: boolean; updated: number; born: number; width: number; height: number }

/** One GPU context on the board, cached textures for feeds, and no pixel/image transfers. */
export async function createAgentRenderer(grid: HTMLElement, json: LevelJson, ready: (id: number) => void) {
  const models = await loadModels();
  const canvas = document.createElement('canvas'); canvas.className = 'agent-surface'; canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power', alpha: false });
  renderer.setPixelRatio(1); renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = false;
  const scene = new Scene(); scene.background = new Color(0x10121a);
  const sun = new DirectionalLight(0xffead8, 2.2); sun.position.set(12, 25, 15);
  scene.add(sun, new HemisphereLight(0xe7eeff, 0x5a4a43, 2));
  const view = new WorldView(buildLevel(json), { scene, vaultLight: new PointLight(), lobbyLight: new PointLight(), setNight() {} }, models, 256, true);
  view.setBaseStage('round2b'); view.setCutaway(false);
  // Shared lightweight materials keep the same geometry, textures, logos, and characters.
  const materials = new Map<Material, Material>();
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const simplify = (material: Material) => {
      if (!(material instanceof MeshStandardMaterial)) return material;
      let replacement = materials.get(material);
      if (!replacement) {
        replacement = new MeshLambertMaterial({ color: material.color, map: material.map,
          emissive: material.emissive, emissiveMap: material.emissiveMap, emissiveIntensity: Math.min(material.emissiveIntensity, 1),
          vertexColors: material.vertexColors, transparent: material.transparent, opacity: material.opacity,
          alphaTest: material.alphaTest, side: material.side, depthWrite: material.depthWrite });
        materials.set(material, replacement);
      }
      return replacement;
    };
    object.material = Array.isArray(object.material) ? object.material.map(simplify) : simplify(object.material);
  });
  scene.matrixWorldAutoUpdate = false;
  const camera = new PerspectiveCamera(82, 16 / 9, .08, 70);
  const composite = new Scene(); composite.background = new Color(0x0d0e13);
  const ortho = new OrthographicCamera(0, 1, 1, 0, -1, 1), plane = new PlaneGeometry(1, 1);
  const feeds = new Map<number, Feed>();
  let current: SceneSnapshot | null = null, previous: SceneSnapshot | null = null;
  let received = 0, paused = false, running = false, disposed = false, raf = 0, last = 0, cursor = 0, dirty = true;
  let width = 1, height = 1;
  const samples: number[] = [];
  let cameraRenders = 0, maxPerFrame = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  grid.prepend(canvas);
  function resize() {
    width = Math.max(1, grid.clientWidth); height = Math.max(1, grid.clientHeight);
    renderer.setSize(width, height, false); ortho.right = width; ortho.top = height; ortho.updateProjectionMatrix();
    for (const feed of feeds.values()) {
      const w = feed.element.offsetWidth, h = feed.element.offsetHeight;
      // Fit 16:9 without cropping the agent's peripheral view.
      const imageW = Math.min(w, h * 16 / 9), imageH = imageW * 9 / 16;
      feed.width = imageW; feed.height = imageH;
      feed.quad.scale.set(imageW, imageH, 1);
      feed.quad.position.set(feed.element.offsetLeft + w / 2, height - feed.element.offsetTop - h / 2, 0);
      const resolution = Math.max(160, Math.min(feeds.size === 1 ? 640 : 320, Math.ceil(imageW / 16) * 16));
      if (feed.target.width !== resolution) { feed.target.setSize(resolution, resolution * 9 / 16); feed.ready = false; feed.updated = 0; }
    }
    dirty = true;
  }
  const observer = new ResizeObserver(resize); observer.observe(grid);
  function frame(now: number) {
    if (!running || disposed) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden || now - last < 32 || !current) return;
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    const live = [...feeds.values()].filter(f => (f.info.live && !f.info.hidden) || !f.ready && f.info.agentId !== undefined);
    const interval = live.length <= 4 ? 32 : live.length <= 8 ? 50 : 80;
    const canUpdate = !paused && now - received < 3500;
    const due = live.some(f => !f.ready || canUpdate && now - f.updated >= interval);
    if (due) {
      view.applyAgentScene(current, previous, paused ? 1 : Math.min(1, (now - received) / 100), paused ? 0 : dt);
      scene.updateMatrixWorld(true);
      const start = performance.now();
      // Hard work cap: never render an entire swarm in one frame.
      let rendered = 0;
      for (let visited = 0; visited < live.length && rendered < 4; visited++) {
        const feed = live[cursor++ % live.length];
        if (feed.ready && (!canUpdate || now - feed.updated < interval)) continue;
        if (feed.info.agentId === undefined) continue;
        renderer.setRenderTarget(feed.target);
        view.withAgentCamera(feed.info.agentId, (x, eye, z, facing) => {
          camera.position.set(x, eye, z); camera.lookAt(x + Math.cos(facing), eye - .06, z + Math.sin(facing));
          renderer.render(scene, camera);
        });
        feed.updated = now; rendered++; dirty = true;
        if (!feed.ready) { feed.ready = true; feed.quad.visible = true; if (!feed.born) feed.born = now; ready(feed.info.id); }
        if (performance.now() - start >= 4) break;
      }
      cameraRenders += rendered; maxPerFrame = Math.max(maxPerFrame, rendered);
      samples.push(performance.now() - start); if (samples.length > 300) samples.shift();
    }
    for (const feed of feeds.values()) {
      if (!feed.ready || now - feed.born > 600 && feed.quad.material.opacity === 1) continue;
      const progress = reduced.matches ? 1 : Math.min(1, (now - feed.born) / 450);
      const ease = 1 - (1 - progress) ** 3;
      feed.quad.material.opacity = ease;
      feed.quad.scale.set(feed.width * (.86 + .14 * ease), feed.height * (.86 + .14 * ease), 1);
      dirty = true;
    }
    if (dirty) { renderer.setRenderTarget(null); renderer.render(composite, ortho); dirty = false; }
  }
  return {
    metrics() { const sorted = [...samples].sort((a, b) => a - b); return { cameraRenders, maxPerFrame, feeds: feeds.size, p95RenderMs: sorted[Math.floor(sorted.length * .95)] ?? 0 }; },
    receive(snapshot: SceneSnapshot, isPaused: boolean) {
      if (snapshot.tick !== current?.tick) { previous = current; current = snapshot; received = performance.now(); }
      else current = snapshot;
      paused = isPaused;
    },
    roster(entries: { info: AgentInfo; element: HTMLElement }[]) {
      const ids = new Set(entries.map(e => e.info.id)); let changed = false;
      for (const [id, feed] of feeds) if (!ids.has(id)) { feed.target.dispose(); feed.quad.material.dispose(); composite.remove(feed.quad); feeds.delete(id); changed = true; }
      for (const { info, element } of entries) {
        let feed = feeds.get(info.id);
        if (!feed) {
          const target = new WebGLRenderTarget(160, 90);
          target.texture.colorSpace = SRGBColorSpace;
          const quad = new Mesh(plane, new MeshBasicMaterial({ map: target.texture, toneMapped: false, depthTest: false, transparent: true }));
          quad.visible = false; composite.add(quad);
          feed = { target, quad, info, element, ready: false, updated: 0, born: 0, width: 160, height: 90 }; feeds.set(info.id, feed); changed = true;
        }
        if (feed.info.agentId !== info.agentId) { feed.updated = 0; feed.ready = false; }
        feed.info = info;
      }
      if (changed) resize();
    },
    resize,
    reset() { for (const feed of feeds.values()) { feed.target.dispose(); feed.quad.material.dispose(); composite.remove(feed.quad); } feeds.clear(); view.resetAgents(); current = previous = null; dirty = true; },
    setActive(value: boolean) { if (value === running) return; running = value; if (running) { last = performance.now(); raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf); },
    dispose() { disposed = true; running = false; cancelAnimationFrame(raf); observer.disconnect(); view.dispose(); for (const feed of feeds.values()) { feed.target.dispose(); feed.quad.material.dispose(); } for (const material of materials.values()) material.dispose(); plane.dispose(); renderer.dispose(); canvas.remove(); },
  };
}
export type AgentRenderer = Awaited<ReturnType<typeof createAgentRenderer>>;
