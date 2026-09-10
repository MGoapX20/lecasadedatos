import { Rng } from '../core/rng';
import { simplifyPath, staticAStar } from '../level/grid';
import { cellOf, computeOpaqueWithDoors, fineToPlan, type Level, type RuntimePortal } from '../level/loader';
import type { Plan } from '../planner/types';
import type { CellXY } from '../level/schema';
import type { SimEvent } from './events';
import { blankPose, compileGuardProgram, poseAt, type PatrolProgram, type Pose } from './patrol';
import { samplePlan } from './planFollow';
import { DEFAULT_PICK, LockpickGame, type PickResult } from './lockpick';
import { WireCutGame } from './wirecut';
import { blankTruckPose, truckIsOpen, truckPoseAt, type TruckPose } from './truck';
import { DrillGame } from './drill';
import { holeCells, vanPoseAt, type ExfilDef, type VanPose } from './exfil';
import { cameraFacingAt, seesPoint } from './vision';

export type GuardState = 'patrol' | 'suspicious' | 'chase' | 'return';

export interface Guard {
  id: string;
  index: number;
  program: PatrolProgram;
  state: GuardState;
  x: number;
  y: number;
  facing: number;
  present: boolean;
  fovDeg: number;
  rangeCells: number;
  suspicion: number;
  lostTimer: number;
  lastSeenX: number;
  lastSeenY: number;
  targetThief: number;
  path: number[] | null;
  pathIdx: number;
  repathIn: number;
  chaseSpeed: number;
}

export type ThiefKind = 'player' | 'plan';

export interface Thief {
  id: number;
  kind: ThiefKind;
  codename: string;
  colorSeed: number;
  x: number;
  y: number;
  facing: number;
  active: boolean;
  hidden: boolean;
  caught: boolean;
  breached: boolean;
  /**
   * Out of the round for good. Reaching the vault retires a plan follower, but
   * not the player: for him the vault is where getting the money out begins,
   * and a guard can still take him with it in his arms.
   */
  retired: boolean;
  /** Carrying a load of money to the van. */
  carrying: boolean;
  /** How far along the way out this thief is; -1 until he has the money. */
  exfilIdx: number;
  keys: Set<string>;
  caughtCount: number;
  /** Player only. */
  moveX: number;
  moveY: number;
  routeCells: number[] | null;
  routeIdx: number;
  lockpickDoor: number;
  lockpickTicks: number;
  lockpickNeed: number;
  printTicks: number;
  portalTicks: number;
  portalRef: RuntimePortal | null;
  respawnIn: number;
  /** Ticks during which nothing can see this thief: a fair start, not a cheat. */
  graceTicks: number;
  entryId: string;
  /** Plan followers only. */
  plan: Plan | null;
  planStartTick: number;
  /** Plan clock speed. 1 = as planned, 0.8 = a person walking the same route. */
  planRate: number;
  /** Highest plan quantum whose actions have already fired. */
  firedThroughQ: number;
  nodeIdx: number;
  blockedByDoor: number;
  blockedTicks: number;
  /** True while a plan follower is holding position on purpose. */
  waiting: boolean;
  /** Doors this thief has already picked open for itself. */
  pickedDoors: Set<number>;
  /** Locked doors this thief has already opened with a card. */
  badgedDoors: Set<number>;
  visitedFine: number[];
  speed: number;
}

export interface ChiefState {
  locksLeft: number;
  alarmReadyAtTick: number;
  selectedGuard: number;
}

const CATCH_RADIUS = 1.2; // fine cells
const PLAYER_RADIUS = 0.7;
const SUSPICION_TO_CHASE = 8; // ticks in sight
/** A stolen uniform: guards only recognise the thief this close. Must match the planner. */
export const DISGUISE_RANGE_MUL = 0.3;
/** Cutting the fuse box blinds the cameras for this long: effectively the round. */
const POWER_CUT_TICKS = 1200;
const SUSPICIOUS_HOLD = 30;
const CHASE_LOST = 60;

export class SimWorld {
  readonly level: Level;
  tick = 0;
  guards: Guard[] = [];
  thieves: Thief[] = [];
  doorLocked: Uint8Array;
  doorPickedOpen: Uint8Array;
  keyTaken: Uint8Array;
  /** Cameras are dead until this tick once somebody has pulled the fuse. */
  camerasDownUntil = -1;
  private uniformIds = new Set<string>();
  private fuseIds = new Set<string>();
  alarmUntilTick = -1;
  alarmWindows: { fromTick: number; toTick: number }[] = [];
  events: SimEvent[] = [];
  chief: ChiefState;
  rng: Rng;
  playerId = -1;
  respawnEnabled = true;
  /** The lock the player is working on right now, if any. */
  activePick: LockpickGame | null = null;
  /** The fuse box panel, while the player is stood at it. */
  activeWire: WireCutGame | null = null;
  /** Where the supplier's truck is right now. */
  readonly truck: TruckPose = blankTruckPose();
  /** True while the player is riding in the back of it. */
  playerInTruck = false;
  /** The wall being drilled through, while the player is stood at it. */
  activeDrill: DrillGame | null = null;
  /** The wall is down and the way out is open. */
  holeOpen = false;
  private holeOpenedTick = -1;
  private holeCellSet = new Set<number>();
  /** Where the van is; only meaningful once the hole is open. */
  readonly van: VanPose = { x: 0, y: 0, facing: 0, parked: false };
  /** Loads of money that have reached the van. */
  loadsOut = 0;
  /** Every load is out: the money has left the building. */
  exfilDone = false;
  /**
   * The walk grid as it stands now. It is the level's, until somebody knocks a
   * hole in the wall and makes a way out that the map never had.
   */
  walkNow: Uint8Array;
  /** The bay gate stands open while the truck is going through it. */
  gateOpenForTruck = false;
  /** Earth wires cut this visit, for the record. */
  shorts = 0;
  private pose: Pose = blankPose();
  private nextThiefId = 0;
  /** Walls plus shut doors; rebuilt whenever a door changes. */
  opaqueNow: Uint8Array;
  private doorShut: Uint8Array;

  constructor(level: Level, seed = 1) {
    this.level = level;
    this.rng = new Rng(seed);
    this.doorLocked = new Uint8Array(level.doors.length);
    this.doorShut = new Uint8Array(level.doors.length);
    this.opaqueNow = new Uint8Array(level.cellCount);
    this.doorPickedOpen = new Uint8Array(level.doors.length);
    this.keyTaken = new Uint8Array(level.json.keycards.length);
    this.walkNow = Uint8Array.from(level.walk);
    if (level.json.exfil) {
      for (const c of holeCells(level.json.exfil as ExfilDef, level.w)) this.holeCellSet.add(c);
    }
    for (const k of level.json.keycards) {
      if (k.kind === 'uniform') this.uniformIds.add(k.id);
      if (k.kind === 'fuse') this.fuseIds.add(k.id);
    }
    level.doors.forEach((d, i) => (this.doorLocked[i] = d.locked ? 1 : 0));
    this.chief = {
      locksLeft: level.json.rules.maxLocks,
      alarmReadyAtTick: 0,
      selectedGuard: -1,
    };
    this.refreshOpacity();
    this.resetGuards();
  }

