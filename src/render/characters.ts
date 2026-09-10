import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mat, type MatKey } from './materials';
import { AnimationAction, AnimationMixer, LoopRepeat } from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterModel, ModelLib } from './models';

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

interface PartSpec {
  geo: BufferGeometry;
  matKey: MatKey;
  /** Attachment point in the character's local frame. */
  pivot: Vector3;
  /** Offset from the pivot to the part's centre before any swing. */
  offset: Vector3;
  swing: 'legA' | 'legB' | 'armA' | 'armB' | 'none';
}

export interface CharacterPose {
  x: number;
  z: number;
  facingRad: number;
  /** Accumulated stride phase, in radians. */
  phase: number;
  visible: boolean;
  /** 0 = standing, 1 = full stride. */
  moving: number;
  crouch: number;
  scale: number;
  tint: number;
  /** 0 = the usual look, 1 = the alternate model (a thief in a stolen uniform). */
  variant?: number;
}

/** What the world view needs from a crowd, whichever way it is drawn. */
export interface CharacterBatch {
  readonly root: Group;
  readonly capacity: number;
  setPose(index: number, pose: CharacterPose): void;
  flush(): void;
  /** Advance animation clocks; the box figures have none. */
  update(dtSec: number): void;
  hideAll(): void;
  dispose(): void;
}

export function blankCharacterPose(): CharacterPose {
  return { x: 0, z: 0, facingRad: 0, phase: 0, visible: false, moving: 0, crouch: 0, scale: 1, tint: -1 };
}

/**
 * A crowd of simple articulated figures drawn as a handful of instanced meshes,
 * so eighty masked thieves cost seven draw calls rather than five hundred.
 */
export class BoxCharacterBatch implements CharacterBatch {
  readonly root = new Group();
  private parts: { mesh: InstancedMesh; spec: PartSpec }[] = [];
  private scratch = new Object3D();
  private m = new Matrix4();
  private q = new Quaternion();
  private tmp = new Matrix4();
  private color = new Color();
  readonly capacity: number;

