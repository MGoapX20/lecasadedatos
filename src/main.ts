import { GameLoop } from './core/loop';
import { loadLevel } from './level/loader';
import { PlannerClient } from './planner/client';
import { AudioBus } from './audio/audio';
import { InputManager } from './input/input';
import { CameraDirector } from './render/camera';
import { createStage } from './render/renderer';
import { WorldView } from './render/worldView';
import { loadModels } from './render/models';
import { GameFlow } from './game/flow';
import { applySavedBuilding, mountPresenter } from './game/presenter';
import { PauseMenu } from './game/menu';
import { mountAdmin } from './game/admin';
import { publishAdmin } from './game/admin-channel';
import { mountMinimap } from './minimap/publisher';
import { Overlay } from './ui/overlay';
import { applyDocumentLang } from './ui/i18n';
import { mountCompanion } from './companion/publisher';

/** Degrees of view rotation per pixel of middle-drag. */
const ORBIT_AZ_PER_PX = 0.3;
const ORBIT_PITCH_PER_PX = 0.2;

async function boot(): Promise<void> {
  applyDocumentLang();
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const level = await loadLevel('/levels/mint_v1.json');

  const director = new CameraDirector();
  const halfW = (level.w * level.cellSize) / 2;
  const halfD = (level.h * level.cellSize) / 2;
  director.setBounds(halfW * 0.86, halfD * 0.86);

  const stage = createStage(canvas, director);
  const models = await loadModels();
  const view = new WorldView(level, stage, models);
  const overlay = new Overlay();
  overlay.applyI18n();

  const input = new InputManager(canvas, () => ({
    w: canvas.clientWidth,
    h: canvas.clientHeight,
  }));
  const audio = new AudioBus();
  // Decode the music now so the first gesture only has to resume the context.
  audio.preload(['/audio/theme.m4a', '/audio/bella_ciao.m4a']);
  const planner = new PlannerClient(level.json);

  const flow = new GameFlow({ level, stage, director, view, input, overlay, audio, planner, canvas });
  const companion = mountCompanion(flow, message => overlay.toast(message));
  mountPresenter(flow, { level, stage, view, planner, overlay, director });
  if (applySavedBuilding(level, flow.world)) {
    console.info('[casa] loaded the building saved from presenter mode');
  }

  const menu = new PauseMenu({
    overlay,
    audio,
    stage,
    onResume: () => {
      flow.paused = false;
    },
    onRestart: () => flow.restart(),
    onSkip: () => flow.skipStage(),
    onPresenter: () => flow.togglePresenter(),
    onCompanion: () => companion.open(),
    onAdmin: () => admin.show(),
  });
  const admin = mountAdmin(flow, () => { if (menu.open) menu.close(); input.releaseHeld(); });
  const toggleMenu = () => {
    audio.unlock();
    audio.resume();
    if (!audio.currentTrack) audio.requestMusic('/audio/theme.m4a');
    menu.toggle();
    flow.paused = menu.open;
  };
  input.onMenuKey(toggleMenu);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    stage.resize(w, h, director);
  };
  window.addEventListener('resize', resize);
  resize();

  // Handy for the presenter and for debugging on the fair laptop.
  (window as unknown as { casa: unknown }).casa = { flow, world: flow.world, view, stage, director, level, menu, input, companion, admin };

  flow.enter('attract');
  publishAdmin(admin);
  const minimap = mountMinimap(flow, () => companion.source);

  const loop = new GameLoop(
    () => flow.tickSim(),
    (_alpha, dtMs) => {
      const state = input.update(dtMs / 1000);
      // Middle-drag or held Q/E swings the view through the same orbit controls.
      director.orbitBy(state.orbit.dx * ORBIT_AZ_PER_PX, state.orbit.dy * ORBIT_PITCH_PER_PX);
      if (input.pollMenuButton()) toggleMenu();
      if (menu.open) menu.update(state, dtMs);
      flow.update(dtMs);
      admin.update();
      companion.update(performance.now());
      minimap.update(performance.now());
      stage.render(director, dtMs);
    },
  );
  loop.start();

  // Browsers block sound until the visitor touches something, and can suspend
  // the context again later, so keep listening rather than unlocking just once.
  const unlock = () => {
    audio.unlock();
    audio.resume();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(ev, unlock);
  }
}

void boot().catch((err) => {
  const pre = document.createElement('pre');
  pre.style.cssText =
    'position:fixed;inset:0;padding:24px;color:#e0313a;background:#0a0a0d;font:14px monospace;white-space:pre-wrap;z-index:99;overflow:auto';
  pre.textContent = `Failed to start:\n${String(err instanceof Error ? err.stack : err)}`;
  document.body.appendChild(pre);
});