  /** Recompute sight-blocking after any door change. */
  refreshOpacity(): void {
    for (let i = 0; i < this.doorShut.length; i++) {
      this.doorShut[i] = this.doorLocked[i] && !this.doorPickedOpen[i] ? 1 : 0;
    }
    computeOpaqueWithDoors(this.level, this.doorShut, this.opaqueNow);
    // A hole in the wall is a hole in the sight line too.
    if (this.holeOpen) for (const c of this.holeCellSet) this.opaqueNow[c] = 0;
  }

  resetGuards(): void {
    this.guards = this.level.json.guards.map((g, i) => {
      const program = compileGuardProgram(this.level, g);
      const p = poseAt(program, 0);
      return {
        id: g.id,
        index: i,
        program,
        state: 'patrol' as GuardState,
        x: p.x,
        y: p.y,
        facing: p.facingDeg,
        present: p.present,
        fovDeg: g.vision.fovDeg,
        rangeCells: g.vision.range / this.level.cellSize,
        suspicion: 0,
        lostTimer: 0,
        lastSeenX: 0,
        lastSeenY: 0,
        targetThief: -1,
        path: null,
        pathIdx: 0,
        repathIn: 0,
        chaseSpeed: this.level.json.rules.chaseSpeed / this.level.cellSize / this.level.json.rules.tickHz,
      };
    });
  }

  // ---------------------------------------------------------------- thieves

  private makeThief(kind: ThiefKind, fineCell: number, codename: string, entryId: string): Thief {
    const t: Thief = {
      id: this.nextThiefId++,
      kind,
      codename,
      colorSeed: this.rng.next(),
      x: (fineCell % this.level.w) + 0.5,
      y: ((fineCell / this.level.w) | 0) + 0.5,
      facing: -90,
      active: true,
      hidden: false,
      caught: false,
      breached: false,
      retired: false,
      carrying: false,
      exfilIdx: -1,
      keys: new Set(),
      caughtCount: 0,
      moveX: 0,
      moveY: 0,
      routeCells: null,
      routeIdx: 0,
      lockpickDoor: -1,
      lockpickTicks: 0,
      lockpickNeed: 0,
      printTicks: 0,
      portalTicks: 0,
      portalRef: null,
      respawnIn: 0,
      graceTicks: 0,
      entryId,
      plan: null,
      planStartTick: 0,
      planRate: 1,
      firedThroughQ: -1,
      nodeIdx: 1,
      blockedByDoor: -1,
      blockedTicks: 0,
      waiting: false,
      pickedDoors: new Set(),
      badgedDoors: new Set(),
      visitedFine: [],
      speed: this.level.json.rules.playerSpeed / this.level.cellSize / this.level.json.rules.tickHz,
    };
    this.thieves.push(t);
    return t;
  }

  spawnPlayer(entryId: string, codename: string): Thief {
    const entry = this.level.json.entries.find((e) => e.id === entryId) ?? this.level.json.entries[0];
    const t = this.makeThief('player', cellOf(this.level, entry.spawn), codename, entry.id);
    this.playerId = t.id;
    // Nobody should be spotted before they have touched a key.
    t.graceTicks = 60;
    return t;
  }

  spawnPlanThief(plan: Plan, codename: string): Thief {
    const first = plan.nodes.length ? plan.nodes[0].cell : this.level.vaultPlanCell;
    const fine = this.planCellToFine(first);
    const t = this.makeThief('plan', fine, codename, plan.request.entryId);
    t.plan = plan;
    t.planStartTick = plan.startQ * this.level.json.rules.quantumTicks;
    t.nodeIdx = 1;
    t.firedThroughQ = -1;
    t.hidden = true;
    t.speed = 0;
    return t;
  }

  clearThieves(): void {
    this.playerInTruck = false;
    this.thieves = [];
    this.playerId = -1;
  }

  get player(): Thief | undefined {
    return this.thieves.find((t) => t.id === this.playerId);
  }

  private planCellToFine(p: number): number {
    const px = p % this.level.pw;
    const py = (p / this.level.pw) | 0;
    const fx = px * this.level.stride + (this.level.stride >> 1);
    const fy = py * this.level.stride + (this.level.stride >> 1);
    return fy * this.level.w + fx;
  }

  private planCellCenter(p: number, out: { x: number; y: number }): void {
    const px = p % this.level.pw;
    const py = (p / this.level.pw) | 0;
    out.x = px * this.level.stride + this.level.stride / 2;
    out.y = py * this.level.stride + this.level.stride / 2;
  }

  // ------------------------------------------------------------ passability

  doorOpenFor(doorIdx: number, t: Thief | null): boolean {
    if (doorIdx < 0) return true;
    if (!this.doorLocked[doorIdx]) return true;
    if (this.doorPickedOpen[doorIdx]) return true;
    if (!t) return false;
    if (t.pickedDoors.has(doorIdx)) return true;
    const key = this.level.doors[doorIdx].keyId;
    return !!key && t.keys.has(key);
  }

  passable(fineCell: number, t: Thief | null): boolean {
    if (fineCell < 0 || fineCell >= this.level.cellCount) return false;
    if (!this.walkNow[fineCell]) return false;
    return this.doorOpenFor(this.level.doorAt[fineCell], t);
  }

  // -------------------------------------------------------------- commands

  setPlayerMove(dx: number, dy: number): void {
    const p = this.player;
    if (!p) return;
    p.moveX = dx;
    p.moveY = dy;
    if (dx !== 0 || dy !== 0) p.routeCells = null;
  }

  setPlayerRoute(targetFine: number): void {
    const p = this.player;
    if (!p || p.respawnIn > 0) return;
    const from = this.fineOf(p);
    const blocked = new Uint8Array(this.level.cellCount);
    for (let i = 0; i < this.level.doorAt.length; i++) {
      const d = this.level.doorAt[i];
      if (d >= 0 && !this.doorOpenFor(d, p)) blocked[i] = 1;
    }
    const path = staticAStar(
      this.walkNow,
      this.level.w,
      this.level.h,
      from,
      targetFine,
      this.level.scratch,
      blocked,
    );
    if (!path) return;
    p.routeCells = simplifyPath(path, this.walkNow, this.level.w, this.level.h);
    p.routeIdx = 1;
    p.moveX = 0;
    p.moveY = 0;
  }

