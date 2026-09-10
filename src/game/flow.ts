import { TICK_MS, TIMERS, config, saveConfig } from '../config';
import { Rng } from '../core/rng';
import { cellOf, fineXYToWorldX, fineXYToWorldZ, worldToFine, type Level } from '../level/loader';
import { placeKeycards } from '../level/keycard';
import { PlannerClient } from '../planner/client';
import { SWARM_DELAYS, enumerateRequests } from '../planner/options';
import { coarseSignature } from '../planner/diversity';
import type { Plan } from '../planner/types';
import { orderGuardTo, withTemporaryPost, type PatrolProgram } from '../sim/patrol';
import { SimWorld, type Thief } from '../sim/world';
import { truckIsOpen } from '../sim/truck';
import type { Cue } from '../ui/overlay';
import { GuidedWalkthrough, type GuideStep } from './walkthrough';
import { MissionTracker } from './missions';
import type { AudioBus } from '../audio/audio';
import type { InputManager } from '../input/input';
import type { CameraDirector } from '../render/camera';
import { GroundPicker } from '../render/picking';
import type { Stage } from '../render/renderer';
import { WorldView } from '../render/worldView';
import { Vector3 } from 'three';
import { guideArrowInView } from '../render/guideVisibility';
import { formatClock, onLangChange, t, toggleLang } from '../ui/i18n';
import { wayColor } from '../render/palette';
import { Overlay } from '../ui/overlay';
import { pickCodename, loadBoard, submit } from './leaderboard';
import { Session } from './session';
import { Emitter } from '../core/events';
import type { SimEvent } from '../sim/events';

export interface WayInfo {
  sig: string;
  plan: Plan;
  color: number;
  name: string;
  how: string;
  state: 'open' | 'breached' | 'held';
  total: number;
  done: number;
}

type State =
  | 'attract'
  | 'brief1'
  | 'round1'
  | 'r1result'
  | 'brief2'
  | 'round2a'
  | 'aiThink'
  | 'round2b'
  | 'results'
  | 'presenter';

const ATTRACT_LINES = ['attract.line1', 'attract.line2', 'attract.line3'];
/** How fast wave A's thief walks his machine-speed plan. */
const WAVE_A_RATE = 0.75;

const MUSIC_THEME = '/audio/theme.m4a';
const MUSIC_ANTHEM = '/audio/bella_ciao.m4a';
const CLICK_RADIUS_M = 3.2;

export interface FlowDeps {
  level: Level;
  stage: Stage;
  director: CameraDirector;
  view: WorldView;
  input: InputManager;
  overlay: Overlay;
  audio: AudioBus;
  planner: PlannerClient;
  canvas: HTMLCanvasElement;
}

/**
 * The station's whole visit: attract loop, play as the thief, play as the chief,
 * then the comparison. Every screen has a hard cap and an idle timeout, because
 * at a fair people walk away mid-sentence.
 */
export class GameFlow {
  readonly signals = new Emitter<{ sim: SimEvent }>();
  private replanCount = 0;
  /** Read-only presentation data for the synchronized spectator screen. */
  get displayState() {
    return { elapsedMs: this.stateMs, ways: this.ways, replanning: this.replanInFlight, replanCount: this.replanCount };
  }
  state: State = 'attract';
  readonly world: SimWorld;
  readonly session = new Session();
  private stateMs = 0;
  private idleMs = 0;
  private picker = new GroundPicker();
  private rng = new Rng(Date.now() >>> 0);
  private attractLineIdx = 0;
  private attractTypeMs = 0;
  private attractRunMs = 0;
  private attractPlans: Plan[] = [];
  private swarmPlans: Plan[] = [];
  private pendingSpawn: Plan[] = [];
  private waveBStarted = 0;
  /** Time spent showing the wave A verdict, so the beat lands before the AI's turn. */
  private waveAResultMs = 0;
  /** No route could be planned for wave A: there is nobody to send. */
  private waveANoWalker = false;
  /** Has the chief moved a guard or locked a door yet this round? */
  private chiefActed = false;
  private waveAHinted = false;
  private thinkRevealed = 0;
  /** Plans ordered so one representative of each distinct way comes first. */
  private thinkOrder: Plan[] = [];
  private thinkFirsts = 0;
  /** The distinct ways in, in reveal order: the thing the whole exhibit is about. */
  private ways: WayInfo[] = [];
  private wayOf = new Map<number, number>();
  private thinkDurationMs: number = TIMERS.aiThink;
  private banner: { text: string; until: number } | null = null;
  private selectedGuard = -1;
  /** A short freeze on a catch, so the moment registers before the world moves on. */
  private hitStopMs = 0;
  private arrowVec = new Vector3();
  /** Key-repeat delay while choosing a wire, so one press moves one wire. */
  private wireRepeatMs = 0;
  /** A one-off cue, such as having just put a uniform on. */
  private eventCue: (Cue & { untilMs: number }) | null = null;
  /** The phase board for round 1. */
  readonly missions = new MissionTracker();
  readonly walkthrough = new GuidedWalkthrough();
  guided = true;
  private guideStep: GuideStep | null = null;
  /** Guard highlighted by the operator panel. */
  presenterGuard = -1;
  private replanningUntil = 0;
  private hoverGuard = -1;
  private hoverDoor = -1;
  private orderTarget: { guard: number; x: number; y: number } | null = null;
  private replanInFlight = false;
  private lastReplanTick = -999;
  private planningLabel: string | null = null;
  private lastAlarmState = false;
  paused = false;
  timersEnabled = true;
  missionsVisible = false;
  adminAssisted = false;
  private stageRevision = 0;
  private adminStartSwarm = false;
  private presenterReturn: State = 'attract';
  onPresenterOpen?: () => void;

  constructor(private readonly d: FlowDeps) {
    this.world = new SimWorld(d.level, 1234);
    onLangChange(() => {
      this.d.overlay.applyI18n();
      this.refreshStaticText();
    });
    d.overlay.langToggle.addEventListener('click', () => {
      toggleLang();
      this.d.audio.play('blip');
    });
    d.input.onPresenterHotkey(() => this.togglePresenter());
    // The alarm needs a target you can hit with a mouse, not just a key.
    d.overlay.onWireClick((i) => {
      const g = this.world.activeWire;
      if (!g) return;
      g.select(i);
      this.world.attemptCut();
    });
    d.overlay.alarmButton.addEventListener('click', () => {
      if (this.state !== 'round2a' && this.state !== 'round2b') return;
      if (this.world.triggerAlarm('chief')) this.d.audio.play('alarm');
      else this.d.audio.play('deny');
    });
    void this.preparePlans();
  }

  // ------------------------------------------------------------- lifecycle

  private async preparePlans(): Promise<void> {
    await this.d.planner.whenReady();
    const job = this.d.planner.plan({
      nowTick: 0,
      doorLocked: this.world.doorLocked,
      guardPrograms: this.world.guards.map((g) => g.program),
      alarmWindows: [],
      requests: enumerateRequests(this.d.level, 60, 99, 1, SWARM_DELAYS),
      budgetMs: 3000,
    });
    const { plans, cancelled } = await job.promise;
    if (cancelled) return;
    this.attractPlans = plans;
    if (this.state === 'attract') this.startAttractSwarm();
  }

  enter(next: State): void {
    this.stageRevision++;
    this.adminStartSwarm = false;
    this.state = next;
    this.d.view.setGuideTargets([]);
    this.d.overlay.setEntranceIndicators([]);
    this.stateMs = 0;
    this.idleMs = 0;
    this.banner = null;
    if (next !== 'aiThink' && next !== 'round2b') this.d.overlay.setWays(null);
    switch (next) {
      case 'attract':
        this.setupAttract();
        break;
      case 'brief1':
        this.setupBrief1();
        break;
      case 'round1':
        this.setupRound1();
        break;
      case 'r1result':
        this.setupR1Result();
        break;
      case 'brief2':
        this.setupBrief2();
        break;
      case 'round2a':
        this.setupRound2A();
        break;
      case 'aiThink':
        void this.setupAiThink();
        break;
      case 'round2b':
        this.setupRound2B();
        break;
      case 'results':
        this.setupResults();
        break;
      case 'presenter':
        this.d.overlay.show('none');
        this.d.overlay.showPresenter(true);
        break;
    }
  }

  private refreshStaticText(): void {
    this.d.overlay.setWanted(loadBoard());
  }

  // --------------------------------------------------------------- attract

  private setupAttract(): void {
    this.replanCount = 0;
    const { director, view, overlay, stage, audio } = this.d;
    this.session.reset(pickCodename(this.rng.int(1 << 30)));
    overlay.show('attract');
    overlay.showPresenter(false);
    overlay.setWanted(loadBoard());
    overlay.setGlyphs(overlay.attractGlyphs, this.d.input.state.lastDevice);
    stage.setNight(true);
    view.setCutaway(true);
    view.setConesVisible(false);
    view.clearHint();
    view.clearPhaseMarks();
    director.cut('attract');
    director.setOrbit(4.5);
    // The theme carries the idle screen. If sound is still blocked this is
    // remembered and starts on the visitor's first touch.
    audio.requestMusic(MUSIC_THEME, config.musicVolume * 0.75);
    audio.setAlarm(false);
    this.startAttractSwarm();
    this.attractLineIdx = 0;
    this.attractTypeMs = 0;
  }