  constructor(capacity: number, opts: { body: MatKey; head: MatKey; limb: MatKey; accent: MatKey; hat: 'mask' | 'cap' | 'none'; tintable?: boolean }) {
    this.capacity = capacity;
    const specs: PartSpec[] = [
      {
        geo: new BoxGeometry(0.48, 0.72, 0.3),
        matKey: opts.body,
        pivot: new Vector3(0, 0.85, 0),
        offset: new Vector3(0, 0.36, 0),
        swing: 'none',
      },
      {
        geo: new SphereGeometry(0.17, 10, 8),
        matKey: opts.head,
        pivot: new Vector3(0, 1.57, 0),
        offset: new Vector3(0, 0.12, 0),
        swing: 'none',
      },
      {
        geo: new BoxGeometry(0.17, 0.82, 0.2),
        matKey: opts.limb,
        pivot: new Vector3(0, 0.85, 0.12),
        offset: new Vector3(0, -0.41, 0),
        swing: 'legA',
      },
      {
        geo: new BoxGeometry(0.17, 0.82, 0.2),
        matKey: opts.limb,
        pivot: new Vector3(0, 0.85, -0.12),
        offset: new Vector3(0, -0.41, 0),
        swing: 'legB',
      },
      {
        geo: new BoxGeometry(0.14, 0.62, 0.15),
        matKey: opts.body,
        pivot: new Vector3(0, 1.44, 0.26),
        offset: new Vector3(0, -0.31, 0),
        swing: 'armA',
      },
      {
        geo: new BoxGeometry(0.14, 0.62, 0.15),
        matKey: opts.body,
        pivot: new Vector3(0, 1.44, -0.26),
        offset: new Vector3(0, -0.31, 0),
        swing: 'armB',
      },
    ];
    if (opts.hat === 'mask') {
      const g = new SphereGeometry(0.15, 10, 8);
      g.scale(0.55, 1.05, 1.0);
      specs.push({
        geo: g,
        matKey: 'mask',
        pivot: new Vector3(0.13, 1.69, 0),
        offset: new Vector3(0, 0, 0),
        swing: 'none',
      });
    } else if (opts.hat === 'cap') {
      specs.push({
        geo: new CylinderGeometry(0.19, 0.19, 0.09, 12),
        matKey: opts.accent,
        pivot: new Vector3(0, 1.76, 0),
        offset: new Vector3(0, 0, 0),
        swing: 'none',
      });
    }

    for (const spec of specs) {
      const material = mat(spec.matKey) as Material;
      const mesh = new InstancedMesh(spec.geo, material, capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = capacity;
      if (opts.tintable && (spec.matKey === opts.body || spec.matKey === opts.limb)) {
        mesh.instanceColor = null;
        for (let i = 0; i < capacity; i++) mesh.setColorAt(i, this.color.setHex(0xffffff));
      }
      this.parts.push({ mesh, spec });
      this.root.add(mesh);
    }
    this.hideAll();
  }

  hideAll(): void {
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (const p of this.parts) {
      for (let i = 0; i < this.capacity; i++) p.mesh.setMatrixAt(i, zero);
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setPose(index: number, pose: CharacterPose): void {
    if (index >= this.capacity) return;
    const s = this.scratch;
    if (!pose.visible) {
      this.m.makeScale(0, 0, 0);
      for (const p of this.parts) p.mesh.setMatrixAt(index, this.m);
      return;
    }
    const stride = Math.sin(pose.phase) * 0.62 * pose.moving;
    const bob = Math.abs(Math.sin(pose.phase)) * 0.045 * pose.moving;
    const crouchY = -0.35 * pose.crouch;
    const baseY = bob + crouchY;

    for (const p of this.parts) {
      let swing = 0;
      switch (p.spec.swing) {
        case 'legA':
          swing = stride;
          break;
        case 'legB':
          swing = -stride;
          break;
        case 'armA':
          swing = -stride * 0.8;
          break;
        case 'armB':
          swing = stride * 0.8;
          break;
        default:
          swing = 0;
      }
      // world = T(pos) * Ry(-facing) * T(pivot) * Rx(swing) * T(offset) * S
      s.position.set(0, 0, 0);
      s.quaternion.setFromAxisAngle(RIGHT, swing);
      s.scale.setScalar(1);
      s.updateMatrix();
      this.tmp.copy(s.matrix);
      this.tmp.setPosition(
        p.spec.pivot.x,
        p.spec.pivot.y + baseY,
        p.spec.pivot.z,
      );
      this.tmp.multiply(new Matrix4().makeTranslation(p.spec.offset.x, p.spec.offset.y, p.spec.offset.z));
      this.q.setFromAxisAngle(UP, -pose.facingRad);
      this.m.makeRotationFromQuaternion(this.q);
      this.m.scale(new Vector3(pose.scale, pose.scale, pose.scale));
      this.m.multiply(this.tmp);
      this.m.setPosition(
        pose.x + this.m.elements[12],
        this.m.elements[13],
        pose.z + this.m.elements[14],
      );
      p.mesh.setMatrixAt(index, this.m);
      if (pose.tint >= 0 && p.mesh.instanceColor) {
        p.mesh.setColorAt(index, this.color.setHex(pose.tint));
      }
    }
  }

  update(): void {}

  flush(): void {
    for (const p of this.parts) {
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const p of this.parts) {
      p.mesh.geometry.dispose();
      p.mesh.dispose();
    }
    this.parts = [];
  }
}

export function makeThiefBatch(capacity: number, models?: ModelLib): CharacterBatch {
  if (models?.thief) {
    const b = new SkinnedCharacterBatch(capacity, models.thief, models.guard);
    // Eighty shadow casters is a second skinned pass; the discs ground the crowd instead.
    b.root.traverse((o) => {
      o.castShadow = false;
    });
    return b;
  }
  return new BoxCharacterBatch(capacity, {
    body: 'red',
    head: 'skin',
    limb: 'redDark',
    accent: 'mask',
    hat: 'mask',
    tintable: true,
  });
}

export function makeGuardBatch(capacity: number, models?: ModelLib): CharacterBatch {
  if (models?.guard) return new SkinnedCharacterBatch(capacity, models.guard);
  return new BoxCharacterBatch(capacity, {
    body: 'police',
    head: 'skin',
    limb: 'dark',
    accent: 'dark',
    hat: 'cap',
  });
}

/** Height of a person in world units; interior walls are 2.6. */
const PERSON_HEIGHT = 1.72;

interface Slot {
  node: Object3D;
  alt: Object3D | null;
  altMixer: AnimationMixer | null;
  altActions: AnimationAction[];
  mixer: AnimationMixer;
  idle: AnimationAction;
  walk: AnimationAction;
  run: AnimationAction;
  moving: number;
  visible: boolean;
  variant: number;
}

/**
 * A crowd of rigged glTF figures, one clone and one animation mixer each.
 * Walk and run clips are cross-faded from the sim's speed, so a guard who
 * breaks into a chase visibly breaks into a run.
 */
export class SkinnedCharacterBatch implements CharacterBatch {
  readonly root = new Group();
  readonly capacity: number;
  private slots: Slot[] = [];

  constructor(capacity: number, model: CharacterModel, altModel: CharacterModel | null = null) {
    this.capacity = capacity;
    for (let i = 0; i < capacity; i++) {
      const node = cloneSkeleton(model.scene);
      node.visible = false;
      const mixer = new AnimationMixer(node);
      const mk = (clip: (typeof model.clips)['idle']) => {
        const a = mixer.clipAction(clip);
        a.setLoop(LoopRepeat, Infinity);
        a.enabled = true;
        a.play();
        // Desynchronise the crowd so eighty thieves do not march in lockstep.
        a.time = Math.random() * clip.duration;
        return a;
      };
      const idle = mk(model.clips.idle);
      const walk = mk(model.clips.walk);
      const run = mk(model.clips.run);
      walk.setEffectiveWeight(0);
      run.setEffectiveWeight(0);
      this.root.add(node);
      let alt: Object3D | null = null;
      let altMixer: AnimationMixer | null = null;
      const altActions: AnimationAction[] = [];
      if (altModel) {
        alt = cloneSkeleton(altModel.scene);
        alt.visible = false;
        altMixer = new AnimationMixer(alt);
        for (const clip of [altModel.clips.idle, altModel.clips.walk, altModel.clips.run]) {
          const a = altMixer.clipAction(clip);
          a.setLoop(LoopRepeat, Infinity);
          a.play();
          a.time = Math.random() * clip.duration;
          altActions.push(a);
        }
        this.root.add(alt);
      }
      this.slots.push({ node, alt, altMixer, altActions, mixer, idle, walk, run, moving: 0, visible: false, variant: 0 });
    }
  }

  hideAll(): void {
    for (const s of this.slots) {
      s.visible = false;
      s.node.visible = false;
      if (s.alt) s.alt.visible = false;
    }
  }

  setPose(index: number, pose: CharacterPose): void {
    const s = this.slots[index];
    if (!s) return;
    s.visible = pose.visible;
    s.variant = pose.variant && s.alt ? 1 : 0;
    const active = s.variant ? s.alt! : s.node;
    s.node.visible = pose.visible && s.variant === 0;
    if (s.alt) s.alt.visible = pose.visible && s.variant === 1;
    if (!pose.visible) return;
    active.position.set(pose.x, -0.55 * pose.crouch * 0.4, pose.z);
    // The model faces +z; facing 0 in the sim means +x.
    active.rotation.y = Math.PI / 2 - pose.facingRad;
    const h = PERSON_HEIGHT * (pose.scale / 1.28);
    active.scale.set(h, h * (1 - 0.18 * pose.crouch), h);
    // Smooth the speed so a one-tick stutter does not flicker the animation.
    s.moving += (pose.moving - s.moving) * 0.25;
  }

  update(dtSec: number): void {
    for (const s of this.slots) {
      if (!s.visible) continue;
      const m = Math.min(1, s.moving);
      const runW = Math.max(0, (m - 0.55) / 0.45);
      const walkW = Math.min(1, m / 0.55) * (1 - runW);
      if (s.variant && s.altMixer) {
        const [ai, aw, ar] = s.altActions;
        ai.setEffectiveWeight(1 - Math.max(walkW, runW));
        aw.setEffectiveWeight(walkW);
        ar.setEffectiveWeight(runW);
        aw.setEffectiveTimeScale(0.9 + m * 0.5);
        s.altMixer.update(dtSec);
        continue;
      }
      s.idle.setEffectiveWeight(1 - Math.max(walkW, runW));
      s.walk.setEffectiveWeight(walkW);
      s.run.setEffectiveWeight(runW);
      s.walk.setEffectiveTimeScale(0.9 + m * 0.5);
      s.mixer.update(dtSec);
    }
  }

  flush(): void {}

  dispose(): void {
    for (const s of this.slots) s.mixer.stopAllAction();
    this.slots = [];
  }
}
