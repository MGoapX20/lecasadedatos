import {
  AnimationClip,
  Box3,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette';

/**
 * glTF assets: a handful of CC0 props and one rigged character (see
 * public/models/CREDITS.md). Everything is normalised at load so the rest of
 * the renderer can place a prop by its footprint and never think about the
 * source file's scale or origin.
 */

export interface CharacterModel {
  /** Template to clone with SkeletonUtils. Stands on y=0, faces +z, 1 unit tall. */
  scene: Group;
  clips: { idle: AnimationClip; walk: AnimationClip; run: AnimationClip };
}

export interface ModelLib {
  /** Prop templates by key; clone before adding to a scene. */
  props: Map<string, Group>;
  guard: CharacterModel | null;
  thief: CharacterModel | null;
}

interface PropSpec {
  key: string;
  file: string;
  /** Normalise so the model's height (y) equals this... */
  height?: number;
  /** ...or so its longest horizontal side equals this. */
  length?: number;
  /** Hang from the top instead of standing on the bottom. */
  hang?: boolean;
  /** Turn the source so its front faces +z. */
  yaw?: number;
  recolor?: Record<string, number>;
  /** Emissive intensity per material name; glTF lamps tend to arrive white-hot. */
  emissive?: Record<string, number>;
}

const PROPS: PropSpec[] = [
  { key: 'chandelier', file: 'chandelier.glb', height: 1.5, hang: true, emissive: { Light: 0.5 } },
  { key: 'statue', file: 'horse_statue.glb', height: 2.7 },
  { key: 'sofa', file: 'sofa.glb', length: 2.3, recolor: { Sofa: PALETTE.red, Legs: 0x2a1d14 } },
  { key: 'cabinet', file: 'drawer.glb', height: 1.35 },
  { key: 'crate', file: 'crate.glb', height: 1.15 },
  { key: 'desk', file: 'desk.glb', length: 2.2 },
  { key: 'counter', file: 'counter.glb', length: 2.4 },
  { key: 'press', file: 'press.glb', length: 3.2 },
  { key: 'truck', file: 'truck.glb', length: 7.0, yaw: Math.PI / 2 },
  { key: 'lamp', file: 'street_light.glb', height: 3.9, emissive: { Light: 0.8 } },
  { key: 'gold', file: 'gold_ingots.glb', length: 1.0 },
  { key: 'safe', file: 'safe.glb', height: 1.2 },
  { key: 'printer', file: 'printer.glb', length: 0.7 },
  { key: 'padlock', file: 'padlock.glb', height: 0.7 },
  { key: 'vaultDoor', file: 'vault_door.glb', length: 2.36 },
  { key: 'car', file: 'car.glb', length: 4.4 },
  { key: 'suv', file: 'suv.glb', length: 4.8 },
  { key: 'policeCar', file: 'police_car.glb', length: 4.6 },
];

const GUARD_COLORS: Record<string, number> = {
  Shirt: PALETTE.police,
  Pants: PALETTE.policeDark,
  Details: 0x1a1a1e,
  Skin: 0xc9a48a,
  Hair: 0x2a1d14,
  Eyes: 0x111111,
};

/** Red jumpsuit and a white face: the mask, read from across a hall. */
const THIEF_COLORS: Record<string, number> = {
  Shirt: PALETTE.red,
  Pants: PALETTE.redDark,
  Details: 0x1a1a1e,
  Skin: 0xf2ece0,
  Hair: 0x141414,
  Eyes: 0x111111,
};

/** Rigid accessories authored in metres (glTF y-up, +z forward), bound to one bone each. */
const WEAR_FILES: Record<string, string> = {
  cap: 'wear_cap.glb',
  belt: 'wear_belt.glb',
  pistol: 'wear_pistol.glb',
  hood: 'wear_hood.glb',
  mask: 'wear_mask.glb',
};

interface Fit {
  wear: string;
  bone: string;
  /** body: authored upright at the bone. handR: +z along the fingers, +y the back of the hand. */
  frame: 'body' | 'handR';
}

const GUARD_FIT: Fit[] = [
  { wear: 'cap', bone: 'Head', frame: 'body' },
  { wear: 'belt', bone: 'Hips', frame: 'body' },
  { wear: 'pistol', bone: 'PalmR', frame: 'handR' },
];
const THIEF_FIT: Fit[] = [
  { wear: 'hood', bone: 'Head', frame: 'body' },
  { wear: 'mask', bone: 'Head', frame: 'body' },
];

/** Person height the rig is treated as, for scaling accessories into bind space. */
const PERSON_METRES = 1.75;

/**
 * Bind accessories rigidly to bones as extra skinned meshes on the same
 * skeleton, so the merge step folds them into the body: a cap, a belt and a
 * pistol cost nothing at draw time.
 */
function dress(scene: Group, fits: Fit[], wear: Map<string, Group>): void {
  let body: SkinnedMesh | null = null;
  scene.traverse((o) => {
    if (!body && (o as SkinnedMesh).isSkinnedMesh) body = o as SkinnedMesh;
  });
  if (!body) return;
  const skinned = body as SkinnedMesh;
  const skeleton = skinned.skeleton;
  // The rig's bind space is z-up; the whole figure's height there sets the
  // metre. The first part alone is just a shirt, so take the union of all.
  const bb = new Box3();
  scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) {
      o.updateMatrixWorld(false);
      (o as SkinnedMesh).geometry.computeBoundingBox();
      bb.union((o as SkinnedMesh).geometry.boundingBox!);
    }
  });
  const u = (bb.max.z - bb.min.z) / PERSON_METRES;
  const bonePos = new Vector3();
  const boneWorld = new Matrix4();

  for (const fit of fits) {
    const tpl = wear.get(fit.wear);
    const bi = skeleton.bones.findIndex((b) => b.name === fit.bone);
    if (!tpl || bi < 0) continue;
    boneWorld.copy(skeleton.boneInverses[bi]).invert();
    bonePos.setFromMatrixPosition(boneWorld);
    // Axis map from accessory metres to bind space, as a 4x4.
    const M = new Matrix4();
    if (fit.frame === 'body') {
      // (x, y, z) -> (x, -z, y): y-up forward +z becomes z-up forward -y.
      M.set(u, 0, 0, bonePos.x, 0, 0, -u, bonePos.y, 0, u, 0, bonePos.z, 0, 0, 0, 1);
    } else {
      // Right hand in the T-pose points along -x: fingers (+z) -> -x, up (+y) -> +z.
      M.set(0, 0, -u, bonePos.x, u, 0, 0, bonePos.y, 0, u, 0, bonePos.z, 0, 0, 0, 1);
    }
    tpl.updateMatrixWorld(true);
    forEachMesh(tpl, (m) => {
      const g = m.geometry.clone();
      g.clearGroups();
      g.applyMatrix4(m.matrixWorld);
      g.applyMatrix4(M);
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
      }
      g.computeVertexNormals();
      const n = g.attributes.position.count;
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        si[i * 4] = bi;
        sw[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
      const mat = ((Array.isArray(m.material) ? m.material[0] : m.material) as MeshStandardMaterial).clone();
      // The mask must read as a mask, not a lamp: keep it below the bloom threshold.
      if (mat.name === 'Cream') mat.color.setHex(0xd6cdbd);
      const part = new SkinnedMesh(g, mat);
      part.name = `wear_${fit.wear}`;
      part.frustumCulled = false;
      part.bind(skeleton, skinned.bindMatrix);
      skinned.parent!.add(part);
    });
  }
}