  private startAttractSwarm(): void {
    const { view } = this.d;
    this.world.clearThieves();
    view.resetAgents();
    this.world.tick = 0;
    this.world.resetGuards();
    this.world.alarmUntilTick = -1;
    const plans = this.attractPlans.slice(0, 40);
    plans.forEach((p, i) => this.world.spawnPlanThief(p, `A${i}`));
    view.trails.setOpacity(0.22);
    view.trails.show(this.d.level, plans, 40);
    this.attractRunMs = 0;
  }

  private updateAttract(dtMs: number): void {
    this.attractTypeMs += dtMs;
    const line = t(ATTRACT_LINES[this.attractLineIdx]);
    const charMs = 34;
    const shown = Math.min(line.length, Math.floor(this.attractTypeMs / charMs));
    this.d.overlay.attractLine.textContent = line.slice(0, shown);
    if (this.attractTypeMs > line.length * charMs + 2600) {
      this.attractTypeMs = 0;
      this.attractLineIdx = (this.attractLineIdx + 1) % ATTRACT_LINES.length;
    }
    this.d.overlay.setGlyphs(this.d.overlay.attractGlyphs, this.d.input.state.lastDevice);

    // Clear agents that already made it, so the vault does not silt up with
    // motionless figures while the loop plays on.
    for (const th of this.world.thieves) {
      if (th.breached && th.active) {
        th.active = false;
        this.d.view.releaseThief(th.id);
      }
    }

    // Restart on a fixed cadence so the idle screen always has movement.
    this.attractRunMs += dtMs;
    const played = this.world.thieves.every((x) => !x.active);
    if (this.attractPlans.length && (played || this.attractRunMs > 26000)) {
      this.startAttractSwarm();
    }
  }

  // -------------------------------------------------------------- briefings

  /** The Professor's briefing, read off the building the visitor is about to rob. */
  private briefingLines(): string[] {
    const L = this.d.level.json;
    const ways = L.entries.map((e) => t(e.nameKey)).join(', ');
    return [
      t('brief.ways', { n: L.entries.length, list: ways }),
      t('brief.vault'),
      t('brief.watch', { guards: L.guards.length, cameras: L.cameras.length }),
    ];
  }

  private setupBrief1(): void {
    const { overlay, director, view, stage, audio } = this.d;
    overlay.show('brief');
    overlay.brief({
      title: t('intro1.title'),
      body: t('intro1.body'),
      lines: this.briefingLines(),
      controls: t('intro1.controls'),
      codename: `${t('intro1.codename')}: ${this.session.codename}`,
    });
    stage.setNight(false);
    view.setCutaway(true);
    view.setConesVisible(true);
    view.trails.clear();
    view.ribbons.clear();
    director.setOrbit(0);
    director.moveTo('gameplay', 2.2);
    audio.fadeMusic(config.musicVolume * 0.35, 1.4);
    audio.play('whoosh');
  }

  private setupBrief2(): void {
    const { overlay, director, audio } = this.d;
    overlay.show('brief');
    overlay.brief({
      title: t('intro2.title'),
      body: t('intro2.body'),
      controls: t('intro2.controls'),
      tip: t('intro2.tip'),
    });
    director.moveTo('gameplay', 1.4);
    audio.play('whoosh');
  }

  // --------------------------------------------------------------- round 1

  private setupRound1(): void {
    const { overlay, view, level, director } = this.d;
    overlay.show('hud1');
    this.resetWorldForPlay();
    const entry = level.json.entries.find((e) => e.id === 'front') ?? level.json.entries[0];
    this.world.spawnPlayer(entry.id, this.session.codename);
    view.resetAgents();
    view.setConesVisible(true);
    view.hintAt(level.json.vault.cell[0] + 0.5, level.json.vault.cell[1] + 0.5);
    view.markKeycard(this.world);
    director.moveTo('follow', 1.2);
    this.missions.reset();
    this.walkthrough.reset();
    this.guideStep = null;
    this.d.overlay.resetMissions();
    this.session.round1.entriesTried.add(entry.id);
  }

  /** Put a one-off cue on screen for a few seconds. */
  private showCue(cue: Cue, ms = 4500): void {
    this.eventCue = { ...cue, untilMs: performance.now() + ms };
  }

  /**
   * What the visitor can do right here. One channel, in priority order, so two
   * offers never fight over the same corner of the screen. The mini-games have
   * their own panels and suppress it entirely.
   */
  private roundOneCue(player: Thief): Cue | null {
    if (this.world.activeWire || this.world.activePick || this.world.activeDrill) return null;

    // Once the vault is open, getting the money out is the only thing to say.
    const exfilCue = this.exfilCue(player);
    if (exfilCue) return exfilCue;

    if (this.world.playerInTruck) {
      const stopped = truckIsOpen(this.world.truck);
      return {
        key: 'truck-ride',
        icon: '\u{1F69A}',
        title: t('cue.inTruck'),
        press: t('cue.space'),
        hint: stopped ? t('cue.getOut') : t('cue.ridingOn'),
        waiting: !stopped,
      };
    }
    if (this.eventCue && performance.now() < this.eventCue.untilMs) return this.eventCue;
    this.eventCue = null;

    if (this.world.canBoardTruck()) {
      return {
        key: 'truck-board',
        icon: '\u{1F69A}',
        title: t('cue.hideInTruck'),
        press: t('cue.space'),
        hint: t('cue.whileLoading'),
      };
    }
    if (this.atSealedVault(player)) {
      return { key: 'vault-card', icon: '\u{1F512}', title: t('cue.vaultSealed'), hint: t('cue.vaultSealedHint') };
    }
    return this.nearbyItemCue(player);
  }

  /**
   * Getting it out, one step at a time. The order is the order of the phase:
   * open a way out, wait for the van, then walk the money to it. Only one of
   * these is ever true, so the corner never has to choose between two.
   */
  private exfilCue(player: Thief): Cue | null {
    const w = this.world;
    if (!w.exfil || !player.breached || w.exfilDone) return null;
    if (this.eventCue && performance.now() < this.eventCue.untilMs) return this.eventCue;

    if (!w.holeOpen) {
      // The wall itself opens the drill panel; until he is at it, say where.
      return { key: 'exfil-wall', icon: '\u{1F528}', title: t('cue.wall'), hint: t('cue.wallHint') };
    }
    if (player.carrying) {
      return w.atVan(player)
        ? { key: 'exfil-drop', icon: '\u{1F4B0}', title: t('cue.dropLoad'), press: t('cue.space'), hint: t('cue.dropLoadHint') }
        : {
            key: 'exfil-carry',
            icon: '\u{1F4B0}',
            title: t('cue.carrying'),
            hint: t('cue.carryingHint'),
            waiting: !w.van.parked,
          };
    }
    if (w.pressInReach(player)) {
      return { key: 'exfil-take', icon: '\u{1F4B5}', title: t('cue.takeLoad'), press: t('cue.space'), hint: t('cue.takeLoadHint') };
    }
    // Same offer, greyed key: the money is on the presses, he is not at one yet.
    return {
      key: 'exfil-run',
      icon: '\u{1F4B5}',
      title: t('cue.takeLoad'),
      press: t('cue.space'),
      hint: t('cue.takeLoadFar'),
      waiting: true,
    };
  }

  /** An item on the floor nearby, so the visitor knows what it is before taking it. */
  private nearbyItemCue(player: Thief): Cue | null {
    const level = this.d.level;
    let best: Cue | null = null;
    let bestD = 4.5;
    level.json.keycards.forEach((k, i) => {
      if (this.world.keyTaken[i] === 1 || player.keys.has(k.id)) return;
      const d = Math.hypot(k.cell[0] + 0.5 - player.x, k.cell[1] + 0.5 - player.y);
      if (d >= bestD) return;
      bestD = d;
      const kind = k.kind ?? 'card';
      best =
        kind === 'uniform'
          ? { key: 'item-uniform', icon: '\u{1F455}', title: t('cue.uniform'), hint: t('cue.walkOver') }
          : kind === 'fuse'
            ? { key: 'item-fuse', icon: '\u{26A1}', title: t('cue.fuseBox'), hint: t('cue.standAtIt') }
            : { key: 'item-card', icon: '\u{1F511}', title: t('cue.card'), hint: t('cue.walkOver') };
    });
    return best;
  }

  /** Standing at the vault with no card: there is no lock to work, only a reader. */
  private atSealedVault(player: Thief): boolean {
    const level = this.d.level;
    const di = level.doors.findIndex((d) => d.kind === 'vault');
    if (di < 0) return false;
    const r = level.doors[di].rect;
    const cx = r[0] + r[2] / 2;
    const cy = r[1] + r[3] / 2;
    return (
      Math.hypot(player.x - cx, player.y - cy) < 3.5 && !this.world.doorOpenFor(di, player)
    );
  }