  lockDoor(doorIdx: number, locked: boolean, byChief: boolean): boolean {
    const d = this.level.doors[doorIdx];
    if (!d) return false;
    if (byChief) {
      if (!d.lockableByChief) return false;
      if (locked && this.chief.locksLeft <= 0) return false;
      if (locked === !!this.doorLocked[doorIdx]) return false;
      this.chief.locksLeft += locked ? -1 : 1;
      if (locked) this.doorPickedOpen[doorIdx] = 0;
    }
    this.doorLocked[doorIdx] = locked ? 1 : 0;
    this.refreshOpacity();
    this.events.push({ kind: 'doorLocked', door: doorIdx, locked });
    return true;
  }

  triggerAlarm(source: 'camera' | 'chief', x = 0, y = 0): boolean {
    const rules = this.level.json.rules;
    if (source === 'chief' && this.tick < this.chief.alarmReadyAtTick) return false;
    const until = this.tick + rules.alarmBoostSec * rules.tickHz;
    this.alarmUntilTick = Math.max(this.alarmUntilTick, until);
    this.alarmWindows.push({ fromTick: this.tick, toTick: until });
    if (source === 'chief') {
      this.chief.alarmReadyAtTick = this.tick + rules.alarmCooldownSec * rules.tickHz;
    }
    this.events.push({ kind: 'alarm', source, x, y });
    return true;
  }

  get alarmActive(): boolean {
    return this.tick < this.alarmUntilTick;
  }

  // ------------------------------------------------------------------ tick

  step(): void {
    this.tick++;
    this.stepTruck();
    this.stepVan();
    for (const t of this.thieves) {
      if (!t.active) continue;
      if (t.graceTicks > 0 && t.respawnIn === 0) t.graceTicks--;
      if (t.respawnIn > 0) {
        t.respawnIn--;
        if (t.respawnIn === 0) this.events.push({ kind: 'respawn', thief: t.id });
        continue;
      }
      if (t.kind === 'player') this.stepPlayer(t);
      else this.stepPlanThief(t);
    }
    this.stepDrill();
    this.stepGuards();
    this.detect();
    this.stepCameras();
  }

  private fineOf(t: Thief): number {
    const x = Math.min(this.level.w - 1, Math.max(0, Math.floor(t.x)));
    const y = Math.min(this.level.h - 1, Math.max(0, Math.floor(t.y)));
    return y * this.level.w + x;
  }

  // ------------------------------------------------------------ player move

  private stepPlayer(t: Thief): void {
    if (this.playerInTruck) {
      // Along for the ride: out of sight, and put down inside the bay when the
      // shutters go up again. Missing the stop is not a way to be stuck.
      t.x = this.truck.x;
      t.y = this.truck.y;
      t.hidden = true;
      if (this.truck.phase === 'unloading' || this.truck.phase === 'parked') {
        this.leaveTruck(true);
      }
      return;
    }
    if (t.portalTicks > 0) {
      t.portalTicks--;
      t.hidden = true;
      if (t.portalTicks === 0 && t.portalRef) {
        const dest = t.portalRef.toFine;
        t.x = (dest % this.level.w) + 0.5;
        t.y = ((dest / this.level.w) | 0) + 0.5;
        t.hidden = false;
        this.events.push({ kind: 'portalExit', thief: t.id, portal: t.portalRef.def.id });
        t.portalRef = null;
      }
      return;
    }

    let dx = t.moveX;
    let dy = t.moveY;
    if (t.routeCells && t.routeIdx < t.routeCells.length) {
      const target = t.routeCells[t.routeIdx];
      const tx = (target % this.level.w) + 0.5;
      const ty = ((target / this.level.w) | 0) + 0.5;
      const ddx = tx - t.x;
      const ddy = ty - t.y;
      const d = Math.hypot(ddx, ddy);
      if (d < 0.35) {
        t.routeIdx++;
        if (t.routeIdx >= t.routeCells.length) t.routeCells = null;
      } else {
        dx = ddx / d;
        dy = ddy / d;
      }
    } else if (t.routeCells) {
      t.routeCells = null;
    }

    const mag = Math.hypot(dx, dy);
    if (mag > 1e-4) {
      const nx = (dx / mag) * t.speed;
      const ny = (dy / mag) * t.speed;
      this.moveWithCollision(t, nx, ny);
      t.facing = (Math.atan2(ny, nx) * 180) / Math.PI;
      t.lockpickDoor = -1;
      t.lockpickTicks = 0;
    }

    const cell = this.fineOf(t);
    if (t.visitedFine.length === 0 || t.visitedFine[t.visitedFine.length - 1] !== cell) {
      t.visitedFine.push(cell);
    }

    // Stepping onto a locked door you can only open with a card: badge it.
    const doorHere = this.level.doorAt[cell];
    if (
      doorHere >= 0 &&
      this.doorLocked[doorHere] &&
      !this.doorPickedOpen[doorHere] &&
      !t.badgedDoors.has(doorHere) &&
      this.doorOpenFor(doorHere, t)
    ) {
      t.badgedDoors.add(doorHere);
      this.events.push({ kind: 'badged', thief: t.id, door: doorHere });
    }

    // Pick up a keycard by walking over it.
    const k = this.level.keyAt[cell];
    const kKind = k >= 0 ? (this.level.json.keycards[k].kind ?? 'card') : 'card';
    // The fuse box is worked at, not walked over; see the wire panel below.
    if (k >= 0 && !this.keyTaken[k] && kKind !== 'fuse') {
      // Fixtures stay for the next visitor; only the card leaves the desk.
      if (kKind === 'card') this.keyTaken[k] = 1;
      const id = this.level.json.keycards[k].id;
      if (!t.keys.has(id)) {
        t.keys.add(id);
        this.events.push({ kind: 'pickup', thief: t.id, key: id });
        this.applyItem(t, id);
      }
    }

    // Enter a vent or sewer by standing on its mouth.
    const planCell = fineToPlan(this.level, cell);
    const portals = this.level.portalsFrom.get(planCell);
    if (portals && portals.length && mag <= 1e-4) {
      const p = portals[0];
      t.portalTicks = p.quanta * this.level.json.rules.quantumTicks;
      t.portalRef = p;
      t.hidden = true;
      this.events.push({ kind: 'portalEnter', thief: t.id, portal: p.def.id });
      return;
    }

    // Stand still at the fuse box and the wire panel opens. It takes priority
    // over a lock: you cannot pick a door while your hands are in a fuse box.
    if (mag <= 1e-4) {
      const fuse = this.adjacentFuse(t);
      if (fuse >= 0) {
        if (!this.activeWire || this.activeWire.item !== fuse) {
          this.activeWire = new WireCutGame(
            fuse,
            this.rng,
            this.level.json.rules.tickHz,
            Math.round(this.level.json.rules.tickHz * 14),
          );
          this.events.push({ kind: 'wireStart', thief: t.id });
        }
        this.activeWire.step();
        if (this.activeWire.complete) this.finishWire(t);
        this.activePick = null;
        t.lockpickDoor = -1;
        return;
      }
      this.activeWire = null;
      const door = this.adjacentLockedDoor(t);
      if (door >= 0) {
        if (!this.activePick || this.activePick.door !== door) {
          const def = this.level.doors[door];
          const rules = this.level.json.rules;
          const spec = def.pick ?? DEFAULT_PICK;
          // Mercy scales with the lock, so a staff door forgives quickly while
          // the vault makes you stand there long enough to be worth catching.
          const graceTicks = Math.round(rules.tickHz * (6 + spec.pins * 3.5));
          this.activePick = new LockpickGame(door, spec, this.rng, rules.tickHz, graceTicks);
          t.lockpickDoor = door;
          t.lockpickTicks = 0;
          t.lockpickNeed = graceTicks;
          this.events.push({ kind: 'lockpickStart', thief: t.id, door });
        }
        this.activePick.step();
        t.lockpickTicks = this.activePick.elapsedTicks;
        if (this.activePick.complete) this.finishPick(t);
      } else {
        this.activePick = null;
        t.lockpickDoor = -1;
      }
    } else {
      this.activePick = null;
      this.activeWire = null;
    }

    // Print money in the vault.
    const vx = (this.level.vaultFineCell % this.level.w) + 0.5;
    const vy = ((this.level.vaultFineCell / this.level.w) | 0) + 0.5;
    if (Math.hypot(t.x - vx, t.y - vy) < 3.0) {
      if (t.printTicks === 0) this.events.push({ kind: 'printStart', thief: t.id });
      t.printTicks++;
      const need = this.level.json.rules.vaultPrintQuanta * this.level.json.rules.quantumTicks;
      if (t.printTicks >= need && !t.breached) {
        t.breached = true;
        this.events.push({ kind: 'breach', thief: t.id, x: t.x, y: t.y, tick: this.tick });
        // The money is printed; now it has to leave the building. Only a plan
        // follower is finished here, and only because the swarm is measuring
        // ways in, not robberies.
        if (!this.level.json.exfil || t.kind !== 'player') {
          t.retired = true;
          this.events.push({ kind: 'thiefDone', thief: t.id, reason: 'breach' });
        }
      }
    } else if (t.printTicks > 0 && !t.breached) {
      t.printTicks = 0;
    }
  }