function forEachMesh(root: Object3D, fn: (m: Mesh) => void): void {
  root.traverse((o) => {
    if ((o as Mesh).isMesh) fn(o as Mesh);
  });
}

function recolor(root: Object3D, map: Record<string, number>): void {
  forEachMesh(root, (m) => {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as MeshStandardMaterial;
      const hex = map[std.name];
      if (hex !== undefined && std.color) std.color.setHex(hex);
    }
  });
}

/** Scale and re-origin a loaded scene so it stands on y=0, centred on x/z. */
function normalise(scene: Group, spec: PropSpec, precise = false): Group {
  scene.updateMatrixWorld(true);
  // Precise walks vertices with skinning applied, which is the only honest
  // height for a rigged figure whose armature carries a 100x scale.
  const box = new Box3().setFromObject(scene, precise);
  const size = box.getSize(new Vector3());
  let k = 1;
  if (spec.height) k = spec.height / Math.max(1e-6, size.y);
  else if (spec.length) k = spec.length / Math.max(1e-6, Math.max(size.x, size.z));
  const centre = box.getCenter(new Vector3());
  const wrap = new Group();
  wrap.name = spec.key;
  const inner = new Group();
  inner.add(scene);
  inner.position.set(-centre.x * k, spec.hang ? -box.max.y * k : -box.min.y * k, -centre.z * k);
  inner.scale.setScalar(k);
  if (spec.yaw) inner.rotation.y = spec.yaw;
  wrap.add(inner);
  forEachMesh(wrap, (m) => {
    m.castShadow = true;
    m.receiveShadow = true;
  });
  if (spec.recolor) recolor(wrap, spec.recolor);
  if (spec.emissive) {
    forEachMesh(wrap, (m) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) {
        const std = mm as MeshStandardMaterial;
        const k = spec.emissive![std.name];
        if (k !== undefined && std.emissive) {
          std.emissive.copy(std.color);
          std.emissiveIntensity = k;
        }
      }
    });
  }
  return wrap;
}

