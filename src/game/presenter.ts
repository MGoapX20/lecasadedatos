import { config, saveConfig, type Quality } from '../config';
import { fineXYToWorldX, fineXYToWorldZ, worldToFine, type Level } from '../level/loader';
import { clearOverride, loadOverride, saveOverride, type LevelOverride } from '../level/overrides';
import { PlannerClient } from '../planner/client';
import { SWARM_DELAYS, enumerateRequests } from '../planner/options';
import { orderGuardTo } from '../sim/patrol';
import type { SimWorld } from '../sim/world';
import type { CameraDirector } from '../render/camera';
import { GroundPicker } from '../render/picking';
import type { Stage } from '../render/renderer';
import type { WorldView } from '../render/worldView';
import { t } from '../ui/i18n';
import type { Overlay } from '../ui/overlay';
import type { GameFlow } from './flow';

interface Deps {
  level: Level;
  stage: Stage;
  view: WorldView;
  planner: PlannerClient;
  overlay: Overlay;
  director: CameraDirector;
}

/** How close a click must land, in metres, to count as hitting a thing. */
const CLICK_RADIUS_M = 3.2;

/**
 * Apply a building saved from the panel. Without this, "save as default" would
 * be a lie: the file would be written and then never read.
 */
export function applySavedBuilding(level: Level, world: SimWorld): boolean {
  const saved = loadOverride(level.id);
  if (!saved) return false;
  level.doors.forEach((door, i) => {
    const locked = saved.doors[door.id];
    if (locked !== undefined) world.doorLocked[i] = locked ? 1 : 0;
  });
  world.refreshOpacity();
  for (const g of world.guards) {
    const cell = saved.guardPosts[g.id];
    if (cell !== undefined && level.walk[cell]) {
      orderGuardTo(level, g.program, 0, cell, 40, 200, { x: g.x, y: g.y });
    }
  }
  return true;
}

/**
 * The operator panel. Its real job is answering the only question a sceptic
 * ever asks at a fair: change the building, and watch the AI plan around it.
 * It uses the same click grammar as the defending round, so whoever is running
 * the stand only has to learn one thing.
 */