  private finishPick(t: Thief): void {
    const g = this.activePick;
    if (!g) return;
    this.doorPickedOpen[g.door] = 1;
    this.refreshOpacity();
    this.events.push({ kind: 'lockpickEnd', thief: t.id, door: g.door });
    this.activePick = null;
    t.lockpickDoor = -1;
    t.lockpickTicks = 0;
  }

  /**
   * The player pressed while working a lock. A miss never fails the lock; it
   * resets the pin and makes a noise, and the noise is the real cost.
   */
  attemptPick(): PickResult | 'none' {
    const g = this.activePick;
    const t = this.player;
    if (!g || !t) return 'none';
    const res = g.attempt();
    if (res === 'miss') {
      this.events.push({ kind: 'pickMiss', door: g.door });
      // The first fumble only turns heads. Keep fumbling and they come over.
      this.makeNoise(t.x, t.y, 12, g.misses > 1);
    } else if (res === 'hit') {
      this.events.push({ kind: 'pickHit', door: g.door, pin: g.pinsSet, of: g.spec.pins });
    } else {
      this.events.push({ kind: 'pickHit', door: g.door, pin: g.spec.pins, of: g.spec.pins });
      this.finishPick(t);
    }
    return res;
  }

  /**
   * Something was heard here. Guards in earshot either look toward it or, when
   * `investigate` is set, break off and walk over.
   */
  makeNoise(x: number, y: number, radiusCells: number, investigate = true): void {
    this.events.push({ kind: 'noise', x, y });
    for (const g of this.guards) {
      if (!g.present || g.state === 'chase') continue;
      if (Math.hypot(g.x - x, g.y - y) > radiusCells) continue;
      g.lastSeenX = x;
      g.lastSeenY = y;
      g.path = null;
      g.repathIn = 0;
      g.lostTimer = 0;
      g.state = investigate ? 'chase' : 'suspicious';
    }
  }