/**
 * Collapse a multi-material skinned mesh into one material with vertex
 * colours, so eighty thieves cost eighty draw calls rather than five hundred.
 */
function bakeCharacter(scene: Group, colors: Record<string, number>): void {
  const tmp = new Color();
  forEachMesh(scene, (m) => {
    const geo = m.geometry;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    const index = geo.index;
    const paint = (vi: number, c: Color) => {
      col[vi * 3] = c.r;
      col[vi * 3 + 1] = c.g;
      col[vi * 3 + 2] = c.b;
    };
    if (geo.groups.length && index) {
      for (const g of geo.groups) {
        const mat = mats[g.materialIndex ?? 0] as MeshStandardMaterial;
        const hex = colors[mat?.name] ?? mat?.color?.getHex() ?? 0x888888;
        tmp.setHex(hex);
        const end = g.start + (g.count === Infinity ? index.count - g.start : g.count);
        for (let i = g.start; i < end; i++) paint(index.getX(i), tmp);
      }
    } else {
      const mat = mats[0] as MeshStandardMaterial;
      tmp.setHex(colors[mat?.name] ?? mat?.color?.getHex() ?? 0x888888);
      for (let i = 0; i < n; i++) paint(i, tmp);
    }
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.clearGroups();
    m.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
  });
  mergeSkinnedParts(scene);
}

/**
 * The source figure is seven skinned meshes, one per material. After the bake
 * they share one material, so fold them into one SkinnedMesh on the same
 * skeleton: one draw call per person instead of seven.
 */
function mergeSkinnedParts(scene: Group): void {
  const parts: SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) parts.push(o as SkinnedMesh);
  });
  if (parts.length < 2) return;
  const first = parts[0];
  const sameRig = parts.every((p) => p.skeleton === first.skeleton && p.parent === first.parent);
  if (!sameRig) return;
  const geoms = parts.map((p) => {
    const g = p.geometry.clone();
    g.clearGroups();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.index) return g;
    return g;
  });
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  if (!merged) return;
  const one = new SkinnedMesh(merged, first.material);
  one.name = 'Person';
  one.frustumCulled = false;
  one.castShadow = true;
  one.receiveShadow = false;
  one.position.copy(first.position);
  one.quaternion.copy(first.quaternion);
  one.scale.copy(first.scale);
  one.bind(first.skeleton, first.bindMatrix);
  const parent = first.parent!;
  for (const p of parts) parent.remove(p);
  parent.add(one);
}

function findClip(clips: AnimationClip[], suffix: string): AnimationClip | undefined {
  return clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()));
}

function makeCharacter(
  scene: Group,
  clips: AnimationClip[],
  colors: Record<string, number>,
  fits: Fit[],
  wear: Map<string, Group>,
): CharacterModel | null {
  const idle = findClip(clips, 'Idle');
  const walk = findClip(clips, 'Walk');
  const run = findClip(clips, 'Run') ?? walk;
  if (!idle || !walk || !run) return null;
  dress(scene, fits, wear);
  bakeCharacter(scene, colors);
  const wrap = normalise(scene, { key: 'character', file: '', height: 1 }, true);
  let hasSkin = false;
  forEachMesh(wrap, (m) => {
    if ((m as SkinnedMesh).isSkinnedMesh) hasSkin = true;
  });
  if (!hasSkin) return null;
  return { scene: wrap, clips: { idle, walk, run } };
}

/**
 * Collapse a template's static meshes into one per material, keeping any
 * subtree named in `keep` as its own merged mesh so it can still be animated.
 */
function collapse(template: Group, keep: string[] = []): void {
  const kept = keep.map((n) => template.getObjectByName(n)).filter((o): o is Object3D => !!o);
  const isKept = (o: Object3D) => kept.some((k) => k === o || k.getObjectById(o.id) !== undefined);
  template.updateMatrixWorld(true);
  const statics: Object3D[] = [];
  const perKept = new Map<Object3D, Object3D[]>();
  forEachMesh(template, (m) => {
    const owner = kept.find((k) => k.getObjectById(m.id) !== undefined);
    if (owner) {
      const list = perKept.get(owner) ?? [];
      list.push(m);
      perKept.set(owner, list);
    } else if (!isKept(m)) {
      statics.push(m);
    }
  });
  const holder = new Group();
  holder.name = 'static';
  template.add(holder);
  holder.updateMatrixWorld(true);
  mergeStatic(statics, holder);
  for (const s of statics) s.removeFromParent();
  for (const [owner, meshes] of perKept) {
    owner.updateMatrixWorld(true);
    mergeStatic(meshes, owner);
    for (const m of meshes) m.removeFromParent();
  }
}

