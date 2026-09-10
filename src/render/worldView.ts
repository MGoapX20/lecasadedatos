import {
  AdditiveBlending,
  AlwaysStencilFunc,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  KeepStencilOp,
  BackSide,
  BoxGeometry,
  ConeGeometry,
  Box3,
  CircleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { config } from '../config';
import { cellOf, fineXYToWorldX, fineXYToWorldZ, type Level } from '../level/loader';
import { crossingDoorway } from '../level/doorway';
import type { SimEvent } from '../sim/events';
import type { Guard, SimWorld, Thief } from '../sim/world';
import type { GuideTarget } from '../game/walkthrough';
import type { MarkRef } from '../game/missions';
import { cameraFacingAt } from '../sim/vision';
import { buildBuilding, type BuildingView } from './building';
import type { ModelLib } from './models';
import { mat } from './materials';
import { buildCity, type CityView } from './city';
import type { CameraDirector } from './camera';
import {
  MoneyBurst,
  OutlineGlow,
  Pulse,
  RouteTrails,
  VisionCone,
  makeFxGroup,
  makeMarkerRing,
  WayRibbons,
} from './fx';
import { blankCharacterPose, makeGuardBatch, makeThiefBatch, type CharacterBatch } from './characters';
import { PALETTE, THIEF_TINTS, wayColor } from './palette';
import { CanvasTexture, PointLight, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import type { Stage } from './renderer';
import { DISGUISE_RANGE_MUL } from '../sim/world';

interface Anim {
  phase: number;
  lastX: number;
  lastY: number;
  smoothX: number;
  smoothY: number;
}

const DEG = Math.PI / 180;
/** How long a taken card takes to lift away. */
const CARD_EXIT_SECONDS = 0.45;
/** The getaway van, in metres. Bigger than anything parked on the street. */
const VAN_LENGTH = 5.6;
const VAN_WIDTH = 2.1;

/**
 * Turns simulation state into the picture on screen. The simulation never knows
 * this exists, which is what lets the same world run headless in tests.
 */
export class WorldView {
  readonly root = new Group();
  readonly building: BuildingView;
  readonly city: CityView;
  readonly trails = new RouteTrails();
  readonly ribbons = new WayRibbons();
  /** The supplier's truck, driven straight from the simulation's pose. */
  private truck: Object3D | null = null;
  /** The van waiting at the breach, and the bundles stacking up in the back. */
  private van: Object3D | null = null;
  private vanLoads: Object3D[] = [];
  /** The bundle in the thief's arms while he is carrying one. */
  private carried: Object3D | null = null;
  private carryRing: Mesh | null = null;
  private carryBob = 0;
  private holeShown = false;
  readonly money = new MoneyBurst();
  private guideArrows: Group[] = [];
  private guideTime = 0;
  private guideMaterial = new MeshBasicMaterial({ color: 0xffdf00, toneMapped: false, transparent: true, opacity: 1, depthWrite: false, depthTest: true });
  // The unexpanded arrow masks its own interior even when scenery covers it.
  // A larger back-face hull can then draw only the outer silhouette through walls.
  private guideMask = new MeshBasicMaterial({ transparent: true, colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilRef: 2, stencilFunc: AlwaysStencilFunc, stencilZPass: ReplaceStencilOp });
  private guideOutline = new MeshBasicMaterial({ color: 0xffdf00, toneMapped: false, transparent: true,
    side: BackSide, depthWrite: false, depthTest: false, stencilWrite: true, stencilRef: 2,
    stencilFunc: NotEqualStencilFunc, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: KeepStencilOp });
  private guideHead = new ConeGeometry(.42, .65, 4);
  private guideStem = new BoxGeometry(.22, .8, .22);
  guidePosition(index: number) { return this.guideArrows[index]?.position; }
  setGuideTargets(targets: GuideTarget[]): void {
    while (this.guideArrows.length < targets.length) {
      const g = new Group();
      const head = new Mesh(this.guideHead, this.guideMaterial);
      head.rotation.z = Math.PI; head.position.y = .325; head.renderOrder = 102;
      const stem = new Mesh(this.guideStem, this.guideMaterial);
      stem.position.y = 1.0; stem.renderOrder = 102;
      for (const part of [head, stem]) {
        const mask = new Mesh(part.geometry, this.guideMask);
        mask.position.copy(part.position); mask.rotation.copy(part.rotation); mask.renderOrder = 100;
        const rim = new Mesh(part.geometry, this.guideOutline);
        rim.position.copy(part.position); rim.rotation.copy(part.rotation); rim.renderOrder = 101;
        rim.scale.set(part === head ? 1.16 : 1.35, 1.10, part === head ? 1.16 : 1.35);
        g.add(mask, rim);
      }
      g.add(head, stem); this.root.add(g); this.guideArrows.push(g);
    }
    this.guideArrows.forEach((g,i) => {
      const target = targets[i]; g.visible = !!target;
      if (!target) return;
      let height = 1.3;
      const object = target.mark ? this.objectFor(this.level, target.mark) : null;
      if (object) {
        const bounds = new Box3().setFromObject(object);
        if (!bounds.isEmpty()) height = Math.max(height, bounds.max.y + .5);
      }
      g.position.set(fineXYToWorldX(this.level,target.cell[0]+.5),height, fineXYToWorldZ(this.level,target.cell[1]+.5));
    });
  }
  readonly hintPulse = new Pulse(PALETTE.gold);
  /** A glowing outline on whatever the mission board is asking for right now. */
  readonly phaseGlow = new OutlineGlow();
  /** Marks the vault card while it is still there to be taken. */
  readonly cardPulse = new Pulse(PALETTE.gold);
  private cardSpin = 0;
  /** Seconds elapsed on the take-away flourish, per keycard index. */
  private cardExit = new Map<number, number>();
  private thieves: CharacterBatch;
  private guards: CharacterBatch;
  private guardCones: VisionCone[] = [];
  private cameraCones: VisionCone[] = [];
  private fx = makeFxGroup();
  private anims = new Map<number, Anim>();
  private thiefSlots = new Map<number, number>();
  private freeSlots: number[] = [];
  /** A red disc under every thief, so a crowd still reads from across a hall. */
  private thiefMarks: InstancedMesh;
  private markScratch = new Object3D();
  private markHide = new Matrix4().makeScale(0, 0, 0);
  private markColor = new Color();
  private playerRing = makeMarkerRing(PALETTE.gold, 0.52, 0.72);
  private selectRing = makeMarkerRing(0x7fd4ff, 0.6, 0.82);
  /** A ring under every guard, so they read as things you can pick up. */
  private guardRings: Mesh[] = [];
  /** A mark on every door the chief may lock. */
  private doorMarks: Mesh[] = [];
  /** Where a guard has just been sent. */
  readonly orderPulse = new Pulse(0x7fd4ff);
  /** Marks a lone thief in the defending round, so one man in red is not lost in the marble. */
  readonly thiefPulse = new Pulse(PALETTE.redBright);
  /** A warm pool of light that travels with the player. */
  private playerLight = new PointLight(0xffd9a0, 4.5, 9, 1.8);
  /** "?" and "!" over a guard's head, so being noticed is visible before it hurts. */
  private guardGlyphs: Sprite[] = [];
  /** One per camera: shown while the fuse is out, so a dead camera says so. */
  private cameraGlyphs: Sprite[] = [];
  private deadPowerPop = 0;
  private guardGlyphState: string[] = [];
  private guardGlyphPop: number[] = [];
  private glyphSuspicious = glyphTexture('?', '#f0a020');
  private glyphChase = glyphTexture('!', '#e8202c');
  private glyphDeadPower = deadPowerTexture();
  private doorLockedMark = new Map<number, Object3D>();
  private alarmFlash = 0;
  private darkFlash = 0;

  constructor(
    readonly level: Level,
    private readonly stage: Stage,
    readonly models: ModelLib,
    capacity = Math.max(16, config.swarmSize + 4),
  ) {
    this.building = buildBuilding(level, models);
    this.root.add(this.building.root);
    this.city = buildCity(level, models);
    this.root.add(this.city.root);
    const truckTpl = models.props.get('truck');
    if (truckTpl && level.json.delivery) {
      this.truck = truckTpl.clone(true);
      this.root.add(this.truck);
    }
    if (level.json.exfil) this.buildExfil(models, level.json.exfil.loads);
    this.thieves = makeThiefBatch(capacity, models);
    this.guards = makeGuardBatch(Math.max(4, level.json.guards.length), models);
    const markGeo = new CircleGeometry(0.62, 14);
    markGeo.rotateX(-Math.PI / 2);
    this.thiefMarks = new InstancedMesh(
      markGeo,
      new MeshBasicMaterial({
        color: PALETTE.redBright,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      capacity,
    );
    this.thiefMarks.frustumCulled = false;
    this.thiefMarks.renderOrder = 3;
    for (let i = 0; i < capacity; i++) this.thiefMarks.setMatrixAt(i, this.markHide);
    this.root.add(this.thieves.root, this.guards.root, this.thiefMarks, this.fx);
    for (let i = capacity - 1; i >= 0; i--) this.freeSlots.push(i);

    for (let i = 0; i < level.json.guards.length; i++) {
      const c = new VisionCone(PALETTE.gold);
      this.guardCones.push(c);
      this.fx.add(c.mesh);
    }
    for (let i = 0; i < level.json.cameras.length; i++) {
      const c = new VisionCone(0xff7d7d);
      c.setColor(0xff7d7d, 0.22);
      this.cameraCones.push(c);
      this.fx.add(c.mesh);
    }
    for (let i = 0; i < level.json.guards.length; i++) {
      const ring = makeMarkerRing(0xbcd3ff, 0.46, 0.58);
      ring.visible = false;
      this.guardRings.push(ring);
      this.fx.add(ring);
    }
    level.doors.forEach((d, i) => {
      const mark = makeMarkerRing(PALETTE.gold, 0.3, 0.46);
      mark.visible = false;
      mark.position.set(
        fineXYToWorldX(level, d.rect[0] + d.rect[2] / 2),
        0.06,
        fineXYToWorldZ(level, d.rect[1] + d.rect[3] / 2),
      );
      this.doorMarks[i] = mark;
      this.fx.add(mark);
    });
    this.playerLight.position.y = 2.6;
    this.playerLight.visible = false;
    for (let i = 0; i < level.json.guards.length; i++) {
      const sp = new Sprite(new SpriteMaterial({ map: this.glyphChase, transparent: true, depthTest: false }));
      sp.renderOrder = 20;
      sp.visible = false;
      sp.scale.setScalar(1.3);
      this.guardGlyphs.push(sp);
      this.guardGlyphState.push('patrol');
      this.guardGlyphPop.push(0);
      this.fx.add(sp);
    }
    for (const c of level.json.cameras) {
      const sp = new Sprite(
        new SpriteMaterial({ map: this.glyphDeadPower, transparent: true, depthTest: false }),
      );
      sp.renderOrder = 20;
      sp.visible = false;
      sp.scale.setScalar(1.15);
      // Just above the housing, where the sweeping cone used to come from.
      sp.position.set(
        fineXYToWorldX(level, c.cell[0] + 0.5),
        (c.height ?? 3.6) + 0.85,
        fineXYToWorldZ(level, c.cell[1] + 0.5),
      );
      this.cameraGlyphs.push(sp);
      this.fx.add(sp);
    }
    this.fx.add(
      this.playerLight,
      this.thiefPulse.mesh,
      this.orderPulse.mesh,
      this.trails.object,
      this.ribbons.object,
      this.money.mesh,
      this.hintPulse.mesh,
      this.cardPulse.mesh,
      this.playerRing,
      this.selectRing,
    );
    this.playerRing.visible = false;
    this.selectRing.visible = false;
    stage.scene.add(this.root);
  }

  /**
   * The van and the money it is waiting for. The van is an unmarked one, black
   * and lit from inside: it belongs to the thief, not to the building, which is
   * the whole point of the thing it stands for.
   */
  private buildExfil(models: ModelLib, loads: number): void {
    const tpl = models.props.get('suv') ?? models.props.get('car');
    const van = new Group();
    const probe = new Color();
    if (tpl) {
      // The model's length runs along its own z; the rest of the simulation
      // measures facing along x, so turn it a quarter before scaling it.
      const inner = new Group();
      inner.rotation.y = Math.PI / 2;
      inner.add(tpl.clone(true));
      const shell = new Group();
      // 5.6 m long, 2.1 wide: bigger than anything on the street outside.
      shell.scale.set(VAN_LENGTH / 4.8, 1, VAN_WIDTH / 2.4);
      shell.add(inner);
      shell.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const src = m.material as MeshStandardMaterial;
        const cloned = src.clone();
        probe.copy(src.color);
        // Paint the bodywork, leave the glass and the tyres alone: whitening
        // everything turns it into a bar of soap.
        const lum = probe.r * 0.299 + probe.g * 0.587 + probe.b * 0.114;
        if (lum > 0.16) {
          cloned.color = new Color(0xeceae4);
          cloned.roughness = 0.62;
          cloned.metalness = 0.05;
        }
        m.material = cloned;
      });
      van.add(shell);
    }

    // The cargo box over the back half, which is what makes it a van rather
    // than a big car. Local +x is the nose, so the box goes behind it.
    const boxL = 3.1;
    const boxH = 1.75;
    const box = new Mesh(new BoxGeometry(boxL, boxH, VAN_WIDTH), mat('paper'));
    box.position.set(-1.15, boxH / 2 + 0.55, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    van.add(box);
    // Dark shutters down both sides and across the back: a working van.
    for (const z of [-1, 1]) {
      const side = new Mesh(new BoxGeometry(boxL * 0.82, boxH * 0.62, 0.06), mat('marbleDark'));
      side.position.set(-1.15, boxH * 0.58 + 0.55, (z * VAN_WIDTH) / 2 + z * 0.03);
      van.add(side);
    }
    const rear = new Mesh(new BoxGeometry(0.07, boxH * 0.74, VAN_WIDTH * 0.82), mat('marbleDark'));
    rear.position.set(-1.15 - boxL / 2 - 0.03, boxH * 0.55 + 0.55, 0);
    van.add(rear);
    // A lit rack over the cab: at night, from above, this is what finds it.
    const rack = new Mesh(
      new BoxGeometry(0.85, 0.12, 0.3),
      new MeshBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.85 }),
    );
    rack.position.set(1.55, 1.86, 0);
    van.add(rack);
    van.visible = false;
    this.van = van;
    this.root.add(van);

    // The bundles, revealed one at a time as they arrive.
    for (let i = 0; i < loads; i++) {
      const bundle = this.makeBundle(1.15);
      bundle.position.set(-2.3 + (i % 3) * 0.78, 1.62, 0.34 * (i % 2) - 0.17);
      bundle.visible = false;
      van.add(bundle);
      this.vanLoads.push(bundle);
    }
    // What he is carrying, on him: a big bundle held at chest height, a gold
    // glow under it and a ring on the floor. Three signals, because at this
    // camera angle one is easy to miss.
    this.carried = new Group();
    const held = this.makeBundle(1.35);
    const glow = new Mesh(
      new SphereGeometry(0.5, 12, 10),
      new MeshBasicMaterial({
        color: PALETTE.gold,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.carried.add(held, glow);
    this.carried.visible = false;
    this.root.add(this.carried);
    this.carryRing = makeMarkerRing(PALETTE.gold, 0.74, 1.0);
    this.carryRing.visible = false;
    this.root.add(this.carryRing);
  }

  /**
   * One strapped block of notes. Deliberately oversized: from the overhead
   * camera a realistically sized bundle in a man's arms is four pixels, and the
   * one thing the visitor has to be able to see in this phase is who is holding
   * the money.
   */
  private makeBundle(scale = 1): Object3D {
    const g = new Group();
    const paper = new Mesh(new BoxGeometry(0.6 * scale, 0.4 * scale, 0.46 * scale), mat('paper'));
    const band = new Mesh(new BoxGeometry(0.63 * scale, 0.13 * scale, 0.49 * scale), mat('emissiveGold'));
    g.add(paper, band);
    return g;
  }

  setCutaway(cut: boolean): void {
    this.building.setCutaway(cut);
  }

  /** The breach, the van driving up, and the money going into it. */
  private updateExfil(world: SimWorld, level: Level): void {
    if (!level.json.exfil) return;
    if (world.holeOpen !== this.holeShown) {
      this.holeShown = world.holeOpen;
      this.building.setHole(world.holeOpen);
      if (world.holeOpen) {
        // Dust and grit off the wall as it goes.
        const [hx, hy, hw, hh] = level.json.exfil.hole;
        this.money.burst(
          fineXYToWorldX(level, hx + hw / 2),
          1.2,
          fineXYToWorldZ(level, hy + hh / 2),
          26,
        );
      }
    }
    if (this.van) {
      this.van.visible = world.holeOpen;
      this.van.position.set(fineXYToWorldX(level, world.van.x), 0, fineXYToWorldZ(level, world.van.y));
      this.van.rotation.y = -world.van.facing * DEG;
    }
    this.vanLoads.forEach((b, i) => (b.visible = i < world.loadsOut));
    const p = world.player;
    const carrying = !!p && p.carrying && !p.hidden && p.respawnIn === 0;
    if (this.carried && this.carryRing && p) {
      this.carried.visible = carrying;
      this.carryRing.visible = carrying;
      if (carrying) {
        this.carryBob += 0.12;
        const wx = fineXYToWorldX(level, p.x);
        const wz = fineXYToWorldZ(level, p.y);
        // Held out in front, bobbing with the walk so it reads as carried
        // rather than stuck to him.
        this.carried.position.set(
          wx + Math.cos(p.facing * DEG) * 0.46,
          1.16 + Math.sin(this.carryBob) * 0.05,
          wz + Math.sin(p.facing * DEG) * 0.46,
        );
        this.carried.rotation.y = -p.facing * DEG;
        this.carryRing.position.set(wx, 0.06, wz);
      }
    }
  }

  /**
   * Outline the things the current phase is about. The board names what — a
   * door, a portal, an item, the lorry — and this is the only place that knows
   * which object in the scene that is.
   */
  setPhaseMarks(level: Level, marks: MarkRef[]): void {
    const out: Object3D[] = [];
    for (const m of marks) {
      const o = this.objectFor(level, m);
      if (o) out.push(o);
    }
    this.phaseGlow.set(out);
  }

  private objectFor(level: Level, m: MarkRef): Object3D | null {
    switch (m.kind) {
      case 'door': {
        const i = level.doors.findIndex((d) => d.id === m.id);
        if (i < 0) return null;
        // The vault's leaf is hidden in favour of a modelled slab, so the
        // hinge pivot has nothing worth outlining: point at the slab itself.
        if (level.doors[i].kind === 'vault' && this.building.vaultDoor) return this.building.vaultDoor;
        return this.building.doors.get(i) ?? null;
      }
      case 'portal':
        // Both ends of a sewer or a vent are the same way in; the one outside
        // is the one the visitor is looking for.
        return this.building.portalMarks.get(`${m.id}:from`) ?? null;
      case 'key':
        return this.building.keycards.get(m.index)?.root ?? null;
      case 'truck':
        return this.truck;
      case 'van':
        return this.van;
      case 'breachWall':
        return this.building.breachWall;
      case 'press':
        return this.building.namedProps.get(`press:${m.cell[0]},${m.cell[1]}`) ?? null;
      default:
        return null;
    }
  }

  /** Nothing is being asked for: put the building's lights back to normal. */
  clearPhaseMarks(): void {
    this.phaseGlow.clear();
  }

  /** The lights dip for a moment: the power was cut. */
  flashDark(): void {
    this.darkFlash = 1;
  }

  setConesVisible(v: boolean): void {
    for (const c of this.guardCones) c.mesh.visible = v;
    for (const c of this.cameraCones) c.mesh.visible = v;
  }

  private slotFor(t: Thief): number {
    let s = this.thiefSlots.get(t.id);
    if (s === undefined) {
      s = this.freeSlots.pop() ?? -1;
      if (s < 0) return -1;
      this.thiefSlots.set(t.id, s);
    }
    return s;
  }

  releaseThief(id: number): void {
    const s = this.thiefSlots.get(id);
    if (s === undefined) return;
    this.thiefSlots.delete(id);
    this.freeSlots.push(s);
    this.anims.delete(id);
  }

  resetAgents(): void {
    this.thieves.hideAll();
    for (let i = 0; i < this.thieves.capacity; i++) this.thiefMarks.setMatrixAt(i, this.markHide);
    this.thiefMarks.instanceMatrix.needsUpdate = true;
    this.thiefSlots.clear();
    this.anims.clear();
    this.freeSlots = [];
    for (let i = this.thieves.capacity - 1; i >= 0; i--) this.freeSlots.push(i);
  }

  private animFor(id: number, x: number, y: number): Anim {
    let a = this.anims.get(id);
    if (!a) {
      a = { phase: Math.random() * 6.28, lastX: x, lastY: y, smoothX: x, smoothY: y };
      this.anims.set(id, a);
    }
    return a;
  }

  handleEvent(e: SimEvent, director: CameraDirector): void {
    switch (e.kind) {
      case 'breach': {
        const x = fineXYToWorldX(this.level, e.x);
        const z = fineXYToWorldZ(this.level, e.y);
        this.money.burst(x, 1.6, z, 70);
        director.shake(0.5);
        break;
      }
      case 'alarm':
        this.alarmFlash = 1;
        director.shake(0.28);
        break;
      case 'caught':
        director.shake(0.2);
        break;
      default:
        break;
    }
  }

  /** Push one frame of simulation state into the scene graph. */
  sync(
    world: SimWorld,
    dtSec: number,
    opts: {
      selectedGuard?: number;
      showCones?: boolean;
      /** Draw the rings and door marks that say what can be clicked. */
      interactive?: boolean;
      hoverGuard?: number;
      hoverDoor?: number;
    } = {},
  ): void {
    const level = this.level;
    const cs = level.cellSize;

    let playerShown = false;
    let loneCount = 0;
    let loneX = 0;
    let loneZ = 0;
    const fewThieves = world.thieves.filter((x) => x.active && !x.hidden && !x.caught && !x.breached && x.id !== world.playerId).length <= 2;
    for (const t of world.thieves) {
      const slot = this.slotFor(t);
      if (slot < 0) continue;
      const pose = blankCharacterPose();
      const visible = t.active && !t.hidden && t.respawnIn === 0 && !t.caught;
      const a = this.animFor(t.id, t.x, t.y);
      // Light smoothing keeps grid-planned motion from looking mechanical.
      const k = Math.min(1, dtSec * 16);
      a.smoothX += (t.x - a.smoothX) * k;
      a.smoothY += (t.y - a.smoothY) * k;
      const moved = Math.hypot(t.x - a.lastX, t.y - a.lastY);
      a.lastX = t.x;
      a.lastY = t.y;
      a.phase += moved * 2.4;
      pose.visible = visible;
      pose.x = fineXYToWorldX(level, a.smoothX);
      pose.z = fineXYToWorldZ(level, a.smoothY);
      pose.facingRad = t.facing * DEG;
      pose.phase = a.phase;
      pose.moving = Math.min(1, (moved / cs) * 6);
      pose.crouch = t.lockpickDoor >= 0 || t.blockedByDoor >= 0 || t.waiting ? 1 : 0;
      pose.scale = t.id === world.playerId ? 1.5 : 1.28;
      pose.tint = THIEF_TINTS[t.id % THIEF_TINTS.length];
      pose.variant = world.isDisguised(t) ? 1 : 0;
      if (t.id === world.playerId) {
        pose.tint = PALETTE.redBright;
        this.playerRing.visible = visible;
        this.playerRing.position.set(pose.x, 0.05, pose.z);
        // Grace reads as a blink, the same as every game the visitor grew up with.
        this.playerRing.scale.setScalar(t.graceTicks > 0 ? 1 + 0.25 * Math.sin(world.tick * 0.8) : 1);
        this.playerLight.visible = visible;
        this.playerLight.position.set(pose.x, 2.6, pose.z);
        playerShown = true;
      } else if (visible) {
        loneCount++;
        loneX = pose.x;
        loneZ = pose.z;
      }
      this.thieves.setPose(slot, pose);
      if (visible) {
        this.markScratch.position.set(pose.x, 0.07, pose.z);
        this.markScratch.rotation.set(0, 0, 0);
        this.markScratch.scale.setScalar(t.id === world.playerId ? 1.5 : fewThieves ? 1.7 : 1);
        this.markScratch.updateMatrix();
        this.thiefMarks.setMatrixAt(slot, this.markScratch.matrix);
      } else {
        this.thiefMarks.setMatrixAt(slot, this.markHide);
      }
      if (this.thiefMarks.instanceColor) {
        // The disc carries the colour of the way in; the jumpsuit stays red.
        // Except with the money in his arms, when it turns gold: a line of gold
        // dots streaming out through the hole is the whole point of the phase.
        this.thiefMarks.setColorAt(
          slot,
          this.markColor.setHex(
            t.carrying ? PALETTE.gold : t.id === world.playerId ? pose.tint : wayColor(t.entryId),
          ),
        );
      }
    }
    if (!playerShown) {
      this.playerRing.visible = false;
      this.playerLight.visible = false;
    }
    if (loneCount >= 1 && loneCount <= 2) this.thiefPulse.setAt(loneX, loneZ);
    else this.thiefPulse.mesh.visible = false;
    this.thieves.flush();
    this.thiefMarks.instanceMatrix.needsUpdate = true;

    world.guards.forEach((g: Guard, i: number) => {
      const pose = blankCharacterPose();
      const a = this.animFor(-1000 - i, g.x, g.y);
      const moved = Math.hypot(g.x - a.lastX, g.y - a.lastY);
      a.lastX = g.x;
      a.lastY = g.y;
      a.phase += moved * 2.4;
      a.smoothX = g.x;
      a.smoothY = g.y;
      pose.visible = g.present;
      pose.x = fineXYToWorldX(level, g.x);
      pose.z = fineXYToWorldZ(level, g.y);
      pose.facingRad = g.facing * DEG;
      pose.phase = a.phase;
      pose.moving = Math.min(1, (moved / cs) * 6);
      pose.scale = 1.4;
      this.guards.setPose(i, pose);

      const glyph = this.guardGlyphs[i];
      if (glyph) {
        const st = g.state === 'chase' ? 'chase' : g.state === 'suspicious' ? 'suspicious' : 'patrol';
        if (st !== this.guardGlyphState[i]) {
          this.guardGlyphState[i] = st;
          this.guardGlyphPop[i] = 1;
          (glyph.material as SpriteMaterial).map = st === 'chase' ? this.glyphChase : this.glyphSuspicious;
        }
        glyph.visible = g.present && st !== 'patrol' && (opts.showCones ?? true);
        this.guardGlyphPop[i] = Math.max(0, this.guardGlyphPop[i] - dtSec * 4);
        const pop = this.guardGlyphPop[i];
        const size = (st === 'chase' ? 1.6 : 1.3) * (1 + pop * 0.9);
        glyph.scale.setScalar(size);
        glyph.position.set(pose.x, 3.1 + pop * 0.6, pose.z);
      }

      const cone = this.guardCones[i];
      if (cone) {
        cone.mesh.visible = g.present && (opts.showCones ?? true);
        if (cone.mesh.visible) {
          const def = level.json.guards[i];
          const mul = world.alarmActive ? level.json.rules.alarmVisionMul : 1;
          // In a stolen uniform a guard only knows you close up, so the cone
          // shows the range at which he would actually recognise the thief.
          const p = world.player;
          const disguised = !!p && !world.alarmActive && world.isDisguised(p);
          const reach = (def.vision.range / cs) * mul * (disguised ? DISGUISE_RANGE_MUL : 1);
          cone.update(level, world.opaqueNow, g.x, g.y, g.facing, def.vision.fovDeg, reach);
          const hostile = g.state === 'chase';
          const wary = g.state === 'suspicious';
          // Warm amber for people, and a bright edge so the shape reads on a
          // pale marble floor rather than washing into it.
          cone.setColor(
            hostile ? 0xd11b1b : wary ? 0xc47a08 : 0xa8862a,
            hostile ? 0.5 : wary ? 0.44 : 0.34,
            hostile ? 0xff7a7a : wary ? 0xffc463 : 0xffe08a,
            hostile ? 1 : wary ? 0.95 : 0.85,
          );
        }
      }
    });
    this.guards.flush();

    // The badge pops when the power goes and then settles: the moment the fuse
    // comes out is the one the visitor has to notice.
    this.deadPowerPop = world.camerasDown ? Math.max(0, this.deadPowerPop - dtSec * 2.2) : 1;
    level.json.cameras.forEach((c, i) => {
      const glyph = this.cameraGlyphs[i];
      if (glyph) {
        // Only while the power is out, and only when the cones are on show:
        // this belongs to the same channel as the cone it replaces.
        glyph.visible = world.camerasDown && (opts.showCones ?? true);
        const pop = this.deadPowerPop;
        glyph.scale.setScalar(1.15 * (1 + pop * 0.8));
        glyph.position.y = (c.height ?? 3.6) + 0.85 + pop * 0.5;
      }
      const cone = this.cameraCones[i];
      if (!cone) return;
      cone.mesh.visible = (opts.showCones ?? true) && !world.camerasDown;
      const ledOff = this.building.cameraLeds.get(i);
      if (ledOff && world.camerasDown) {
        (ledOff.material as MeshBasicMaterial & { emissiveIntensity?: number }).emissiveIntensity = 0;
      }
      // The beam is the camera saying it is awake, so it lives and dies with
      // the cone: gone when the power is cut, gone when cones are off.
      const beam = this.building.cameraBeams.get(i);
      if (beam) beam.visible = cone.mesh.visible;
      if (!cone.mesh.visible) return;
      // The model, the cone and the detection all read the same angle.
      const facing = cameraFacingAt(c.facingDeg, c.sweep, world.tick);
      const body = this.building.cameras.get(i);
      if (body) body.rotation.y = (-facing * Math.PI) / 180;
      // Re-aim as it sweeps: the beam is trimmed at whatever wall it now meets.
      this.building.aimBeam(i, facing);
      const led = this.building.cameraLeds.get(i);
      if (led) {
        const m = led.material as MeshBasicMaterial & { emissiveIntensity?: number };
        if (m.emissiveIntensity !== undefined) {
          m.emissiveIntensity = world.alarmActive ? 3.2 + Math.sin(world.tick * 0.5) * 1.6 : 1.4;
        }
      }
      const mul = world.alarmActive ? level.json.rules.alarmVisionMul : 1;
      cone.update(level, world.opaqueNow, c.cell[0] + 0.5, c.cell[1] + 0.5, facing, c.fovDeg, (c.range / cs) * mul);
      // Cameras are cool cyan against the guards' amber: a machine watching,
      // not a person, and the one colour nothing else in the building uses.
      // Deep teal fill under a bright edge. The floor is near-white marble, so
      // a pale wash disappears into it; contrast has to come from going darker
      // for the body and brighter for the rim.
      cone.setColor(
        world.alarmActive ? 0x0aa0c8 : 0x0b6f8c,
        world.alarmActive ? 0.42 : 0.34,
        world.alarmActive ? 0x9bf6ff : 0x4fe3ff,
        1,
      );
    });

    if (opts.selectedGuard !== undefined && opts.selectedGuard >= 0) {
      const g = world.guards[opts.selectedGuard];
      this.selectRing.visible = true;
      this.selectRing.position.set(
        fineXYToWorldX(level, g.x),
        0.05,
        fineXYToWorldZ(level, g.y),
      );
    } else {
      this.selectRing.visible = false;
    }

    // Doors: colour by state, swing the vault open on a breach.
    for (const [idx] of this.building.doors) {
      const def = level.doors[idx];
      const shut = world.doorLocked[idx] === 1 && !world.doorPickedOpen[idx];
      // A door is only really shut if nobody standing at it can open it. The
      // card holder, a thief who picked it, and any guard all get it to swing.
      // The bay gate has no lock worth picking, but it does open for the lorry
      // it exists to let in.
      const truckGate = world.gateOpenForTruck && def.id === 'd_dock_outer';
      const locked = shut && !truckGate && !this.someoneCanPass(world, level, idx);

      const leaf = this.building.doorLeaves.get(idx);
      if (leaf) {
        const m = leaf.material as MeshBasicMaterial;
        if (m.color) {
          m.color.setHex(
            def.kind === 'vault'
              ? locked
                ? PALETTE.steelDark
                : PALETTE.steel
              : locked
                ? PALETTE.redDark
                : def.kind === 'gate'
                  ? PALETTE.steel
                  : PALETTE.wood,
          );
        }
      }

      // A shut door is shut. An open one stands aside, so what you see and what
      // you can walk through are the same thing.
      const hinge = this.building.doorHinges.get(idx);
      if (hinge) {
        const goal = locked ? 0 : def.kind === 'vault' ? -Math.PI * 0.5 : -Math.PI * 0.46;
        hinge.rotation.y += (goal - hinge.rotation.y) * Math.min(1, dtSec * 4);
      }
    }

    // The vault handwheel turns only while somebody is working its lock.
    if (this.building.vaultWheel) {
      const workingVault =
        world.activePick !== null && level.doors[world.activePick.door]?.kind === 'vault';
      if (workingVault) this.building.vaultWheel.rotation.z += dtSec * 2.6;
    }

    // Affordances: what is clickable, and what the cursor is currently over.
    const interactive = opts.interactive ?? false;
    world.guards.forEach((g, i) => {
      const ring = this.guardRings[i];
      if (!ring) return;
      ring.visible = interactive && g.present;
      if (!ring.visible) return;
      ring.position.set(fineXYToWorldX(level, g.x), 0.05, fineXYToWorldZ(level, g.y));
      const hot = opts.hoverGuard === i;
      ring.scale.setScalar(hot ? 1.35 : 1);
      const m = ring.material as MeshBasicMaterial;
      m.opacity = hot ? 0.95 : 0.4;
    });
    this.doorMarks.forEach((mark, i) => {
      const def = level.doors[i];
      mark.visible = interactive && def.lockableByChief;
      if (!mark.visible) return;
      const locked = world.doorLocked[i] === 1 && !world.doorPickedOpen[i];
      const hot = opts.hoverDoor === i;
      mark.scale.setScalar(hot ? 1.5 : 1);
      const m = mark.material as MeshBasicMaterial;
      m.color.setHex(locked ? PALETTE.redBright : PALETTE.gold);
      m.opacity = hot ? 0.95 : 0.42;
    });

    // Taken cards lift out of the world rather than blinking off.
    for (const [i, elapsed] of [...this.cardExit]) {
      const view = this.building.keycards.get(i);
      if (!view) {
        this.cardExit.delete(i);
        continue;
      }
      const k = Math.min(1, (elapsed + dtSec) / CARD_EXIT_SECONDS);
      this.cardExit.set(i, elapsed + dtSec);
      const ease = 1 - (1 - k) * (1 - k);
      view.root.position.y = ease * 1.4;
      view.root.scale.setScalar(Math.max(0.001, 1 - ease));
      view.card.rotation.y += dtSec * 16;
      if (k >= 1) {
        view.root.visible = false;
        view.root.position.y = 0;
        view.root.scale.setScalar(1);
        this.cardExit.delete(i);
      }
    }

    // A slowly turning badge reads as a pickup from across the hall.
    this.cardSpin += dtSec * 1.1;
    for (const [i, kv] of this.building.keycards) {
      if (!kv.root.visible || this.cardExit.has(i)) continue;
      if ((level.json.keycards[i]?.kind ?? 'card') !== 'card') continue;
      kv.card.rotation.y = this.cardSpin;
    }
    if (this.truck) {
      this.truck.position.set(
        fineXYToWorldX(level, world.truck.x),
        0,
        fineXYToWorldZ(level, world.truck.y),
      );
      this.truck.rotation.y = -world.truck.facing * DEG;
    }
    this.updateExfil(world, level);
    this.city.update(dtSec);
    this.thieves.update(dtSec);
    this.guards.update(dtSec);
    this.money.update(dtSec);
    this.phaseGlow.update(dtSec);
    this.guideTime += dtSec;
    for (const g of this.guideArrows) { g.rotation.y = this.guideTime * 2; }
    this.hintPulse.hide();
    this.cardPulse.hide();
    for (const kv of this.building.keycards.values()) kv.halo.visible = false;
    this.hintPulse.update(dtSec);
    this.cardPulse.update(dtSec);
    this.orderPulse.update(dtSec);

    if (this.darkFlash > 0) {
      this.darkFlash = Math.max(0, this.darkFlash - dtSec * 1.6);
      const k = 1 - Math.sin(this.darkFlash * Math.PI) * 0.85;
      this.stage.lobbyLight.intensity = this.stage.lobbyLight.intensity * k + 0.001;
      this.stage.vaultLight.intensity = this.stage.vaultLight.intensity * k + 0.001;
      if (this.darkFlash === 0) this.stage.setNight(false);
    }
    if (this.alarmFlash > 0) {
      this.alarmFlash = Math.max(0, this.alarmFlash - dtSec * 1.4);
    }
    const strobe = world.alarmActive ? 0.5 + 0.5 * Math.sin(world.tick * 0.55) : 0;
    this.stage.vaultLight.color.setHex(strobe > 0.5 ? 0xff2b2b : PALETTE.gold);
    this.stage.lobbyLight.color.setHex(strobe > 0.5 ? 0xff4444 : 0xffe9c4);
    this.stage.lobbyLight.intensity = 20 + strobe * 22;
  }

  /**
   * Is anyone crossing this door who could walk through it right now? Guards
   * carry keys, a thief may hold the manager's card or have picked the lock,
   * and in every case the door should be seen to open rather than be walked
   * through. Someone merely passing by on patrol is not crossing it.
   */
  private someoneCanPass(world: SimWorld, level: Level, idx: number): boolean {
    for (const g of world.guards) {
      if (!g.present) continue;
      if (crossingDoorway(level, idx, g.x, g.y, g.facing)) return true;
    }
    for (const t of world.thieves) {
      if (!t.active || t.hidden || t.caught || t.respawnIn > 0) continue;
      if (!crossingDoorway(level, idx, t.x, t.y, t.facing)) continue;
      if (world.doorOpenFor(idx, t)) return true;
    }
    return false;
  }

  /** Show where a guard has been sent, until they get there. */
  showOrder(fineX: number, fineY: number): void {
    this.orderPulse.setAt(fineXYToWorldX(this.level, fineX), fineXYToWorldZ(this.level, fineY));
  }

  clearOrder(): void {
    this.orderPulse.hide();
  }

  /** Mark the objective or the suggested first move for a lost visitor. */
  hintAt(fineX: number, fineY: number): void {
    this.hintPulse.setAt(fineXYToWorldX(this.level, fineX), fineXYToWorldZ(this.level, fineY));
  }

  clearHint(): void {
    this.hintPulse.hide();
    this.cardPulse.hide();
  }

  /** Ring the vault card so a first-time visitor knows the option exists. */
  /**
   * Put the card stands where the cards actually are. The vault card moves to a
   * different desk every visit, and the stand is built once, so without this the
   * visitor sees a card in one room while the real one is picked up in another.
   */
  markKeycard(world: SimWorld): void {
    const level = this.level;
    level.json.keycards.forEach((k, i) => {
      const view = this.building.keycards.get(i);
      if (!view) return;
      const taken = world.keyTaken[i] === 1;
      if (taken) {
        // Do not snap it out of existence: let it lift away and shrink.
        if (view.root.visible && !this.cardExit.has(i)) this.cardExit.set(i, 0);
        return;
      }
      this.cardExit.delete(i);
      view.root.visible = true;
      view.root.scale.setScalar(1);
      const cell = cellOf(level, k.cell);
      view.root.position.set(
        fineXYToWorldX(level, (cell % level.w) + 0.5),
        0,
        fineXYToWorldZ(level, ((cell / level.w) | 0) + 0.5),
      );
    });
    const idx = level.json.keycards.findIndex((_, i) => world.keyTaken[i] !== 1);
    if (idx < 0) {
      this.cardPulse.hide();
      return;
    }
    const cell = cellOf(level, level.json.keycards[idx].cell);
    this.cardPulse.setAt(
      fineXYToWorldX(level, (cell % level.w) + 0.5),
      fineXYToWorldZ(level, ((cell / level.w) | 0) + 0.5),
    );
  }

  dispose(): void {
    this.thieves.dispose();
    this.guards.dispose();
    for (const c of this.guardCones) c.dispose();
    for (const c of this.cameraCones) c.dispose();
    this.phaseGlow.dispose();
    this.guideHead.dispose(); this.guideStem.dispose(); this.guideMaterial.dispose(); this.guideMask.dispose(); this.guideOutline.dispose();
    this.stage.scene.remove(this.root);
  }
}

export { MeshBasicMaterial as _MeshBasicMaterial };

/**
 * A dead-camera badge: a lightning bolt with a bar struck through it. Drawn
 * rather than typed, because there is no character for "no power" and an emoji
 * would render differently on the kiosk machine than it does here.
 */
function deadPowerTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 17, 22, 0.9)';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#e0313a';
    ctx.stroke();

    // The bolt, greyed out: this is a thing that has stopped working.
    ctx.beginPath();
    ctx.moveTo(74, 24);
    ctx.lineTo(44, 66);
    ctx.lineTo(62, 66);
    ctx.lineTo(52, 104);
    ctx.lineTo(86, 58);
    ctx.lineTo(66, 58);
    ctx.closePath();
    ctx.fillStyle = 'rgba(236, 229, 214, 0.55)';
    ctx.fill();

    // And the strike through it.
    ctx.lineCap = 'round';
    ctx.lineWidth = 13;
    ctx.strokeStyle = '#e0313a';
    ctx.beginPath();
    ctx.moveTo(28, 100);
    ctx.lineTo(100, 28);
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function glyphTexture(text: string, color: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 88px Anton, Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 70);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