export function mountPresenter(flow: GameFlow, d: Deps): void {
  const panel = document.getElementById('scr-presenter')!;
  const hintEl = document.getElementById('pres-hint')!;
  const actions = document.getElementById('pres-actions')!;
  const sliders = document.getElementById('pres-sliders')!;
  const stats = document.getElementById('pres-stats')!;
  const picker = new GroundPicker();
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  let planning = false;

  const button = (labelKey: string, onClick: () => void, parent: HTMLElement) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.i18n = labelKey;
    b.textContent = t(labelKey);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    parent.appendChild(b);
    return b;
  };

  const runBtn = button('presenter.run', () => void runAi(false), actions);
  const playBtn = button('presenter.play', () => void runAi(true), actions);
  button('presenter.stop', () => clearAgents(), actions);
  button('presenter.reset', () => resetBuilding(), actions);
  button('presenter.save', () => persist(), actions);
  button('presenter.export', () => exportJson(), actions);

  const qualityLabel = document.createElement('label');
  qualityLabel.append(`${t('presenter.quality')} `);
  const quality = document.createElement('select');
  for (const q of ['high', 'medium', 'low'] as Quality[]) {
    const o = document.createElement('option');
    o.value = q;
    o.textContent = t(`quality.${q}`);
    quality.appendChild(o);
  }
  quality.value = config.quality;
  quality.addEventListener('change', () => {
    config.quality = quality.value as Quality;
    saveConfig();
    d.stage.setQuality(config.quality);
  });
  qualityLabel.appendChild(quality);

  const swarmLabel = document.createElement('label');
  swarmLabel.append(`${t('presenter.swarm')} `);
  const swarm = document.createElement('input');
  swarm.type = 'range';
  swarm.min = '20';
  swarm.max = '120';
  swarm.step = '10';
  swarm.value = String(config.swarmSize);
  const swarmOut = document.createElement('b');
  swarmOut.textContent = String(config.swarmSize);
  swarm.addEventListener('input', () => {
    config.swarmSize = Number(swarm.value);
    swarmOut.textContent = swarm.value;
    saveConfig();
  });
  swarmLabel.append(swarm, swarmOut);
  sliders.append(qualityLabel, swarmLabel);

  // Clicks on the panel itself must never fall through to the building.
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());

  function setStats(text: string, bad = false): void {
    stats.textContent = text;
    stats.classList.toggle('nope', bad);
  }

  function setBusy(busy: boolean): void {
    planning = busy;
    runBtn.disabled = busy;
    playBtn.disabled = busy;
    panel.classList.toggle('busy', busy);
  }

  function guardName(i: number): string {
    return t(d.level.json.guards[i].nameKey);
  }

  async function runAi(play: boolean): Promise<void> {
    if (planning) return;
    setBusy(true);
    setStats(t('presenter.planning', { found: 0, distinct: 0 }));
    const world = flow.world;
    if (play) clearAgents();
    const job = d.planner.plan({
      nowTick: world.tick,
      doorLocked: world.doorLocked,
      guardPrograms: flow.plannerPrograms(),
      alarmWindows: world.alarmWindows,
      keycardCells: Object.fromEntries(
        d.level.json.keycards.map((k) => [k.id, k.cell[1] * d.level.w + k.cell[0]]),
      ),
      requests: enumerateRequests(d.level, config.swarmSize, 4242, 1, SWARM_DELAYS),
      budgetMs: 5000,
      onProgress: (_done, _total, found, distinct) => {
        setStats(t('presenter.planning', { found, distinct }));
      },
    });
    const { plans, stats: s } = await job.promise;
    setBusy(false);
    if (flow.state !== 'presenter') return;

    d.view.trails.setOpacity(0.55);
    d.view.trails.show(d.level, plans, plans.length);
    if (!plans.length) {
      setStats(t('presenter.noWay'), true);
      return;
    }
    setStats(
      t('presenter.stats', {
        distinct: s.distinct,
        found: s.found,
        searches: s.searches,
        ms: s.wallMs,
      }),
    );
    if (play) {
      for (const p of plans) flow.world.spawnPlanThief(p, `#${p.agentId}`);
    }
  }

  function clearAgents(): void {
    flow.world.clearThieves();
    d.view.resetAgents();
    d.view.trails.clear();
  }

  function resetBuilding(): void {
    clearOverride();
    const world = flow.world;
    d.level.doors.forEach((door, i) => (world.doorLocked[i] = door.locked ? 1 : 0));
    world.doorPickedOpen.fill(0);
    world.refreshOpacity();
    world.resetGuards();
    world.chief.locksLeft = d.level.json.rules.maxLocks;
    clearAgents();
    flow.presenterGuard = -1;
    setStats(t('presenter.idle'));
    d.overlay.toast(t('presenter.resetMsg'));
  }

  function currentOverride(): LevelOverride {
    const world = flow.world;
    const doors: Record<string, boolean> = {};
    d.level.doors.forEach((door, i) => (doors[door.id] = world.doorLocked[i] === 1));
    const guardPosts: Record<string, number> = {};
    world.guards.forEach((g) => {
      guardPosts[g.id] =
        Math.min(d.level.h - 1, Math.max(0, Math.floor(g.y))) * d.level.w +
        Math.min(d.level.w - 1, Math.max(0, Math.floor(g.x)));
    });
    return { version: 1, levelId: d.level.id, doors, guardPosts };
  }

  function persist(): void {
    saveOverride(currentOverride());
    d.overlay.toast(t('presenter.savedMsg'));
  }

  function exportJson(): void {
    const blob = new Blob([JSON.stringify(currentOverride(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${d.level.id}-override.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // One click grammar, the same one the defending round uses.
  canvas.addEventListener('pointerdown', (ev) => {
    if (flow.state !== 'presenter') return;
    const rect = canvas.getBoundingClientRect();
    const p = picker.pick(
      d.director.camera,
      ev.clientX - rect.left,
      ev.clientY - rect.top,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    if (!p) return;
    const world = flow.world;
    const level = d.level;

    let bestDoor = -1;
    let bestDoorD = CLICK_RADIUS_M;
    level.doors.forEach((door, i) => {
      if (!door.lockableByChief) return;
      const cx = fineXYToWorldX(level, door.rect[0] + door.rect[2] / 2);
      const cz = fineXYToWorldZ(level, door.rect[1] + door.rect[3] / 2);
      const dist = Math.hypot(p.x - cx, p.z - cz);
      if (dist < bestDoorD) {
        bestDoorD = dist;
        bestDoor = i;
      }
    });

    let bestGuard = -1;
    let bestGuardD = CLICK_RADIUS_M;
    world.guards.forEach((g, i) => {
      if (!g.present) return;
      const dist = Math.hypot(p.x - fineXYToWorldX(level, g.x), p.z - fineXYToWorldZ(level, g.y));
      if (dist < bestGuardD) {
        bestGuardD = dist;
        bestGuard = i;
      }
    });

    if (bestGuard >= 0 && bestGuardD <= bestDoorD) {
      flow.presenterGuard = flow.presenterGuard === bestGuard ? -1 : bestGuard;
      if (flow.presenterGuard >= 0) {
        d.overlay.toast(t('presenter.guardSelected', { guard: guardName(bestGuard) }));
      }
      return;
    }

    if (bestDoor >= 0) {
      const nowLocked = world.doorLocked[bestDoor] !== 1;
      world.lockDoor(bestDoor, nowLocked, false);
      const name = t(level.doors[bestDoor].nameKey ?? 'door.front');
      d.overlay.toast(t(nowLocked ? 'presenter.doorNowLocked' : 'presenter.doorNowOpen', { door: name }));
      return;
    }

    if (flow.presenterGuard >= 0) {
      const cell = worldToFine(level, p.x, p.z);
      if (cell >= 0 && level.walk[cell]) {
        const g = world.guards[flow.presenterGuard];
        orderGuardTo(level, g.program, world.tick + 2, cell, 40, 200, { x: g.x, y: g.y });
        g.state = 'return';
        g.path = null;
        d.overlay.toast(t('presenter.guardMoved', { guard: guardName(flow.presenterGuard) }));
        flow.presenterGuard = -1;
      }
    }
  });

  flow.onPresenterOpen = () => {
    hintEl.textContent = t('presenter.hint');
    setStats(t('presenter.idle'));
    setBusy(false);
    d.view.setConesVisible(true);
    d.view.setCutaway(true);
    d.director.setOrbit(0);
    d.director.moveTo('wide', 1.0);
  };
}