  /**
   * Where the arrow points: the vault until it is open, and after that whatever
   * the next step of getting the money out is. The label under the glyph is set
   * from the same decision.
   */
  private objectiveCell(): { cell: readonly number[]; labelKey: string } {
    const level = this.d.level;
    const w = this.world;
    const p = w.player;
    const def = w.exfil;
    if (def && p?.breached && !w.exfilDone) {
      if (!w.holeOpen) return { cell: def.stand, labelKey: 'missions.hole' };
      if (p.carrying) return { cell: def.van, labelKey: 'missions.van' };
      // Whichever press is nearer, so the arrow never sends him across the hall.
      let best = def.presses[0];
      let bestD = Infinity;
      for (const c of def.presses) {
        const d = Math.hypot(c[0] + 0.5 - p.x, c[1] + 0.5 - p.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return { cell: best, labelKey: 'missions.load' };
    }
    return { cell: level.json.vault.cell, labelKey: 'round1.vault' };
  }

  /** When the objective is off screen, an arrow at the edge says where to go. */
  private updateObjectiveArrow(): void {
    const { overlay, director, level, canvas } = this.d;
    const targets = this.guideStep?.targets;
    if (targets && (this.guideStep?.id === 'entry' || targets.length > 1)) {
      const points: {x:number;y:number;angleDeg:number}[] = [];
      targets.forEach((target, index) => {
        const v = this.arrowVec.set(fineXYToWorldX(level,target.cell[0]+.5), .5, fineXYToWorldZ(level,target.cell[1]+.5));
        const position = this.d.view.guidePosition(index);
        if (position && guideArrowInView(position, director.camera)) return;
        if (position) { v.copy(position); v.y += .7; }
        const behind = v.clone().applyMatrix4(director.camera.matrixWorldInverse).z >= 0;
        v.project(director.camera);
        if (behind) { v.x *= -1; v.y *= -1; }
        if (!position && !behind && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) return;
        const angle = Math.atan2(v.y,v.x);
        const scale = 1 / Math.max(Math.abs(Math.cos(angle))/.92, Math.abs(Math.sin(angle))/.80);
        points.push({ x:(Math.cos(angle)*scale*.5+.5)*canvas.clientWidth,
          y:(.5-Math.sin(angle)*scale*.5)*canvas.clientHeight, angleDeg:-angle*180/Math.PI });
      });
      overlay.setObjectiveArrow(null);
      overlay.setEntranceIndicators(points, this.guideStep?.id === 'entry' ? 'Entrance' : 'Objective');
      return;
    }
    overlay.setEntranceIndicators([]);
    const p = this.world.player;
    const nearest = targets && p ? [...targets].sort((a,b) => Math.hypot(a.cell[0]-p.x,a.cell[1]-p.y)-Math.hypot(b.cell[0]-p.x,b.cell[1]-p.y))[0] : null;
    const goal = nearest ? { cell: nearest.cell, labelKey: this.guideStep!.labelKey } : this.objectiveCell();
    overlay.setObjectiveLabel(t(goal.labelKey));
    const v = this.arrowVec.set(
      fineXYToWorldX(level, goal.cell[0] + 0.5),
      0.5,
      fineXYToWorldZ(level, goal.cell[1] + 0.5),
    );
    if (nearest && targets) {
      const position = this.d.view.guidePosition(targets.indexOf(nearest));
      if (position && guideArrowInView(position, director.camera)) {
        overlay.setObjectiveArrow(null);
        return;
      }
      if (position) { v.copy(position); v.y += .7; }
    }
    const behind = v.clone().applyMatrix4(director.camera.matrixWorldInverse).z >= 0;
    v.project(director.camera);
    if (behind) { v.x *= -1; v.y *= -1; }
    const margin = 0.86;
    if (!nearest && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1 && !behind) {
      overlay.setObjectiveArrow(null);
      return;
    }
    const ang = Math.atan2(v.y, v.x);
    // Slide along the direction until it hits the margin box.
    const k = margin / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
    const nx = Math.cos(ang) * k;
    const ny = Math.sin(ang) * k;
    overlay.setObjectiveArrow({
      x: (nx * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - (ny * 0.5 + 0.5)) * canvas.clientHeight,
      angleDeg: (-ang * 180) / Math.PI,
    });
  }

  /** Fine cell of each card, for the planner's copy of the level. */
  private keycardCells(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of this.d.level.json.keycards) out[k.id] = cellOf(this.d.level, k.cell);
    return out;
  }

  private resetWorldForPlay(): void {
    // A different desk every visit, so watching someone else play gives nothing away.
    placeKeycards(this.d.level, this.rng);
    this.world.clearThieves();
    this.world.tick = 0;
    this.world.resetGuards();
    this.world.alarmUntilTick = -1;
    this.world.camerasDownUntil = -1;
    this.world.alarmWindows = [];
    this.world.doorPickedOpen.fill(0);
    this.world.keyTaken.fill(0);
    this.world.resetExfil();
    // The stands are built once, so after a fresh placement and reset they have
    // to be told where the card went and shown again.
    this.d.view.markKeycard(this.world);
    this.d.level.doors.forEach((d, i) => (this.world.doorLocked[i] = d.locked ? 1 : 0));
    // Door state drives sight-blocking, so it has to be recomputed here or a
    // door picked open in an earlier round stays see-through all session.
    this.world.refreshOpacity();
    this.world.chief.locksLeft = this.d.level.json.rules.maxLocks;
    this.world.chief.alarmReadyAtTick = 0;
    this.selectedGuard = -1;
    this.hoverGuard = -1;
    this.hoverDoor = -1;
    this.orderTarget = null;
    this.d.view.clearOrder();
    this.d.view.trails.clear();
    this.d.view.clearPhaseMarks();
    this.d.view.resetAgents();
  }

  private updateRound1(dtMs: number): void {
    const { input, overlay, director, level } = this.d;
    const player = this.world.player;
    this.session.round1.timeMs = this.stateMs;
    if (!player) return;

    const s = input.state;
    const dir = { x: 0, y: 0 };
    // The drill is held, not tapped, so it reads the button every frame.
    this.world.setDrilling(s.start.down && !this.world.activeWire && !this.world.activePick);
    const drillGame = this.world.activeDrill;
    const wireGame = this.world.activeWire;
    if (wireGame) {
      // Hands in the fuse box: up and down choose a wire, and walking sideways
      // is how you step away from the panel.
      this.wireRepeatMs = Math.max(0, this.wireRepeatMs - dtMs);
      if (s.move.y !== 0 && this.wireRepeatMs === 0) {
        wireGame.moveCursor(s.move.y > 0 ? 1 : -1);
        this.wireRepeatMs = 170;
        this.d.audio.play('blip');
      } else if (s.move.y === 0) {
        this.wireRepeatMs = 0;
      }
      if (s.move.x !== 0) {
        director.screenToWorldDir(s.move.x, 0, dir);
        this.world.setPlayerMove(dir.x, dir.y);
      } else {
        this.world.setPlayerMove(0, 0);
      }
      if (s.start.pressed) this.world.attemptCut();
    } else if (s.move.x !== 0 || s.move.y !== 0) {
      director.screenToWorldDir(s.move.x, s.move.y, dir);
      this.world.setPlayerMove(dir.x, dir.y);
    } else {
      this.world.setPlayerMove(0, 0);
    }
    if (s.pointer.click.pressed) {
      const p = this.picker.pick(
        director.camera,
        s.pointer.x,
        s.pointer.y,
        this.d.canvas.clientWidth,
        this.d.canvas.clientHeight,
      );
      if (p) {
        const cell = worldToFine(level, p.x, p.z);
        if (cell >= 0 && level.walk[cell]) {
          this.world.setPlayerRoute(cell);
          this.d.audio.play('blip');
        }
      }
    }
    director.lookNear(fineXYToWorldX(level, player.x), fineXYToWorldZ(level, player.y), 0.82);
    this.updateObjectiveArrow();
    // The board says what the phase is; the building shows where it is.
    this.d.view.setPhaseMarks(level, this.missions.activeMarks);

    // Walking the perimeter is what puts the ways in on the board.
    for (const found of this.missions.update(this.world, level, player)) {
      this.showCue({
        key: `found-${found.id}`,
        icon: '\u{1F50E}',
        title: t(found.labelKey),
        hint: t(found.cyberKey),
      });
      this.d.audio.play('confirm');
    }

    this.guideStep = this.guided ? this.walkthrough.update(this.world, level, this.missions) : null;
    this.d.view.setGuideTargets(this.guideStep?.targets ?? []);
    this.updateObjectiveArrow();

    // Working a lock: presses go to the mini-game, not to the world.
    const pickGame = this.world.activePick;
    if (pickGame && s.start.pressed) {
      const res = this.world.attemptPick();
      if (res === 'miss') this.d.director.shake(0.18);
    } else if (!wireGame && !drillGame && s.start.pressed) {
      // Nothing under the hands. In order of what is actually in front of him:
      // the money, the van, then the supplier's truck.
      if (this.world.atVan(player)) this.world.dropLoad();
      else if (this.world.pressInReach(player)) this.world.takeLoad();
      else if (this.world.playerInTruck) this.world.leaveTruck();
      else this.world.boardTruck();
    }

    let progress: { label: string; value: number } | null = null;
    if (player.portalTicks > 0) {
      progress = { label: '…', value: 0.5 };
    }

    const timeLeft = TIMERS.round1Cap - this.stateMs;
    overlay.hud1({
      timeMs: this.stateMs,
      caught: player.caughtCount,
      codename: this.session.codename,
      goal: player.breached ? t('round1.goalExfil') : t('round1.goal'),
      banner: this.activeBanner(),
      progress,
      missions: this.missions.phases,
      cue: this.roundOneCue(player),
      wire: wireGame
        ? {
            label: t('round1.wireLabel'),
            hint: t('round1.wireHint'),
            wires: wireGame.wires.map((w) => ({ color: w.color, live: w.live, cut: w.cut })),
            cursor: wireGame.cursor,
            phase: wireGame.phase,
            jammed: wireGame.jammed,
            flash:
              wireGame.flashTicks > 0 && wireGame.lastResult !== 'none'
                ? wireGame.lastResult === 'short'
                  ? ('short' as const)
                  : ('cut' as const)
                : null,
          }
        : null,
      drill: drillGame
        ? {
            label: t('round1.drillLabel'),
            hint: drillGame.jammed ? t('round1.drillJammed') : t('round1.drillHint'),
            heatLabel: t('round1.drillHeat'),
            progress: drillGame.progress,
            heat: drillGame.heat,
            jammed: drillGame.jammed,
            biting: drillGame.lastResult === 'drilling',
          }
        : null,
      // The tally only means anything once there is a van to fill.
      loads:
        this.world.exfil && player.breached
          ? { label: t('round1.loads'), out: this.world.loadsOut, of: this.world.loadsNeeded }
          : null,
      pick: pickGame
        ? {
            label: t('round1.picking'),
            hint: t('round1.pickHint'),
            zoneStart: pickGame.zoneStart,
            zoneWidth: pickGame.spec.zone,
            marker: pickGame.marker,
            pins: pickGame.spec.pins,
            pinsSet: pickGame.pinsSet,
            flash:
              pickGame.flashTicks > 0 && pickGame.lastResult !== 'none'
                ? (pickGame.lastResult as 'hit' | 'miss')
                : null,
          }
        : null,
      // While a lock is being worked the only instruction that matters is the
      // one on the bar; the walking prompt would contradict it.
      prompt:
        pickGame || wireGame || drillGame
        ? ''
        : player.breached
          ? t('round1.exfilPrompt')
          : this.atSealedVault(player)
          ? t('round1.needCard')
          : this.world.camerasDown
            ? t('round1.power')
            : this.world.isDisguised(player)
              ? t('round1.uniform')
              : player.keys.size > 0
                ? t('round1.keycard')
                : t('intro1.controls'),
    });
    void dtMs;

    // Reaching the vault proves the way in, and that is still the number the
    // results screen compares against the AI. It no longer ends the round:
    // standing in a vault is not a robbery until the money is outside.
    if (player.breached) this.session.round1.breached = true;
    if (this.world.exfilDone) {
      this.session.round1.exfiltrated = true;
      this.enter('r1result');
    } else if (timeLeft <= 0) {
      this.enter('r1result');
    } else if (player.breached && !this.world.exfil) {
      this.enter('r1result');
    }
  }

  private setupR1Result(): void {
    const r = this.session.round1;
    r.caught = this.world.player?.caughtCount ?? 0;
    r.waysFound = r.breached ? 1 : 0;
    r.loadsOut = this.world.loadsOut;
    // Three verdicts now, not two: never got in, got in but nothing left the
    // building, or the money is in the van. The middle one is the lesson.
    const key = r.exfiltrated
      ? 'round1.result.out'
      : r.breached
        ? 'round1.result.stuck'
        : 'round1.result.fail';
    this.showBanner(t(key), 4200);
    this.d.audio.play(r.exfiltrated ? 'breach' : 'deny');
    if (r.breached) this.d.director.moveTo('vault', 1.2);
  }

  // --------------------------------------------------------------- round 2

  private setupRound2A(): void {
    const { overlay, director, view } = this.d;
    overlay.show('hud2');
    this.resetWorldForPlay();
    director.moveTo('gameplay', 1.0);
    view.clearHint();
    this.waveAResultMs = 0;
    this.chiefActed = false;
    this.waveAHinted = false;
    this.waveANoWalker = false;
    // Re-entering the round (presenter, skip) must not inherit the last verdict:
    // `settled` reads it, so a stale one ends the round before it starts.
    this.session.round2.waveA = 'pending';
    this.showBanner(t('round2.waveA'), 3000);
    void this.spawnWaveA();
  }

  /**
   * Which of the walking-pace plans to send. A route has to finish well inside
   * the round or the visitor watches a man who was never going to arrive, and a
   * door beats a sewer because the approach should be visible from the start.
   */
  private pickWalker(plans: Plan[]): Plan | undefined {
    if (!plans.length) return undefined;
    const rules = this.d.level.json.rules;
    // He reads the plan slowly, so a plan quantum costs more wall time than it says.
    const quantaPerMs = (rules.tickHz / 1000 / rules.quantumTicks) * WAVE_A_RATE;
    const maxQ = Math.max(1, Math.floor((TIMERS.round2ACap - 7000) * quantaPerMs));
    const entryRank = (p: Plan) => {
      const e = this.d.level.json.entries.find((x) => x.id === p.request.entryId);
      return e && (e.kind === 'door' || e.kind === 'gate') ? 0 : 1;
    };
    const fits = plans.filter((p) => p.endQ <= maxQ);
    return [...(fits.length ? fits : plans)].sort(
      (a, b) => entryRank(a) - entryRank(b) || a.endQ - b.endQ,
    )[0];
  }

  private async spawnWaveA(): Promise<void> {
    const revision = this.stageRevision;
    // One thief with a good plan, walked slowly. Planning at machine speed is
    // what makes a route exist at all; WAVE_A_RATE is what makes him human. He
    // never replans, so a guard the visitor moves is one his plan cannot know.
    const walkers = enumerateRequests(this.d.level, 24, 4242, 1, [0, 2, 4]);
    const plans = await this.requestPlans(walkers);
    if (revision !== this.stageRevision || this.state !== 'round2a' || plans === null) return;
    let chosen = this.pickWalker(plans);
    if (!chosen) {
      // The building is currently too tight for a walker. Send a fast one
      // rather than leaving the round empty. Re-check the state first: issuing
      // a job here once the AI phase had started cancelled the swarm's own job
      // out from under it, and the exhibit went on with no routes at all.
      if (this.state !== 'round2a') return;
      const fallback = await this.requestPlans(
        enumerateRequests(this.d.level, 24, 91, 1, [0, 2, 4, 6]).map((r) => ({ ...r, naive: true })),
      );
      if (revision !== this.stageRevision || this.state !== 'round2a' || fallback === null) return;
      chosen = this.pickWalker(fallback);
    }
    if (!chosen) {
      // Nobody to send. Say so and move on rather than showing the visitor an
      // empty building for the rest of the round.
      console.warn('[casa] wave A: no walkable route, skipping to the AI phase');
      this.waveANoWalker = true;
      return;
    }
    const thief = this.world.spawnPlanThief(chosen, 'Berlin');
    thief.speed = 0;
    thief.planRate = WAVE_A_RATE;
    // His route is on the table: the chief's job is to read it and act.
    this.d.view.trails.setOpacity(0.42);
    this.d.view.trails.show(this.d.level, [chosen], 1);
  }

  /**
   * The timetable as the planner should see it. A guard mid-chase is pinned
   * where he really is for a few seconds; the schedule resumes afterwards.
   */
  plannerPrograms(): PatrolProgram[] {
    return this.world.guards.map((g) =>
      g.state === 'patrol'
        ? g.program
        : withTemporaryPost(g.program, g.x, g.y, g.facing, this.world.tick, 70),
    );
  }

  /** Null means a newer job took the worker: stand down, do not act on this. */
  private async requestPlans(
    requests: ReturnType<typeof enumerateRequests>,
  ): Promise<Plan[] | null> {
    const job = this.d.planner.plan({
      nowTick: this.world.tick,
      doorLocked: this.world.doorLocked,
      guardPrograms: this.plannerPrograms(),
      alarmWindows: this.world.alarmWindows,
      keycardCells: this.keycardCells(),
      requests,
      budgetMs: 3000,
    });
    const { plans, cancelled } = await job.promise;
    return cancelled ? null : plans;
  }

  /**
   * The beat that carries the whole exhibit: the AI is handed this building for
   * the first time and, in under a second, works out every way in. The routes
   * are then fanned out one at a time purely so a person can follow them; the
   * clock keeps showing the real planning time, not the length of the reveal.
   */
  private async setupAiThink(): Promise<void> {
    const revision = this.stageRevision;
    const { overlay, director, view, level } = this.d;
    overlay.show('think');
    this.swarmPlans = [];
    this.pendingSpawn = [];
    this.thinkRevealed = 0;
    this.thinkOrder = [];
    this.thinkFirsts = 0;
    this.world.clearThieves();
    view.resetAgents();
    view.trails.clear();
    view.ribbons.clear();
    view.setConesVisible(false);
    director.moveTo('gameplay', 1.2);
    this.ways = [];
    this.wayOf.clear();
    overlay.setWays([], t('ways.title'));
    this.session.round2.swarmSize = config.swarmSize;
    overlay.think({ ways: 0, unit: t('think.ways'), clock: '' });

    let plans = await this.requestSwarmPlans();
    if (revision !== this.stageRevision || this.state !== 'aiThink') return;
    if (plans === null || !plans.length) {
      // The one beat the whole exhibit is built around. If the worker was taken
      // by a stale job, or came back with nothing, ask again before giving up.
      console.warn('[casa] swarm planning came back empty, retrying once');
      plans = await this.requestSwarmPlans();
      if (revision !== this.stageRevision || this.state !== 'aiThink') return;
    }
    const found = plans ?? [];
    this.swarmPlans = found;

    // Counting distinct ways saturates almost immediately if the routes are
    // revealed in planning order, so lead with one route per distinct way.
    const seen = new Set<string>();
    const firsts: Plan[] = [];
    const rest: Plan[] = [];
    for (const p of found) {
      const sig = coarseSignature(p.signature);
      if (seen.has(sig)) rest.push(p);
      else {
        seen.add(sig);
        firsts.push(p);
      }
    }
    this.thinkOrder = [...firsts, ...rest];
    this.thinkFirsts = firsts.length;
    this.ways = firsts.map((p) => this.describeWay(p, found));
    view.ribbons.build(level, this.ways.map((w) => ({ plan: w.plan, color: w.color })));
    view.ribbons.setOpacity(0.85);
    view.ribbons.reveal(0);
    this.thinkDurationMs = 900 + this.ways.length * 420 + 3000;
    if (this.adminStartSwarm) {
      this.adminStartSwarm = false;
      if (found.length) this.enter('round2b');
      else this.d.overlay.toast('No routes found. Reset this stage to retry.');
    }
  }

  /** Name a way in the visitor's terms: which door, and how it got through. */
  private describeWay(p: Plan, plans: Plan[]): WayInfo {
    const sig = coarseSignature(p.signature);
    const [entryId, keyKind, doors] = p.signature.split('|');
    const picked = doors
      ? doors
          .split('+')
          .filter((d) => d.startsWith('pick:'))
          .map((d) => {
            const door = this.d.level.doors.find((x) => x.id === d.slice(5));
            return door?.nameKey ? t(door.nameKey) : d.slice(5);
          })
      : [];
    const parts: string[] = [];
    if (keyKind === 'key') parts.push(t('way.key'));
    if (keyKind === 'uniform') parts.push(t('way.uniform'));
    if (keyKind === 'power') parts.push(t('way.power'));
    // Door details only when picking is the whole trick; otherwise the row gets long.
    if (picked.length && keyKind === 'lockpick') parts.push(t('way.picks', { doors: picked.join(', ') }));
    else if (picked.length) parts.push(t('way.pickN', { n: picked.length }));
    // Long waits are a tactic too: the AI read the timetable.
    let waitQ = 0;
    for (let i = 1; i < p.nodes.length; i++) {
      if (p.nodes[i].kind === 'wait') waitQ += p.nodes[i].arriveQ - p.nodes[i - 1].arriveQ;
    }
    if (waitQ >= 12) parts.push(t('way.waits'));
    const how = parts.length ? parts.join(' · ') : t('way.none');
    const entry = this.d.level.json.entries.find((e) => e.id === entryId);
    return {
      sig,
      plan: p,
      color: wayColor(entryId),
      name: entry ? t(entry.nameKey) : entryId,
      how,
      state: 'open',
      total: plans.filter((q) => coarseSignature(q.signature) === sig).length,
      done: 0,
    };
  }

  private waysItems(n: number): { n: number; name: string; how: string; color: number; state: 'open' | 'breached' | 'held' }[] {
    return this.ways.slice(0, n).map((w, i) => ({ n: i + 1, name: w.name, how: w.how, color: w.color, state: w.state }));
  }

  private refreshWays(): void {
    if (this.state === 'aiThink' || this.state === 'round2b') {
      this.d.overlay.setWays(this.waysItems(this.state === 'aiThink' ? this.thinkRevealed : this.ways.length), t('ways.title'));
    }
  }

  /** Null when a newer job took the worker; the caller retries rather than
   * running the centrepiece of the exhibit with no routes. */
  private async requestSwarmPlans(): Promise<Plan[] | null> {
    const job = this.d.planner.plan({
      nowTick: this.world.tick,
      doorLocked: this.world.doorLocked,
      guardPrograms: this.plannerPrograms(),
      alarmWindows: this.world.alarmWindows,
      keycardCells: this.keycardCells(),
      requests: enumerateRequests(this.d.level, config.swarmSize, 777, 1, SWARM_DELAYS),
      budgetMs: 4000,
    });
    const { plans, stats, cancelled } = await job.promise;
    if (cancelled) return null;
    this.session.ai = {
      distinct: stats.distinct,
      found: stats.found,
      planMs: stats.wallMs,
      searches: stats.searches,
      noPath: stats.noPath,
    };
    return plans;
  }

  private updateAiThink(): void {
    const { overlay, view } = this.d;
    if (!this.ways.length) {
      overlay.think({ ways: 0, unit: t('think.ways'), clock: '' });
      return;
    }
    // One way at a time, each with its ribbon on the map and its row in the
    // list, so the number on screen is a list a person can read, not a total.
    const lead = 900;
    const shown = this.stateMs < lead ? 0 : Math.min(this.ways.length, Math.floor((this.stateMs - lead) / 420) + 1);
    if (shown !== this.thinkRevealed) {
      this.thinkRevealed = shown;
      view.ribbons.reveal(shown);
      overlay.setWays(this.waysItems(shown), t('ways.title'));
      this.d.audio.play('blip');
    }
    const all = shown >= this.ways.length;
    overlay.think({
      ways: shown,
      unit: shown === 1 ? t('think.way') : t('think.ways'),
      clock: all ? t('think.done', { t: formatClock(this.session.ai.planMs) }) : '',
      note: all ? t('think.more', { n: Math.max(0, this.session.ai.found - this.ways.length) }) : t('think.note'),
    });
  }

  private setupRound2B(): void {
    const { overlay, director, view, level } = this.d;
    overlay.show('hud2');
    this.waveBStarted = 0;
    this.pendingSpawn = [...this.swarmPlans];
    this.world.clearThieves();
    view.resetAgents();
    view.setConesVisible(true);
    director.moveTo('gameplay', 1.2);
    this.showBanner(t('round2.waveB'), 3000);
    this.d.audio.play('whoosh');
    // The ways stay on the map, dimmed, and the list stays up to be checked off.
    view.trails.clear();
    view.ribbons.reveal(this.ways.length);
    view.ribbons.setOpacity(0.3);
    this.wayOf.clear();
    overlay.setWays(this.waysItems(this.ways.length), t('ways.title'));
    void level;
  }

  private drainSpawns(): void {
    while (this.pendingSpawn.length) {
      const plan = this.pendingSpawn.shift()!;
      const thief = this.world.spawnPlanThief(plan, `#${plan.agentId}`);
      thief.speed = 0;
      const wi = this.ways.findIndex((w) => w.sig === coarseSignature(plan.signature));
      if (wi >= 0) this.wayOf.set(thief.id, wi);
    }
  }

  private updateRound2(dtMs: number, wave: 'a' | 'b'): void {
    const { input, overlay, director, level } = this.d;
    const s = input.state;
    this.drainSpawns();
    this.tendBlockedThieves();
    this.updateChiefHover();

    // Drop the destination marker once the guard actually gets there.
    if (this.orderTarget) {
      const g = this.world.guards[this.orderTarget.guard];
      if (!g || Math.hypot(g.x - this.orderTarget.x, g.y - this.orderTarget.y) < 1.4) {
        this.orderTarget = null;
        this.d.view.clearOrder();
      }
    }

    if (s.alarm.pressed) {
      if (this.world.triggerAlarm('chief')) this.d.audio.play('alarm');
      else this.d.audio.play('deny');
    }

    if (s.pointer.click.pressed) this.handleChiefClick();

    const alarmCooldownMs = Math.max(
      0,
      ((this.world.chief.alarmReadyAtTick - this.world.tick) * 1000) / level.json.rules.tickHz,
    );
    const live = this.world.thieves.filter((x) => x.active && !x.breached && !x.caught).length;

    overlay.hud2({
      codename: this.session.codename,
      locks: this.world.chief.locksLeft,
      alarm: this.world.alarmActive
        ? '!!'
        : alarmCooldownMs > 0
          ? formatClock(alarmCooldownMs)
          : 'X',
      alarmReady: alarmCooldownMs <= 0,
      breaches: this.session.round2.breaches,
      caught: this.session.round2.caughtCount,
      thieves: live,
      wave:
        this.planningLabel ??
        (this.stateMs < 3400 ? (wave === 'a' ? t('round2.waveA') : t('round2.waveB')) : null),
      banner:
        this.replanningUntil > performance.now() ? t('round2.replanning') : this.activeBanner(),
      prompt: this.chiefPrompt(),
    });

    if (wave === 'b') {
      if (this.timersEnabled) this.waveBStarted += dtMs;
      this.session.round2.heldMs = this.session.round2.firstBreachMs ?? this.waveBStarted;
    }
    director.lookNear(0, 0, 0.1);
  }

  /** What the cursor is over, so the screen can say so before you commit. */
  private updateChiefHover(): void {
    const { input, director, level, canvas } = this.d;
    const s = input.state;
    this.hoverGuard = -1;
    this.hoverDoor = -1;
    const p = this.picker.pick(
      director.camera,
      s.pointer.x,
      s.pointer.y,
      canvas.clientWidth,
      canvas.clientHeight,
    );
    if (!p) return;

    let bestDoor = -1;
    let bestDoorD = CLICK_RADIUS_M;
    level.doors.forEach((d, i) => {
      if (!d.lockableByChief) return;
      const cx = fineXYToWorldX(level, d.rect[0] + d.rect[2] / 2);
      const cz = fineXYToWorldZ(level, d.rect[1] + d.rect[3] / 2);
      const dist = Math.hypot(p.x - cx, p.z - cz);
      if (dist < bestDoorD) {
        bestDoorD = dist;
        bestDoor = i;
      }
    });
    let bestGuard = -1;
    let bestGuardD = CLICK_RADIUS_M;
    this.world.guards.forEach((g, i) => {
      if (!g.present) return;
      const dist = Math.hypot(p.x - fineXYToWorldX(level, g.x), p.z - fineXYToWorldZ(level, g.y));
      if (dist < bestGuardD) {
        bestGuardD = dist;
        bestGuard = i;
      }
    });
    if (bestGuard >= 0 && bestGuardD <= bestDoorD) this.hoverGuard = bestGuard;
    else if (bestDoor >= 0) this.hoverDoor = bestDoor;
  }

  /** The line under the HUD, naming whatever the cursor is on. */
  private chiefPrompt(): string {
    const level = this.d.level;
    const guardName = (i: number) => t(level.json.guards[i].nameKey);
    if (this.hoverGuard >= 0) {
      const key = this.hoverGuard === this.selectedGuard ? 'round2.hoverDrop' : 'round2.hoverGuard';
      return t(key, { guard: guardName(this.hoverGuard) });
    }
    if (this.hoverDoor >= 0) {
      const door = level.doors[this.hoverDoor];
      const name = t(door.nameKey ?? 'door.front');
      const locked = this.world.doorLocked[this.hoverDoor] === 1;
      return t(locked ? 'round2.hoverUnlock' : 'round2.hoverLock', { door: name });
    }
    if (this.selectedGuard >= 0) {
      return t('round2.hoverSend', { guard: guardName(this.selectedGuard) });
    }
    return t('round2.idle');
  }

  private handleChiefClick(): void {
    const { level } = this.d;

    if (this.hoverGuard >= 0) {
      this.selectedGuard = this.selectedGuard === this.hoverGuard ? -1 : this.hoverGuard;
      if (this.selectedGuard < 0) this.d.view.clearOrder();
      this.d.audio.play('blip');
      return;
    }

    if (this.hoverDoor >= 0) {
      const locked = this.world.doorLocked[this.hoverDoor] === 1;
      const ok = this.world.lockDoor(this.hoverDoor, !locked, true);
      this.d.audio.play(ok ? 'unlock' : 'deny');
      if (!ok) this.d.overlay.toast(t('round2.noLocks'));
      if (ok) {
        this.chiefActed = true;
        void this.replanLiveThieves();
      }
      return;
    }

    if (this.selectedGuard >= 0) {
      const { input, director, canvas } = this.d;
      const s = input.state;
      const p = this.picker.pick(
        director.camera,
        s.pointer.x,
        s.pointer.y,
        canvas.clientWidth,
        canvas.clientHeight,
      );
      const cell = p ? worldToFine(level, p.x, p.z) : -1;
      if (cell >= 0 && level.walk[cell]) {
        const g = this.world.guards[this.selectedGuard];
        orderGuardTo(level, g.program, this.world.tick + 4, cell, 40, 200, { x: g.x, y: g.y });
        g.state = 'return';
        g.path = null;
        const fx = (cell % level.w) + 0.5;
        const fy = ((cell / level.w) | 0) + 0.5;
        this.orderTarget = { guard: this.selectedGuard, x: fx, y: fy };
        this.d.view.showOrder(fx, fy);
        this.signals.emit('sim', { kind: 'guardOrdered', guard: g.id });
        this.selectedGuard = -1;
        this.chiefActed = true;
        this.d.audio.play('confirm');
        void this.replanLiveThieves();
      } else {
        this.d.audio.play('deny');
        this.d.overlay.toast(t('round2.nothingThere'), 1200);
      }
      return;
    }

    // Nothing under the cursor and nobody picked up: say so rather than
    // swallowing the click, which is what made this feel unresponsive.
    this.d.audio.play('deny');
    this.d.overlay.toast(t('round2.idle'), 1400);
  }

  /**
   * An agent stopped at a door the chief locked keeps asking for a new route;
   * after long enough with no way through, it abandons the job and leaves.
   */
  private tendBlockedThieves(): void {
    const rules = this.d.level.json.rules;
    // Wave A never replans, so a shut door is the end of his route, not a wait
    // for a new one. Hold him at it long enough to read, then give up on him.
    const patience = this.state === 'round2a' ? rules.tickHz * 3 : rules.tickHz * 9;
    let anyBlocked = false;
    for (const t of this.world.thieves) {
      if (!t.active || t.blockedByDoor < 0) continue;
      if (t.blockedTicks > patience) {
        this.world.abandonThief(t, 'blocked');
        this.d.view.releaseThief(t.id);
        continue;
      }
      anyBlocked = true;
    }
    if (
      anyBlocked &&
      !this.replanInFlight &&
      this.world.tick - this.lastReplanTick > rules.tickHz * 1.5
    ) {
      void this.replanLiveThieves();
    }
  }

  /**
   * The visitor changed the building, so every plan in flight is stale. This is
   * the moment the station is really about: the AI simply thinks again.
   */
  private async replanLiveThieves(): Promise<void> {
    // The human thief does not replan. That is the whole contrast with the
    // swarm: move a guard and he walks into it, because his plan is already
    // out of date. Do the same to the AI and it simply picks another way.
    if (this.state === 'round2a') return;
    const live = this.world.thieves.filter((x) => x.active && !x.breached && !x.caught && !x.hidden);
    if (!live.length) return;
    this.replanningUntil = performance.now() + 1200;
    const level = this.d.level;
    const requests = live.map((thief, i) => {
      const base = thief.plan?.request;
      return {
        agentId: i,
        seed: (base?.seed ?? i * 7919) >>> 0,
        entryId: base?.entryId ?? level.json.entries[0].id,
        startPlanCell: planCellOfThief(level, thief),
        keyStrategy: base?.keyStrategy ?? { kind: 'lockpick' as const },
        startDelayQ: 0,
        moveQuanta: base?.moveQuanta ?? 1,
        personality: base?.personality ?? {
          heatLambda: 0.2,
          noiseEps: 0.2,
          waitBias: 0.05,
          margin: 0 as const,
        },
      };
    });
    this.replanInFlight = true;
    const job = this.d.planner.plan({
      nowTick: this.world.tick + 4,
      doorLocked: this.world.doorLocked,
      guardPrograms: this.plannerPrograms(),
      alarmWindows: this.world.alarmWindows,
      keycardCells: this.keycardCells(),
      requests,
      budgetMs: 2500,
    });
    const { plans, cancelled } = await job.promise;
    this.replanInFlight = false;
    if (cancelled) return;
    this.replanCount++;
    this.lastReplanTick = this.world.tick;
    for (const plan of plans) {
      const thief = live[plan.agentId];
      if (thief && thief.active && !thief.caught && !thief.breached) {
        this.world.retargetThief(thief, plan);
      }
    }
    if (this.state === 'round2b') {
      // Fresh routes replace the old ribbons; a genuinely new way joins the list.
      const byWay = new Map<string, Plan>();
      for (const p of plans) {
        const sig = coarseSignature(p.signature);
        if (!byWay.has(sig)) byWay.set(sig, p);
      }
      for (const w of this.ways) {
        const p = byWay.get(w.sig);
        if (p) w.plan = p;
      }
      for (const [sig, p] of byWay) {
        if (!this.ways.some((w) => w.sig === sig)) this.ways.push(this.describeWay(p, plans));
      }
      for (const p of plans) {
        const wi = this.ways.findIndex((w) => w.sig === coarseSignature(p.signature));
        const thief = live[p.agentId];
        if (wi >= 0 && thief) this.wayOf.set(thief.id, wi);
      }
      this.d.view.ribbons.build(this.d.level, this.ways.map((w) => ({ plan: w.plan, color: w.color })));
      this.d.view.ribbons.reveal(this.ways.length);
      this.d.view.ribbons.setOpacity(0.3);
      this.refreshWays();
    }
  }

  // --------------------------------------------------------------- results

  private setupResults(): void {
    const { overlay, director, view, level } = this.d;
    overlay.show('results');
    director.moveTo('wide', 1.6);
    // A slow orbit behind the verdict: the city keeps turning, the numbers do not.
    director.setOrbit(1.8);
    view.setConesVisible(false);
    const r1 = this.session.round1;
    const r2 = this.session.round2;
    const ai = this.session.ai;

    const entry = {
      codename: this.session.codename,
      heldMs: this.session.chiefScoreMs,
      breaches: r2.breaches,
      caught: r2.caughtCount,
      at: Date.now(),
    };
    const board = this.adminAssisted ? loadBoard() : submit(entry).board;
    overlay.setWanted(board);

    const youWays = r1.breached ? 1 : 0;
    const lines = [
      ...level.json.entries.map((e) => t(e.analogyKey)),
      t(level.json.vault.analogyKey),
      t('analogy.vaultDoor'),
      ...level.json.keycards.filter((k) => k.analogyKey).map((k) => t(k.analogyKey!)),
      ...(level.json.shiftChange ? [t(level.json.shiftChange.analogyKey)] : []),
    ];
    overlay.results({
      codename: this.session.codename,
      youWays,
      youSub: r1.breached ? t('results.youTime', { t: formatClock(r1.timeMs) }) : t('results.youNone'),
      aiWays: ai.distinct,
      // Two lines on purpose: the half second is thinking, not doing, and the
      // part that actually matters is that it then ran them all together.
      aiSub: t('results.aiTime', { t: formatClock(ai.planMs) }),
      aiSub2: t('results.aiAtOnce', { n: ai.distinct }),
      ratio:
        r1.breached && ai.distinct > 0
          ? t('results.ratio', {
              n: ai.distinct,
              m: Math.max(1, Math.round(r1.timeMs / Math.max(1, ai.planMs))),
            })
          : '',
      onLand: () => {
        director.shake(1.2);
        this.d.audio.play('breach');
      },
      held: t('results.held', { t: formatClock(r2.heldMs) }) + ' · ' + t('results.breaches', { n: r2.breaches }),
      lines,
    });
    // Bella Ciao lands on the comparison: the heist worked, and not for you.
    this.d.audio.requestMusic(MUSIC_ANTHEM);
  }

  // ------------------------------------------------------------- presenter

  togglePresenter(): void {
    if (this.state === 'presenter') {
      this.enter(this.presenterReturn);
    } else {
      this.presenterReturn = 'attract';
      this.presenterGuard = -1;
      this.enter('presenter');
      this.onPresenterOpen?.();
    }
  }

  // ------------------------------------------------------------------ loop

  private showBanner(text: string, ms: number): void {
    this.banner = { text, until: performance.now() + ms };
  }

  private activeBanner(): string | null {
    if (!this.banner) return null;
    if (performance.now() > this.banner.until) {
      this.banner = null;
      return null;
    }
    return this.banner.text;
  }

  tickSim(): void {
    if (this.paused || this.hitStopMs > 0) return;
    this.world.step();
    for (const e of this.world.drainEvents()) {
      this.signals.emit('sim', e);
      this.missions.note(e);
      this.d.view.handleEvent(e, this.d.director);
      switch (e.kind) {
        case 'breach':
          this.d.audio.play('breach');
          if (this.state === 'round2a') this.session.round2.waveA = 'breached';
          if (this.state === 'round2a' || this.state === 'round2b') {
            this.session.round2.breaches++;
            if (this.session.round2.firstBreachMs === null && this.state === 'round2b') {
              this.session.round2.firstBreachMs = this.waveBStarted;
            }
          }
          break;
        case 'caught':
          this.d.audio.play('caught');
          if (this.state === 'round2a') this.session.round2.waveA = 'caught';
          if (this.state === 'round2a' || this.state === 'round2b') this.session.round2.caughtCount++;
          if (this.state === 'round1') {
            this.showBanner(t('round1.caught'), 2400);
            this.hitStopMs = 380;
            this.d.director.shake(0.8);
            this.d.overlay.fade(true);
            window.setTimeout(() => this.d.overlay.fade(false), 420);
          }
          break;
        case 'spotted':
          this.d.audio.play('spotted');
          if (this.state === 'round1') this.d.director.shake(0.3);
          break;
        case 'powerCut':
          this.d.audio.play('power');
          this.d.director.shake(0.5);
          this.d.view.flashDark();
          if (this.state === 'round2b') this.showBanner(t('round2.powerCut'), 2600);
          else if (this.state === 'round2a') this.showBanner(t('round2.powerCutA'), 2600);
          else if (this.state === 'round1') {
            this.showCue({ key: 'got-power', icon: '\u{26A1}', title: t('cue.powerOut'), hint: t('cue.powerOutHint') });
          }
          break;
        case 'disguised':
          this.d.audio.play('confirm');
          break;
        case 'thiefDone': {
          if (e.reason === 'blocked' && this.state === 'round2a') {
            this.session.round2.waveA = 'held';
          }
          const wi = this.wayOf.get(e.thief);
          if (wi !== undefined && this.state === 'round2b') {
            const w = this.ways[wi];
            w.done++;
            if (e.reason === 'breach') w.state = 'breached';
            else if (w.done >= w.total && w.state === 'open') w.state = 'held';
            this.refreshWays();
          }
          break;
        }
        case 'alarm':
          this.d.audio.play('alarm');
          break;
        case 'lockpickEnd':
          this.d.audio.play('unlock');
          break;
        case 'badged':
          this.d.audio.play('unlock');
          this.d.audio.play('confirm');
          break;
        case 'pickHit':
          this.d.audio.play('lockpick');
          break;
        case 'pickMiss':
          this.d.audio.play('deny');
          break;
        case 'wireStart':
          this.d.audio.play('confirm');
          break;
        case 'wireCut':
          this.d.audio.play('snip');
          this.d.director.shake(0.12);
          break;
        case 'wireShort':
          this.d.audio.play('zap');
          this.d.director.shake(0.45);
          break;
        case 'truckBoard':
          this.d.audio.play('whoosh');
          break;
        case 'truckLeave':
          this.d.audio.play(e.inside ? 'confirm' : 'blip');
          if (e.inside) this.showBanner(t('round1.truckArrived'), 2200);
          break;
        case 'lockpickStart':
          this.d.audio.play('lockpick');
          break;
        case 'printStart':
          this.d.audio.play('printer');
          break;
        case 'pickup': {
          this.d.audio.play('confirm');
          this.d.view.markKeycard(this.world);
          const def = this.d.level.json.keycards.find((k) => k.id === e.key);
          const kind = def?.kind ?? 'card';
          if (kind === 'uniform') {
            this.showCue({ key: 'got-uniform', icon: '\u{1F455}', title: t('cue.gotUniform'), hint: t('cue.gotUniformHint') });
          } else if (kind === 'card') {
            this.showCue({ key: 'got-card', icon: '\u{1F511}', title: t('cue.gotCard'), hint: t('cue.gotCardHint') });
          }
          break;
        }
        case 'drillStart':
          this.d.audio.play('lockpick');
          break;
        case 'drillJam':
          // The same noise the fuse box makes when it shorts, for the same
          // reason: somebody heard it and is on the way.
          this.d.audio.play('zap');
          this.d.director.shake(0.5);
          break;
        case 'holeOpen':
          this.d.audio.play('breach');
          this.d.director.shake(1.0);
          this.showCue({ key: 'hole-open', icon: '\u{1F573}', title: t('cue.holeOpen'), hint: t('cue.holeOpenHint') }, 3200);
          break;
        case 'vanArrived':
          this.d.audio.play('whoosh');
          this.showCue({ key: 'van-here', icon: '\u{1F690}', title: t('cue.vanHere'), hint: t('cue.vanHereHint') }, 2600);
          break;
        case 'loadTaken':
          this.d.audio.play('printer');
          break;
        case 'loadDelivered':
          this.d.audio.play('confirm');
          break;
        case 'exfilDone':
          this.d.audio.play('breach');
          this.d.director.shake(1.2);
          break;
        default:
          break;
      }
    }
    const alarmNow = this.world.alarmActive;
    if (alarmNow !== this.lastAlarmState) {
      this.d.audio.setAlarm(alarmNow);
      this.lastAlarmState = alarmNow;
    }
  }

  /** Jump straight to whatever comes next; used by the menu and the presenter. */
  skipStage(): void {
    const order: State[] = [
      'attract', 'brief1', 'round1', 'r1result', 'brief2', 'round2a', 'aiThink', 'round2b', 'results',
    ];
    const i = order.indexOf(this.state);
    this.enter(i < 0 || i === order.length - 1 ? 'attract' : order[i + 1]);
  }

  restart(): void {
    this.enter('attract');
  }

  /** Operator actions use the same setup paths as ordinary play. */
  adminAction(action: 'skip' | 'resetStage' | 'restart' | 'startRound1'): void {
    this.adminAssisted = true;
    if (action === 'skip' && this.state === 'aiThink' && !this.swarmPlans.length) {
      this.adminStartSwarm = true;
      return;
    }
    if (action === 'skip') { this.skipStage(); return; }
    this.d.planner.cancel();
    this.hitStopMs = 0;
    if (action === 'restart' || action === 'startRound1') this.restart();
    if (action === 'startRound1') this.enter('round1');
    else if (action === 'resetStage') {
      if (this.state === 'round1') this.session.reset(this.session.codename);
      if (this.state === 'round2a' || this.state === 'round2b') this.session.round2 = new Session().round2;
      if (this.state === 'round2b') {
        this.resetWorldForPlay();
        this.enter('aiThink');
        this.adminStartSwarm = true;
        return;
      }
      this.enter(this.state);
    }
  }

  setAdminOption(option: 'catches' | 'timers' | 'uniform' | 'power' | 'missions' | 'guided', enabled: boolean): void {
    if (option === 'guided') { this.guided = enabled; return; }
    if (option === 'missions') {
      this.missionsVisible = enabled;
      this.d.overlay.setMissionsVisible(enabled);
      return;
    }
    this.adminAssisted = true;
    if (option === 'catches') this.world.catchesEnabled = enabled;
    if (option === 'timers') { this.timersEnabled = enabled; this.idleMs = 0; }
    if (option === 'uniform') { this.world.setPlayerUniform(enabled); this.d.view.markKeycard(this.world); }
    if (option === 'power') this.world.setPowerEnabled(enabled);
  }

  get adminStatus() {
    return {
      stage: this.state, elapsedMs: this.stateMs, paused: this.paused,
      catches: this.world.catchesEnabled, timers: this.timersEnabled,
      missions: this.missionsVisible, guided: this.guided,
      uniform: !!this.world.player && this.world.isDisguised(this.world.player),
      power: !this.world.camerasDown, hasPlayer: !!this.world.player,
      assisted: this.adminAssisted, waitingForSwarm: this.adminStartSwarm,
    };
  }

  update(dtMs: number): void {
    const { input, overlay, view, director } = this.d;
    if (this.paused) {
      // Keep the scene alive behind the menu, but freeze the visit itself.
      overlay.setCursor(input.state.pointer.x, input.state.pointer.y, false);
      view.sync(this.world, 0, { selectedGuard: -1, showCones: this.state !== 'attract' });
      director.update(dtMs / 1000);
      return;
    }
    this.hitStopMs = Math.max(0, this.hitStopMs - dtMs);
    if (this.timersEnabled) this.stateMs += dtMs;
    this.idleMs = this.timersEnabled && input.idle ? this.idleMs + dtMs : 0;

    const s = input.state;
    overlay.setCursor(
      s.pointer.x,
      s.pointer.y,
      this.state === 'round1' || this.state === 'round2a' || this.state === 'round2b',
    );

    switch (this.state) {
      case 'attract':
        this.updateAttract(dtMs);
        if (s.start.pressed) {
          this.d.audio.unlock();
          this.d.audio.resume();
          this.d.audio.requestMusic(MUSIC_THEME);
          this.enter('brief1');
        }
        break;
      case 'brief1':
        if (this.stateMs > TIMERS.intro1 || ((!this.timersEnabled || this.stateMs > 900) && s.start.pressed)) {
          this.enter('round1');
        }
        break;
      case 'round1':
        this.updateRound1(dtMs);
        break;
      case 'r1result':
        overlay.hud1({
          missions: this.missions.phases,
          cue: null,
          wire: null,
          drill: null,
          loads:
            this.world.exfil && this.session.round1.breached
              ? {
                  label: t('round1.loads'),
                  out: this.session.round1.loadsOut,
                  of: this.world.loadsNeeded,
                }
              : null,
          timeMs: this.session.round1.timeMs,
          caught: this.session.round1.caught,
          codename: this.session.codename,
          goal: t('round1.goal'),
          banner: this.activeBanner(),
          progress: null,
          pick: null,
          prompt: '',
        });
        if (this.stateMs > TIMERS.round1Result) this.enter('brief2');
        break;
      case 'brief2':
        if (this.stateMs > TIMERS.intro2 || ((!this.timersEnabled || this.stateMs > 900) && s.start.pressed)) {
          this.enter('round2a');
        }
        break;
      case 'aiThink':
        this.updateAiThink();
        if (this.stateMs > this.thinkDurationMs && this.swarmPlans.length) this.enter('round2b');
        else if (this.stateMs > TIMERS.aiThink + 6000) this.enter('round2b');
        break;
      case 'round2a': {
        this.updateRound2(dtMs, 'a');
        // One nudge if the visitor has not touched anything: doing nothing loses.
        if (
          !this.chiefActed &&
          !this.waveAHinted &&
          this.stateMs > 5200 &&
          this.session.round2.waveA === 'pending'
        ) {
          this.waveAHinted = true;
          this.showBanner(t('round2.hintA'), 3200);
        }
        // Nobody could be sent: there is no verdict to claim, so move along.
        if (this.waveANoWalker && this.session.round2.waveA === 'pending') {
          this.enter('aiThink');
          break;
        }
        const settled =
          this.session.round2.waveA !== 'pending' || this.stateMs > TIMERS.round2ACap;
        if (settled) {
          if (this.session.round2.waveA === 'pending') this.session.round2.waveA = 'timeout';
          if (this.waveAResultMs === 0) {
            this.waveAResultMs = 1;
            // The verdict gets its own beat; jumping straight to the AI read as a bug.
            // It also has to be the truth: he was caught, or he was shut out, or
            // he ran out of time, and the banner used to call all three a catch.
            const outcome = this.session.round2.waveA;
            const lost = outcome === 'breached';
            this.showBanner(
              lost
                ? t('round2.resultA.lose')
                : outcome === 'caught'
                  ? t('round2.resultA.win')
                  : t('round2.resultA.held'),
              TIMERS.round2AResult,
            );
            this.d.audio.play(lost ? 'breach' : 'confirm');
            this.d.director.shake(lost ? 0.6 : 0.25);
          }
          if (this.timersEnabled) this.waveAResultMs += dtMs;
          if (this.waveAResultMs > TIMERS.round2AResult) this.enter('aiThink');
        }
        break;
      }
      case 'round2b': {
        this.updateRound2(dtMs, 'b');
        const allDone =
          this.swarmPlans.length > 0 &&
          !this.pendingSpawn.length &&
          this.world.thieves.length > 0 &&
          this.world.thieves.every((x) => !x.active || x.caught || x.breached);
        if (this.stateMs > TIMERS.round2BCap || allDone) this.enter('results');
        break;
      }
      case 'results':
        if (this.stateMs > TIMERS.resultsAuto || (this.stateMs > 4200 && s.start.pressed)) {
          this.enter('attract');
        }
        break;
      case 'presenter':
        break;
    }

    // Idle watchdog: never leave a half-played session on the screen.
    const idleLimit = this.state === 'results' ? TIMERS.idleResults : TIMERS.idleGameplay;
    if (this.state !== 'attract' && this.state !== 'presenter' && this.idleMs > idleLimit) {
      this.enter('attract');
    }

    const chiefRound = this.state === 'round2a' || this.state === 'round2b';
    view.sync(this.world, dtMs / 1000, {
      interactive: chiefRound,
      hoverGuard: chiefRound ? this.hoverGuard : -1,
      hoverDoor: chiefRound ? this.hoverDoor : -1,
      selectedGuard:
        this.state === 'presenter'
          ? this.presenterGuard
          : this.state === 'round2a' || this.state === 'round2b'
            ? this.selectedGuard
            : -1,
      showCones: this.state !== 'attract' && this.state !== 'results',
    });
    director.update(dtMs / 1000);
    void saveConfig;
    void TICK_MS;
    void cellOf;
  }
}

function planCellOfThief(level: Level, thief: Thief): number {
  const px = Math.min(level.pw - 1, Math.max(0, Math.floor(thief.x / level.stride)));
  const py = Math.min(level.ph - 1, Math.max(0, Math.floor(thief.y / level.stride)));
  let cell = py * level.pw + px;
  if (level.pwalk[cell]) return cell;
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= level.pw || ny >= level.ph) continue;
        cell = ny * level.pw + nx;
        if (level.pwalk[cell]) return cell;
      }
    }
  }
  return py * level.pw + px;
}