  /** The fuse box within reach, if this thief has not already pulled it. */
  private adjacentFuse(t: Thief): number {
    const cx = Math.floor(t.x);
    const cy = Math.floor(t.y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) continue;
        const k = this.level.keyAt[y * this.level.w + x];
        if (k < 0) continue;
        const def = this.level.json.keycards[k];
        if ((def.kind ?? 'card') !== 'fuse' || t.keys.has(def.id)) continue;
        return k;
      }
    }
    return -1;
  }

  /** The player squeezed the cutters. */
  attemptCut(): 'cut' | 'short' | 'nothing' | 'done' {
    const g = this.activeWire;
    const t = this.player;
    if (!g || !t) return 'nothing';
    const res = g.cut();
    if (res === 'short') {
      this.shorts++;
      // Sparks and a bang: the guards hear a fuse box being butchered.
      this.events.push({ kind: 'wireShort', thief: t.id });
      this.makeNoise(t.x, t.y, 11, g.shorts > 1);
    } else if (res === 'cut' || res === 'done') {
      this.events.push({ kind: 'wireCut', thief: t.id, left: g.liveLeft });
      if (res === 'done') this.finishWire(t);
    }
    return res;
  }

  /** Hand the item over and let `applyItem` kill the cameras. */
  private finishWire(t: Thief): void {
    const g = this.activeWire;
    if (!g) return;
    const def = this.level.json.keycards[g.item];
    this.activeWire = null;
    if (!def || t.keys.has(def.id)) return;
    t.keys.add(def.id);
    this.events.push({ kind: 'pickup', thief: t.id, key: def.id });
    this.applyItem(t, def.id);
  }

  private adjacentLockedDoor(t: Thief): number {
    const cx = Math.floor(t.x);
    const cy = Math.floor(t.y);
    let best = -1;
    let bestD = 2.4;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.level.w || y >= this.level.h) continue;
        const d = this.level.doorAt[y * this.level.w + x];
        if (d < 0 || this.doorOpenFor(d, t)) continue;
        // The vault has no lock to work: without the card there is nothing to try.
        if (this.level.doors[d].pickable === false) continue;
        const dist = Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
    }
    return best;
  }

  private moveWithCollision(t: Thief, dx: number, dy: number): void {
    if (this.freeAt(t, t.x + dx, t.y + dy)) {
      t.x += dx;
      t.y += dy;
      return;
    }
    if (this.freeAt(t, t.x + dx, t.y)) {
      t.x += dx;
      return;
    }
    if (this.freeAt(t, t.x, t.y + dy)) {
      t.y += dy;
    }
  }

  private freeAt(t: Thief, x: number, y: number): boolean {
    const r = PLAYER_RADIUS;
    for (let i = 0; i < 4; i++) {
      const px = x + (i === 0 ? r : i === 1 ? -r : 0);
      const py = y + (i === 2 ? r : i === 3 ? -r : 0);
      const cx = Math.floor(px);
      const cy = Math.floor(py);
      if (cx < 0 || cy < 0 || cx >= this.level.w || cy >= this.level.h) return false;
      if (!this.passable(cy * this.level.w + cx, t)) return false;
    }
    return true;
  }

  // -------------------------------------------------------- plan followers

  private stepPlanThief(t: Thief): void {
    // Past the vault the plan is finished and the money is what matters.
    if (t.exfilIdx >= 0) {
      this.stepExfilWalk(t);
      return;
    }

    const plan = t.plan;
    if (!plan || plan.nodes.length < 2) return;
    const qt = this.level.json.rules.quantumTicks;
    // The plan is a timetable; planRate is how fast this agent reads it.
    const relTicks = (this.tick - t.planStartTick) * t.planRate;
    const qf = relTicks / qt;
    const s = samplePlan(this.level, plan, qf, t.nodeIdx);
    t.nodeIdx = s.nodeIdx;

    if (s.phase === 'pending') {
      t.x = s.x;
      t.y = s.y;
      t.hidden = true;
      return;
    }

    if (s.phase === 'done') {
      t.x = s.x;
      t.y = s.y;
      t.hidden = false;
      if (plan.reachedVault && !t.breached) {
        t.breached = true;
        // The breach is still the moment the vault is reached — that is the
        // number the results screen compares — but it is no longer the end of
        // this agent. He picks the money up and walks it out, the same four
        // phases the visitor had to work through.
        this.events.push({ kind: 'breach', thief: t.id, x: t.x, y: t.y, tick: this.tick });
        this.events.push({ kind: 'thiefDone', thief: t.id, reason: 'breach' });
        // Retired the moment he breaches, even though he keeps walking: the
        // breach is already on the board, and leaving him catchable would pull
        // guards off the agents still trying to get in — which is the contest
        // the round is actually about. The visitor carrying money in round 1 is
        // catchable; that is where the tension belongs.
        t.retired = true;
        if (this.exfil && this.exfilRoute) {
          t.carrying = true;
          t.exfilIdx = 0;
          this.events.push({ kind: 'loadTaken', thief: t.id, out: this.loadsOut });
        }
      } else if (!t.breached) {
        this.events.push({ kind: 'thiefDone', thief: t.id, reason: 'expired' });
        t.active = false;
      }
      return;
    }

    // A door the chief locked after this plan was made stops the agent dead.
    const nodes = plan.nodes;
    const cur = nodes[s.nodeIdx];
    const prev = nodes[s.nodeIdx - 1];
    if (cur.kind === 'move' || cur.kind === 'portal') {
      const di = this.level.pdoorAt[cur.cell];
      const aboutToPick = prev.kind === 'lockpick' && prev.ref === String(di);
      if (di >= 0 && !this.doorOpenFor(di, t) && !aboutToPick) {
        t.blockedByDoor = di;
        t.blockedTicks++;
        t.x = (prev.cell % this.level.pw) * this.level.stride + this.level.stride / 2;
        t.y = ((prev.cell / this.level.pw) | 0) * this.level.stride + this.level.stride / 2;
        t.hidden = false;
        t.planStartTick++; // hold position until a replan arrives
        return;
      }
    }
    t.blockedByDoor = -1;
    t.blockedTicks = 0;
    t.waiting = s.kind === 'wait' || s.kind === 'lockpick' || s.kind === 'print';
    t.x = s.x;
    t.y = s.y;
    t.hidden = s.hidden;
    if (s.kind === 'move') t.facing = s.facing;

    this.firePlanActions(t, plan, relTicks, qt);
  }

  private firePlanActions(t: Thief, plan: Plan, relTicks: number, qt: number): void {
    // A slowed agent lands on the same quantum for several ticks, so fire by
    // range rather than equality and remember how far we have got.
    const q = Math.floor(relTicks / qt);
    if (q <= t.firedThroughQ) return;
    for (const act of plan.actions) {
      if (act.q <= t.firedThroughQ || act.q > q) continue;
      switch (act.kind) {
        case 'pickup':
          t.keys.add(act.id);
          this.events.push({ kind: 'pickup', thief: t.id, key: act.id });
          this.applyItem(t, act.id);
          break;
        case 'lockpickStart':
          this.events.push({ kind: 'lockpickStart', thief: t.id, door: Number(act.id) });
          break;
        case 'lockpickEnd':
          t.pickedDoors.add(Number(act.id));
          this.events.push({ kind: 'lockpickEnd', thief: t.id, door: Number(act.id) });
          break;
        case 'portalStart':
          this.events.push({ kind: 'portalEnter', thief: t.id, portal: act.id });
          break;
        case 'portalEnd':
          this.events.push({ kind: 'portalExit', thief: t.id, portal: act.id });
          break;
        case 'printStart':
          this.events.push({ kind: 'printStart', thief: t.id });
          break;
        case 'printEnd':
          break;
      }
    }
    t.firedThroughQ = q;
  }

  /**
   * Give up on an agent that is going nowhere, and say so. Dropping one quietly
   * left the round with nobody in the building and no verdict to show for it.
   */
  abandonThief(t: Thief, reason: 'blocked' | 'expired'): void {
    if (!t.active) return;
    t.active = false;
    t.blockedByDoor = -1;
    t.blockedTicks = 0;
    this.events.push({ kind: 'thiefDone', thief: t.id, reason });
  }

  /** Swap in a fresh plan without teleporting the agent. */
  retargetThief(t: Thief, plan: Plan): void {
    t.plan = plan;
    t.planStartTick = plan.startQ * this.level.json.rules.quantumTicks;
    t.nodeIdx = 1;
    t.firedThroughQ = -1;
    t.blockedByDoor = -1;
    t.blockedTicks = 0;
  }

  get camerasDown(): boolean {
    return this.tick < this.camerasDownUntil;
  }

  isDisguised(t: Thief): boolean {
    for (const id of this.uniformIds) if (t.keys.has(id)) return true;
    return false;
  }

  /** What picking up an item does beyond opening doors. */
  private applyItem(t: Thief, id: string): void {
    if (this.fuseIds.has(id)) {
      this.camerasDownUntil = this.tick + POWER_CUT_TICKS;
      this.events.push({ kind: 'powerCut', thief: t.id, untilTick: this.camerasDownUntil });
    } else if (this.uniformIds.has(id)) {
      this.events.push({ kind: 'disguised', thief: t.id });
    }
  }

  // -------------------------------------------------------- the supplier

  /** How close the player has to be to climb into the back. */
  private static readonly TRUCK_REACH = 3.2;

  private stepTruck(): void {
    const def = this.level.json.delivery;
    if (!def) return;
    truckPoseAt(def, this.level.json.rules.tickHz, this.tick, this.truck);
    // The gate is shut and unpickable, but it does open for its own lorry.
    const gx = def.gateCell[0] + 0.5;
    const gy = def.gateCell[1] + 0.5;
    this.gateOpenForTruck = Math.hypot(this.truck.x - gx, this.truck.y - gy) < 6;
  }

  /** Is the truck sitting open within reach of this thief? */
  canBoardTruck(t: Thief | null | undefined = this.player): boolean {
    if (!t || !this.level.json.delivery || this.playerInTruck) return false;
    if (t.caught || t.breached || t.respawnIn > 0) return false;
    if (!truckIsOpen(this.truck)) return false;
    return Math.hypot(this.truck.x - t.x, this.truck.y - t.y) <= SimWorld.TRUCK_REACH;
  }

  /** Climb into the back while the shutters are up. */
  boardTruck(): boolean {
    const t = this.player;
    if (!t || !this.canBoardTruck(t)) return false;
    this.playerInTruck = true;
    t.hidden = true;
    t.routeCells = null;
    t.moveX = 0;
    t.moveY = 0;
    this.activeWire = null;
    this.activePick = null;
    this.events.push({ kind: 'truckBoard', thief: t.id });
    return true;
  }

  /** Get out. Only while it is stopped, so nobody steps off at speed. */
  leaveTruck(atDock = false): boolean {
    const t = this.player;
    if (!t || !this.playerInTruck) return false;
    if (!atDock && !truckIsOpen(this.truck)) return false;
    const def = this.level.json.delivery;
    this.playerInTruck = false;
    t.hidden = false;
    if (atDock && def) {
      t.x = def.dockCell[0] + 0.5;
      t.y = def.dockCell[1] + 0.5;
    } else {
      t.x = this.truck.x;
      t.y = this.truck.y;
    }
    this.events.push({ kind: 'truckLeave', thief: t.id, inside: atDock });
    return true;
  }

  // ----------------------------------------------------- getting it out

  /** How close the player has to be to work the wall, or to load the van. */
  private static readonly EXFIL_REACH = 2.2;
  /**
   * And to lift a bundle off a press. Measured from the press's *centre*, which
   * is a long way from where anyone can actually stand: the prop blocks a
   * 2-metre radius, four cells, so the closest a player ever gets is about five
   * and a half. Anything tighter than this and the money can never be picked up
   * at all, which is exactly what happened the first time.
   */
  private static readonly PRESS_REACH = 6.2;

  get exfil(): ExfilDef | null {
    return (this.level.json.exfil as ExfilDef | undefined) ?? null;
  }

  /** How many loads still have to reach the van. */
  get loadsNeeded(): number {
    return this.exfil?.loads ?? 0;
  }

  private near(t: Thief, cell: readonly number[], reach: number): boolean {
    return Math.hypot(cell[0] + 0.5 - t.x, cell[1] + 0.5 - t.y) <= reach;
  }

  /** Standing at the outside wall with the vault already open behind you. */
  atWall(t: Thief | null | undefined = this.player): boolean {
    const def = this.exfil;
    if (!def || !t || this.holeOpen) return false;
    if (!t.breached || t.caught || t.respawnIn > 0 || t.hidden) return false;
    return this.near(t, def.stand, SimWorld.EXFIL_REACH);
  }

  /** The nearest press with money on it, if the player is stood at one. */
  pressInReach(t: Thief | null | undefined = this.player): CellXY | null {
    const def = this.exfil;
    if (!def || !t || !t.breached || t.carrying || t.caught || t.respawnIn > 0) return null;
    if (this.loadsOut + (t.carrying ? 1 : 0) >= def.loads) return null;
    for (const c of def.presses) if (this.near(t, c, SimWorld.PRESS_REACH)) return c;
    return null;
  }

  /** Carrying a load, stood at a van that has actually arrived. */
  atVan(t: Thief | null | undefined = this.player): boolean {
    const def = this.exfil;
    if (!def || !t || !t.carrying || !this.van.parked) return false;
    return this.near(t, def.van, SimWorld.EXFIL_REACH);
  }

  /** Lift a bundle off the press. */
  takeLoad(): boolean {
    const t = this.player;
    if (!t || !this.pressInReach(t)) return false;
    t.carrying = true;
    this.events.push({ kind: 'loadTaken', thief: t.id, out: this.loadsOut });
    return true;
  }

  /** Put it in the van. */
  dropLoad(): boolean {
    const t = this.player;
    const def = this.exfil;
    if (!t || !def || !this.atVan(t)) return false;
    t.carrying = false;
    this.loadsOut++;
    this.events.push({ kind: 'loadDelivered', thief: t.id, out: this.loadsOut, of: def.loads });
    if (this.loadsOut >= def.loads && !this.exfilDone) {
      this.exfilDone = true;
      this.events.push({ kind: 'exfilDone', thief: t.id, tick: this.tick });
    }
    return true;
  }

  /**
   * One tick of the drill, with the trigger either held or not. The panel opens
   * itself the moment the player stands at the wall, the same way the fuse box
   * does, and closes as soon as he walks away from it.
   */
  private stepDrill(): void {
    const t = this.player;
    if (!t || this.holeOpen) {
      this.activeDrill = null;
      return;
    }
    if (!this.atWall(t)) {
      this.activeDrill = null;
      this.drillHeld = false;
      return;
    }
    if (!this.activeDrill) {
      // The hole in the wall is still there when he comes back to it. Being
      // chased off costs time, not the whole job.
      if (!this.wallGame) {
        this.wallGame = new DrillGame();
        this.events.push({ kind: 'drillStart', thief: t.id });
      }
      this.activeDrill = this.wallGame;
    }
    const before = this.activeDrill.jammed;
    const res = this.activeDrill.step(this.drillHeld);
    if (res === 'jam' && !before) {
      // Screaming metal carries. Somebody comes to look.
      this.events.push({ kind: 'drillJam', thief: t.id });
      this.makeNoise(t.x, t.y, 14);
    }
    if (this.activeDrill.complete) this.openHole(t);
  }

  /** The trigger, set by the screen each frame. */
  private drillHeld = false;
  /** The hole, kept between visits to it: progress survives being chased off. */
  private wallGame: DrillGame | null = null;
  /** Progress remains observable after the player steps away from the drill. */
  get exfilChannelProgress(): number { return this.holeOpen ? 1 : this.wallGame?.progress ?? 0; }

  setDrilling(down: boolean): void {
    this.drillHeld = down;
  }

  /** Put the wall back and send the van away: a new visit starts intact. */
  resetExfil(): void {
    this.holeOpen = false;
    this.holeOpenedTick = -1;
    this.activeDrill = null;
    this.wallGame = null;
    this.drillHeld = false;
    this.loadsOut = 0;
    this.exfilDone = false;
    this.van.parked = false;
    for (const c of this.holeCellSet) this.walkNow[c] = this.level.walk[c];
    this.refreshOpacity();
  }

  /**
   * The way out, vault to van, walked by every agent that gets the money. It is
   * one shared path rather than a plan each: the swarm streaming through the
   * same hole in single file is the picture, and the planner's time budget is
   * already spent finding the way *in*.
   */
  get exfilRoute(): number[] | null {
    const def = this.exfil;
    if (!def) return null;
    if (this.routeOut === undefined) {
      const open = Uint8Array.from(this.level.walk);
      for (const c of this.holeCellSet) open[c] = 1;
      const from = cellOf(this.level, this.level.json.vault.cell);
      const to = cellOf(this.level, def.van);
      const path = staticAStar(open, this.level.w, this.level.h, from, to, this.level.scratch);
      this.routeOut = path ? simplifyPath(path, open, this.level.w, this.level.h) : null;
    }
    return this.routeOut;
  }
  private routeOut: number[] | null | undefined = undefined;

  /**
   * An agent that has the money, walking it out. Where the visitor drills, waits
   * for the van and makes three trips, the machine walks the line it already
   * knows and is gone. That contrast is the point of the round.
   */
  private stepExfilWalk(t: Thief): void {
    const route = this.exfilRoute;
    const def = this.exfil;
    if (!route || !def) {
      this.retire(t, 'breach');
      return;
    }
    const speed = (this.level.json.rules.playerSpeed / this.level.json.rules.tickHz) * t.planRate;
    let budget = speed;
    while (budget > 1e-6 && t.exfilIdx < route.length) {
      const c = route[t.exfilIdx];
      const gx = (c % this.level.w) + 0.5;
      const gy = ((c / this.level.w) | 0) + 0.5;
      const dx = gx - t.x;
      const dy = gy - t.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        t.x = gx;
        t.y = gy;
        budget -= d;
        t.exfilIdx++;
      } else {
        t.x += (dx / d) * budget;
        t.y += (dy / d) * budget;
        t.facing = (Math.atan2(dy, dx) * 180) / Math.PI;
        budget = 0;
      }
    }
    // Reaching the wall opens it. No drill: the mini-game is the visitor's
    // problem, and a machine that has already decided is not fumbling with one.
    if (!this.holeOpen && Math.hypot(def.stand[0] + 0.5 - t.x, def.stand[1] + 0.5 - t.y) < 2.5) {
      this.openHole(t);
    }
    if (t.exfilIdx >= route.length) {
      t.carrying = false;
      this.loadsOut++;
      this.events.push({ kind: 'loadDelivered', thief: t.id, out: this.loadsOut, of: def.loads });
      this.retire(t, 'exfil');
    }
  }

  /** Out of the round, for whatever reason. */
  private retire(t: Thief, reason: 'breach' | 'exfil'): void {
    t.retired = true;
    t.active = false;
    t.carrying = false;
    void reason;
  }

  private openHole(t: Thief): void {
    this.holeOpen = true;
    this.holeOpenedTick = this.tick;
    this.activeDrill = null;
    this.wallGame = null;
    this.drillHeld = false;
    for (const c of this.holeCellSet) this.walkNow[c] = 1;
    this.refreshOpacity();
    this.events.push({ kind: 'holeOpen', thief: t.id, tick: this.tick });
  }

  private stepVan(): void {
    const def = this.exfil;
    if (!def || !this.holeOpen) return;
    const was = this.van.parked;
    vanPoseAt(def, this.tick - this.holeOpenedTick, this.van);
    if (this.van.parked && !was) this.events.push({ kind: 'vanArrived', tick: this.tick });
  }

  // ------------------------------------------------------------ guard logic

  private stepGuards(): void {
    for (const g of this.guards) {
      const scheduled = poseAt(g.program, this.tick, this.pose);
      g.present = scheduled.present;
      if (!g.present) {
        g.state = 'patrol';
        g.x = scheduled.x;
        g.y = scheduled.y;
        continue;
      }
      switch (g.state) {
        case 'patrol':
          g.x = scheduled.x;
          g.y = scheduled.y;
          g.facing = scheduled.facingDeg;
          break;
        case 'suspicious':
          // Stop and turn toward whatever caught the eye.
          g.facing = turnToward(
            g.facing,
            (Math.atan2(g.lastSeenY - g.y, g.lastSeenX - g.x) * 180) / Math.PI,
            9,
          );
          if (g.lostTimer > SUSPICIOUS_HOLD) {
            g.state = 'return';
            g.suspicion = 0;
            g.path = null;
          }
          break;
        case 'chase':
          this.driveGuardTo(g, g.lastSeenX, g.lastSeenY, g.chaseSpeed);
          if (g.lostTimer > CHASE_LOST) {
            g.state = 'return';
            g.suspicion = 0;
            g.path = null;
          }
          break;
        case 'return': {
          const dist = Math.hypot(scheduled.x - g.x, scheduled.y - g.y);
          if (dist < 0.8) {
            g.state = 'patrol';
            g.path = null;
          } else {
            this.driveGuardTo(g, scheduled.x, scheduled.y, g.chaseSpeed * 0.85);
          }
          break;
        }
      }
    }
  }

  private driveGuardTo(g: Guard, tx: number, ty: number, speed: number): void {
    if (--g.repathIn <= 0 || !g.path) {
      const from =
        Math.min(this.level.h - 1, Math.max(0, Math.floor(g.y))) * this.level.w +
        Math.min(this.level.w - 1, Math.max(0, Math.floor(g.x)));
      const to =
        Math.min(this.level.h - 1, Math.max(0, Math.floor(ty))) * this.level.w +
        Math.min(this.level.w - 1, Math.max(0, Math.floor(tx)));
      const grid = this.level.walkGuard;
      const path =
        staticAStar(grid, this.level.w, this.level.h, from, to, this.level.scratch) ??
        staticAStar(this.level.walk, this.level.w, this.level.h, from, to, this.level.scratch);
      g.path = path ? simplifyPath(path, grid, this.level.w, this.level.h) : null;
      g.pathIdx = 1;
      g.repathIn = 10;
    }
    let goalX = tx;
    let goalY = ty;
    if (g.path && g.pathIdx < g.path.length) {
      const c = g.path[g.pathIdx];
      goalX = (c % this.level.w) + 0.5;
      goalY = ((c / this.level.w) | 0) + 0.5;
      if (Math.hypot(goalX - g.x, goalY - g.y) < 0.5) g.pathIdx++;
    }
    const dx = goalX - g.x;
    const dy = goalY - g.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-4) {
      const stepLen = Math.min(speed, d);
      g.x += (dx / d) * stepLen;
      g.y += (dy / d) * stepLen;
      g.facing = turnToward(g.facing, (Math.atan2(dy, dx) * 180) / Math.PI, 14);
    }
  }

  // -------------------------------------------------------------- detection

  private detect(): void {
    const mul = this.alarmActive ? this.level.json.rules.alarmVisionMul : 1;
    for (const g of this.guards) {
      if (!g.present) continue;
      let seen: Thief | null = null;
      let seenDist = Infinity;
      for (const t of this.thieves) {
        if (!t.active || t.hidden || t.caught || t.retired || t.respawnIn > 0 || t.graceTicks > 0) continue;
        const reach = g.rangeCells * mul * (this.isDisguised(t) && !this.alarmActive ? DISGUISE_RANGE_MUL : 1);
        if (
          !seesPoint(
            this.opaqueNow,
            this.level.w,
            this.level.h,
            g.x,
            g.y,
            g.facing,
            g.fovDeg,
            reach,
            t.x,
            t.y,
          )
        ) {
          continue;
        }
        const dist = Math.hypot(t.x - g.x, t.y - g.y);
        if (dist < seenDist) {
          seen = t;
          seenDist = dist;
        }
      }

      if (!seen) {
        g.lostTimer++;
        continue;
      }

      g.lastSeenX = seen.x;
      g.lastSeenY = seen.y;
      g.targetThief = seen.id;
      g.lostTimer = 0;
      if (g.state !== 'chase') {
        g.suspicion++;
        const instant = seenDist < 4 || this.alarmActive;
        if (instant || g.suspicion >= SUSPICION_TO_CHASE) {
          this.events.push({ kind: 'spotted', thief: seen.id, guard: g.id });
          g.state = 'chase';
          g.path = null;
          g.repathIn = 0;
        } else if (g.state === 'patrol' || g.state === 'return') {
          g.state = 'suspicious';
          g.path = null;
        }
      }
      if (seenDist < CATCH_RADIUS) this.catchThief(seen, g);
    }
  }

  private stepCameras(): void {
    if (this.camerasDown) return;
    const mul = this.alarmActive ? this.level.json.rules.alarmVisionMul : 1;
    for (const c of this.level.json.cameras) {
      const facing = cameraFacingAt(c.facingDeg, c.sweep, this.tick);
      const cx = c.cell[0] + 0.5;
      const cy = c.cell[1] + 0.5;
      const range = (c.range / this.level.cellSize) * mul;
      for (const t of this.thieves) {
        if (!t.active || t.hidden || t.caught || t.retired || t.respawnIn > 0 || t.graceTicks > 0) continue;
        // A camera sees a uniform, not a thief.
        if (!this.alarmActive && this.isDisguised(t)) continue;
        if (
          seesPoint(this.opaqueNow, this.level.w, this.level.h, cx, cy, facing, c.fovDeg, range, t.x, t.y)
        ) {
          if (!this.alarmActive) this.triggerAlarm('camera', t.x, t.y);
          let nearest: Guard | null = null;
          let nd = Infinity;
          for (const g of this.guards) {
            if (!g.present || g.state === 'chase') continue;
            const d = Math.hypot(g.x - t.x, g.y - t.y);
            if (d < nd) {
              nd = d;
              nearest = g;
            }
          }
          if (nearest) {
            nearest.lastSeenX = t.x;
            nearest.lastSeenY = t.y;
            nearest.state = 'chase';
            nearest.path = null;
            nearest.repathIn = 0;
            nearest.lostTimer = 0;
          }
          break;
        }
      }
    }
  }

  private catchThief(t: Thief, g: Guard): void {
    if (t.caught || t.retired) return;
    t.caughtCount++;
    this.events.push({ kind: 'caught', thief: t.id, guard: g.id, x: t.x, y: t.y });
    if (t.kind === 'player' && this.respawnEnabled) {
      const spot = this.nearestSafeSpot(t);
      t.x = (spot % this.level.w) + 0.5;
      t.y = ((spot / this.level.w) | 0) + 0.5;
      t.respawnIn = 40;
      t.graceTicks = 50;
      t.routeCells = null;
      t.moveX = 0;
      t.moveY = 0;
      t.printTicks = 0;
      // Whatever was in his arms is on the floor of the vault hall now.
      t.carrying = false;
      t.lockpickDoor = -1;
      t.lockpickTicks = 0;
      this.activePick = null;
      t.portalTicks = 0;
      t.portalRef = null;
      t.hidden = false;
      for (const gg of this.guards) {
        gg.state = 'patrol';
        gg.suspicion = 0;
        gg.path = null;
      }
    } else {
      t.caught = true;
      t.active = false;
      this.events.push({ kind: 'thiefDone', thief: t.id, reason: 'caught' });
    }
  }

  /**
   * Getting caught means being thrown out of the building, so only spots
   * outside the perimeter count. Landing in the next room along would make the
   * guards feel like scenery.
   */
  private nearestSafeSpot(t: Thief): number {
    let best = -1;
    let bestD = Infinity;
    for (const s of this.level.json.safeSpots) {
      const c = cellOf(this.level, s);
      if (this.level.indoor[c]) continue;
      const d = Math.hypot((c % this.level.w) + 0.5 - t.x, ((c / this.level.w) | 0) + 0.5 - t.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best >= 0) return best;
    // No outdoor spot in the level: fall back to the entrance this thief used.
    const entry = this.level.json.entries.find((e) => e.id === t.entryId) ?? this.level.json.entries[0];
    return cellOf(this.level, entry.spawn);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

function turnToward(current: number, target: number, maxDeg: number): number {
  let d = ((target - current) % 360 + 540) % 360 - 180;
  if (Math.abs(d) <= maxDeg) return target;
  return current + Math.sign(d) * maxDeg;
}