export async function loadModels(base = '/models/'): Promise<ModelLib> {
  const loader = new GLTFLoader();
  const lib: ModelLib = { props: new Map(), guard: null, thief: null };
  const load = (file: string) =>
    new Promise<{ scene: Group; animations: AnimationClip[] }>((resolve, reject) => {
      loader.load(base + file, (g) => resolve({ scene: g.scene, animations: g.animations }), undefined, reject);
    });

  await Promise.all([
    ...PROPS.map(async (spec) => {
      try {
        const g = await load(spec.file);
        const tpl = normalise(g.scene, spec);
        collapse(tpl, spec.key === 'vaultDoor' ? ['Wheel'] : []);
        lib.props.set(spec.key, tpl);
      } catch (e) {
        console.warn(`[models] ${spec.file} failed to load; using the procedural ${spec.key}`, e);
      }
    }),
    (async () => {
      try {
        const wear = new Map<string, Group>();
        await Promise.all(
          Object.entries(WEAR_FILES).map(async ([key, file]) => {
            try {
              wear.set(key, (await load(file)).scene);
            } catch (e) {
              console.warn(`[models] ${file} failed to load`, e);
            }
          }),
        );
        // Two loads on purpose: the bake mutates geometry, and the guard and
        // the thief need different colours in their vertices.
        const [g1, g2] = await Promise.all([load('man_suit.glb'), load('man_suit.glb')]);
        lib.guard = makeCharacter(g1.scene, g1.animations, GUARD_COLORS, GUARD_FIT, wear);
        lib.thief = makeCharacter(g2.scene, g2.animations, THIEF_COLORS, THIEF_FIT, wear);
      } catch (e) {
        console.warn('[models] character failed to load; using the box figures', e);
      }
    })(),
  ]);
  return lib;
}

/** An empty library, for tests and for a failed load. */
export function emptyModels(): ModelLib {
  return { props: new Map(), guard: null, thief: null };
}

/**
 * Bake a set of placed, static prop instances into one mesh per material.
 * Sixty chandeliers, desks and cars become a dozen draw calls. Anything that
 * must move (the vault door) is not passed through here.
 */
export function mergeStatic(instances: Object3D[], parent: Object3D): void {
  const byMat = new Map<string, { mat: MeshStandardMaterial; geoms: BufferGeometry[] }>();
  const tmp = new Matrix4();
  for (const inst of instances) {
    inst.updateMatrixWorld(true);
    forEachMesh(inst, (m) => {
      if ((m as SkinnedMesh).isSkinnedMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const geo = m.geometry;
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
      for (const g of groups) {
        const mat = mats[g.materialIndex ?? 0] as MeshStandardMaterial;
        if (!mat) continue;
        let sub = geo;
        if (geo.groups.length && geo.index) {
          // Slice this material's triangles out of the shared index.
          const end = g.count === Infinity ? geo.index.count : g.start + g.count;
          sub = geo.clone();
          sub.setIndex(Array.from(geo.index.array.slice(g.start, end)));
          sub.clearGroups();
        } else {
          sub = geo.clone();
          sub.clearGroups();
        }
        // Drop attributes the merge cannot reconcile across models.
        for (const name of Object.keys(sub.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) sub.deleteAttribute(name);
        }
        if (!sub.attributes.uv) {
          const n = sub.attributes.position.count;
          sub.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
        }
        if (!sub.attributes.normal) sub.computeVertexNormals();
        sub = sub.toNonIndexed();
        tmp.copy(parent.matrixWorld).invert().multiply(m.matrixWorld);
        sub.applyMatrix4(tmp);
        const key = mat.uuid;
        let b = byMat.get(key);
        if (!b) {
          b = { mat, geoms: [] };
          byMat.set(key, b);
        }
        b.geoms.push(sub);
      }
    });
  }
  for (const b of byMat.values()) {
    const merged = mergeGeometries(b.geoms, false);
    for (const g of b.geoms) g.dispose();
    if (!merged) continue;
    const mesh = new Mesh(merged, b.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}
