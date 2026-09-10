import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fineXYToWorldX, fineXYToWorldZ, type Level } from '../level/loader';
import type { CellXY, PropDef } from '../level/schema';
import { mat, type MatKey } from './materials';
import { FLOOR_COLORS, PALETTE } from './palette';
import { mergeStatic, type ModelLib } from './models';
import { signMaterial } from './signs';
import { surfaces, worldUV } from './textures';

const INTERIOR_WALL_H = 2.6;
/** The shop roof signs, in metres. */
const SIGN_W = 2.5;
const SIGN_H = 1.15;
/** Standing clear of the awning at 2.27, legs included. */
const SIGN_Y = 3.4;
const EXTERIOR_WALL_H = 6.2;
const STUB_WALL_H = 1.0;
/**
 * How far the aiming beam reaches when nothing is in its way. Short on purpose:
 * it says which way the camera is looking, and the cone on the floor is what
 * states the real coverage.
 */
export const BEAM_REACH = 4.5;
/** Cells of wall either side of the gap that come down with it. */
const HOLE_SPREAD = 2;
/** What is left standing beside the breach. */
const HOLE_STUB_H = 1.15;
/** Where the beam leaves the lens, in the pivot's frame. */
const BEAM_START = 0.42;

export interface BuildingView {
  root: Group;
  /** Full-height shell for the cinematic attract shot. */
  shellFull: Mesh;
  /** Cutaway shell used while the visitor is playing. */
  shellCut: Mesh;
  doors: Map<number, Object3D>;
  /** The swinging part of each door, hinged at its edge. */
  doorHinges: Map<number, Object3D>;
  /** The leaf mesh of each door, for colouring by state. */
  doorLeaves: Map<number, Mesh>;
  /** The vault's handwheel, which turns while the lock is being worked. */
  vaultWheel: Object3D | null;
  /** Pivots that turn to follow each camera's sweep. */
  cameras: Map<number, Object3D>;
  /** The lens housing lamp, brightened while the alarm is up. */
  cameraLeds: Map<number, Mesh>;
  /** The sweeping beam, hidden when the power is cut. */
  cameraBeams: Map<number, Object3D>;
  /** Point one camera's beam, trimming it at the first wall it meets. */
  aimBeam: (index: number, facingDeg: number) => void;
  /** Swap the outside wall for the breach in it, or back again. */
  setHole: (open: boolean) => void;
  /** The stretch of wall that gets drilled through, while it still stands. */
  breachWall: Object3D | null;
  /**
   * Props kept out of the static merge because something needs to point at
   * them one at a time. Keyed `press:x,y`.
   */
  namedProps: Map<string, Object3D>;
  vaultDoor: Object3D | null;
  keycards: Map<number, KeycardView>;
  portalMarks: Map<string, Object3D>;
  setCutaway: (cut: boolean) => void;
}

export interface KeycardView {
  root: Object3D;
  card: Mesh;
  beam: Mesh;
  halo: Mesh;
}

interface Bucket {
  key: MatKey;
  geoms: BufferGeometry[];
}

function bucket(map: Map<MatKey, Bucket>, key: MatKey): Bucket {
  let b = map.get(key);
  if (!b) {
    b = { key, geoms: [] };
    map.set(key, b);
  }
  return b;
}

function push(map: Map<MatKey, Bucket>, key: MatKey, geo: BufferGeometry): void {
  bucket(map, key).geoms.push(geo);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

function cyl(r: number, h: number, x: number, y: number, z: number, seg = 12): BufferGeometry {
  const g = new CylinderGeometry(r, r, h, seg);
  g.translate(x, y, z);
  return g;
}

function mergeBuckets(map: Map<MatKey, Bucket>, parent: Object3D, castShadow = true): Mesh[] {
  const out: Mesh[] = [];
  for (const b of map.values()) {
    if (!b.geoms.length) continue;
    const merged = mergeGeometries(b.geoms, false);
    for (const g of b.geoms) g.dispose();
    if (!merged) continue;
    const m = new Mesh(merged, mat(b.key));
    m.castShadow = castShadow;
    m.receiveShadow = true;
    parent.add(m);
    out.push(m);
  }
  return out;
}

/** Contiguous runs of solid cells, merged into as few boxes as possible. */
function wallRuns(level: Level, skip: Set<number>): { x: number; y: number; len: number; horizontal: boolean }[] {
  const solid = new Uint8Array(level.cellCount);
  for (let i = 0; i < level.cellCount; i++) {
    // The stretch that can be knocked through is its own mesh, so that it can
    // come away without rebuilding every wall in the building.
    if (skip.has(i)) continue;
    // Structure only. Furniture is unwalkable too, and a crate wearing a
    // 2.6-metre plaster block is the clutter that made the plan unreadable.
    if (!level.wall[i]) continue;
    // Only build walls that actually border open floor.
    const x = i % level.w;
    const y = (i / level.w) | 0;
    let touches = false;
    for (let dy = -1; dy <= 1 && !touches; dy++) {
      for (let dx = -1; dx <= 1 && !touches; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        if (!level.wall[ny * level.w + nx]) touches = true;
      }
    }
    if (touches) solid[i] = 1;
  }
  const used = new Uint8Array(level.cellCount);
  const runs: { x: number; y: number; len: number; horizontal: boolean }[] = [];
  for (let y = 0; y < level.h; y++) {
    let x = 0;
    while (x < level.w) {
      const i = y * level.w + x;
      if (!solid[i] || used[i]) {
        x++;
        continue;
      }
      let len = 0;
      while (x + len < level.w && solid[y * level.w + x + len] && !used[y * level.w + x + len]) len++;
      for (let k = 0; k < len; k++) used[y * level.w + x + k] = 1;
      runs.push({ x, y, len, horizontal: true });
      x += len;
    }
  }
  return runs;
}

/**
 * How high the built wall stands in each cell, for the shell in one of its two
 * states. The camera beams are trimmed against this: a laser is a straight line
 * and it has to stop where the plaster does.
 */
export function wallTops(level: Level, cut: boolean): Float32Array {
  const tops = new Float32Array(level.cellCount);
  for (let i = 0; i < level.cellCount; i++) {
    if (!level.wall[i]) continue;
    const info = shellFacing(level, i % level.w, (i / level.w) | 0);
    const full = info.shell ? EXTERIOR_WALL_H : INTERIOR_WALL_H;
    // The cutaway takes the near-side shell down to a stub, and a beam that
    // stopped at a wall that is no longer there would look broken.
    tops[i] = cut && info.shell && (info.nx > 0 || info.ny > 0) ? STUB_WALL_H : full;
  }
  return tops;
}

/** Is this wall cell part of the outer shell, and which way does it face? */
function shellFacing(level: Level, x: number, y: number): { shell: boolean; nx: number; ny: number } {
  let shell = false;
  let nx = 0;
  let ny = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const ax = x + dx;
    const ay = y + dy;
    if (ax < 0 || ay < 0 || ax >= level.w || ay >= level.h) continue;
    const i = ay * level.w + ax;
    if (!level.wall[i] && !level.indoor[i]) {
      shell = true;
      nx += dx;
      ny += dy;
    }
  }
  return { shell, nx, ny };
}

function makeFloors(level: Level, parent: Object3D): void {
  const byKind = new Map<string, BufferGeometry[]>();
  const cs = level.cellSize;
  // Merge each area rect into one quad rather than one quad per cell.
  for (const a of level.json.areas) {
    const [rx, ry, rw, rh] = a.rect;
    const g = new PlaneGeometry(rw * cs, rh * cs);
    g.rotateX(-Math.PI / 2);
    g.translate(
      fineXYToWorldX(level, rx + rw / 2),
      a.kind === 'outdoor' ? -0.02 : 0,
      fineXYToWorldZ(level, ry + rh / 2),
    );
    const list = byKind.get(a.floor) ?? [];
    list.push(g);
    byKind.set(a.floor, list);
  }
  for (const d of level.doors) {
    const [rx, ry, rw, rh] = d.rect;
    const g = new PlaneGeometry(rw * cs, rh * cs);
    g.rotateX(-Math.PI / 2);
    g.translate(fineXYToWorldX(level, rx + rw / 2), 0, fineXYToWorldZ(level, ry + rh / 2));
    const list = byKind.get('marble') ?? [];
    list.push(g);
    byKind.set('marble', list);
  }
  for (const o of level.json.openings) {
    const [rx, ry, rw, rh] = o.rect;
    const g = new PlaneGeometry(rw * cs, rh * cs);
    g.rotateX(-Math.PI / 2);
    g.translate(fineXYToWorldX(level, rx + rw / 2), 0, fineXYToWorldZ(level, ry + rh / 2));
    const list = byKind.get('marble') ?? [];
    list.push(g);
    byKind.set('marble', list);
  }
  const lib = surfaces();
  for (const [kind, geoms] of byKind) {
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    if (!merged) continue;
    const surf = lib[kind];
    let material: MeshStandardMaterial;
    if (surf) {
      worldUV(merged, surf.metres);
      material = surf.material;
    } else {
      material = new MeshStandardMaterial({
        color: FLOOR_COLORS[kind] ?? PALETTE.marble,
        roughness: kind === 'marble' ? 0.28 : 0.85,
        metalness: kind === 'marble' ? 0.06 : 0.0,
      });
    }
    const m = new Mesh(merged, material);
    m.receiveShadow = true;
    parent.add(m);
  }
}

/** Which glTF stands in for which level prop kind, when it loaded. */
const PROP_MODEL: Record<string, string> = {
  chandelier: 'chandelier',
  statue: 'statue',
  sofa: 'sofa',
  cabinet: 'cabinet',
  crate: 'crate',
  desk: 'desk',
  press: 'press',
  truck: 'truck',
  lamp: 'lamp',
  moneyStack: 'gold',
};

function placeModel(models: ModelLib, key: string, x: number, y: number, z: number, rotY: number, scale = 1): Object3D | null {
  const tpl = models.props.get(key);
  if (!tpl) return null;
  const inst = tpl.clone(true);
  inst.position.set(x, y, z);
  inst.rotation.y = rotY;
  inst.scale.setScalar(scale);
  return inst;
}

function propGeometry(level: Level, p: PropDef, buckets: Map<MatKey, Bucket>, models: ModelLib, out: Object3D[]): void {
  const x = fineXYToWorldX(level, p.cell[0] + 0.5);
  const z = fineXYToWorldZ(level, p.cell[1] + 0.5);
  const rot = ((p.rotDeg ?? 0) * Math.PI) / 180;
  const s = p.scale ?? 1;
  const modelKey = PROP_MODEL[p.kind];
  if (modelKey && models.props.has(modelKey)) {
    // Model props: the level's rotation is about +y in the box code's frame.
    const y = p.kind === 'chandelier' ? 4.4 : 0;
    const inst = placeModel(models, modelKey, x, y, z, -rot, p.kind === 'moneyStack' ? 1 : s);
    if (inst) {
      out.push(inst);
      if (p.kind === 'lamp') {
        push(buckets, 'emissiveGold', new SphereGeometry(0.16, 8, 6).translate(x, 3.7, z));
      }
      return;
    }
  }
  if (p.kind === 'teller' && models.props.has('counter')) {
    // Two counter sections make the level's 4.6-long teller.
    for (const k of [-1.15, 1.15]) {
      const inst = placeModel(models, 'counter', x + Math.cos(rot) * k, 0, z - Math.sin(rot) * k, -rot);
      if (inst) out.push(inst);
    }
    return;
  }
  switch (p.kind) {
    case 'column': {
      push(buckets, 'stone', cyl(0.55 * s, 5.6 * s, x, 2.8 * s, z, 14));
      push(buckets, 'stone', box(1.5 * s, 0.28 * s, 1.5 * s, x, 0.14 * s, z));
      push(buckets, 'stone', box(1.5 * s, 0.3 * s, 1.5 * s, x, 5.6 * s, z));
      break;
    }
    case 'desk':
      push(buckets, 'wood', box(2.4 * s, 0.12, 1.3 * s, x, 0.78, z, rot));
      push(buckets, 'wood', box(2.2 * s, 0.72, 0.14, x, 0.36, z, rot));
      break;
    case 'teller':
      push(buckets, 'marbleDark', box(4.6 * s, 1.15, 0.9 * s, x, 0.58, z, rot));
      push(buckets, 'brass', box(4.7 * s, 0.09, 1.05 * s, x, 1.18, z, rot));
      break;
    case 'press':
      push(buckets, 'metal', box(3.0 * s, 1.7, 2.0 * s, x, 0.85, z, rot));
      push(buckets, 'brass', cyl(0.55 * s, 2.2, x, 1.9, z, 12));
      push(buckets, 'dark', box(3.2 * s, 0.2, 2.2 * s, x, 1.78, z, rot));
      break;
    case 'plant':
      push(buckets, 'redDark', cyl(0.42 * s, 0.5, x, 0.25, z, 10));
      push(buckets, 'foliage', new ConeGeometry(0.62 * s, 1.5, 8).translate(x, 1.2, z));
      break;
    case 'crate':
      push(buckets, 'wood', box(1.5 * s, 1.2 * s, 1.5 * s, x, 0.6 * s, z, rot));
      break;
    case 'truck':
      push(buckets, 'redDark', box(6.4 * s, 2.6, 2.6 * s, x, 1.5, z, rot));
      push(buckets, 'dark', box(2.2 * s, 1.7, 2.5 * s, x + 4.0 * Math.cos(rot), 1.0, z + 4.0 * Math.sin(rot), rot));
      break;
    case 'lamp':
      push(buckets, 'dark', cyl(0.11, 3.6, x, 1.8, z, 8));
      push(buckets, 'emissiveGold', new SphereGeometry(0.28, 10, 8).translate(x, 3.7, z));
      break;
    case 'bench':
      push(buckets, 'wood', box(2.2 * s, 0.14, 0.6 * s, x, 0.46, z, rot));
      push(buckets, 'metal', box(0.12, 0.44, 0.5, x - 0.9, 0.22, z, rot));
      push(buckets, 'metal', box(0.12, 0.44, 0.5, x + 0.9, 0.22, z, rot));
      break;
    case 'sofa':
      push(buckets, 'red', box(2.2 * s, 0.5, 1.0 * s, x, 0.3, z, rot));
      push(buckets, 'redDark', box(2.2 * s, 0.7, 0.3, x, 0.65, z - 0.4, rot));
      break;
    case 'cabinet':
      push(buckets, 'wood', box(1.6 * s, 2.0, 0.7 * s, x, 1.0, z, rot));
      push(buckets, 'brass', box(1.62 * s, 0.05, 0.72 * s, x, 1.1, z, rot));
      break;
    case 'moneyStack':
      for (let i = 0; i < 4; i++) {
        push(buckets, 'paper', box(0.9, 0.22, 0.6, x, 0.11 + i * 0.24, z, rot + i * 0.12));
      }
      break;
    case 'chandelier':
      push(buckets, 'brass', new TorusGeometry(0.9, 0.07, 6, 20).rotateX(Math.PI / 2).translate(x, 3.9, z));
      push(buckets, 'emissiveGold', new SphereGeometry(0.22, 8, 6).translate(x, 3.6, z));
      push(buckets, 'brass', cyl(0.04, 1.2, x, 4.5, z, 6));
      break;
    case 'statue':
      push(buckets, 'stone', box(1.1, 0.7, 1.1, x, 0.35, z));
      push(buckets, 'stone', cyl(0.28, 1.5, x, 1.45, z, 10));
      push(buckets, 'stone', new SphereGeometry(0.3, 10, 8).translate(x, 2.35, z));
      break;
    case 'store': {
      // A shopfront on the service road: counter, awning, stock on the kerb,
      // and a lit sign on the roof saying what the shop sells.
      const ox = Math.cos(rot);
      const oz = Math.sin(rot);
      push(buckets, 'marbleDark', box(3.2 * s, 1.05, 1.2 * s, x, 0.52, z, rot));
      push(buckets, 'brass', box(3.4 * s, 0.1, 1.4 * s, x, 1.1, z, rot));
      push(buckets, 'red', box(3.6 * s, 0.14, 1.9 * s, x, 2.2, z, rot));
      for (const k of [-1.6, 1.6]) {
        push(buckets, 'dark', cyl(0.07, 2.2, x + ox * k, 1.1, z + oz * k, 8));
      }
      push(buckets, 'wood', box(0.9, 0.9, 0.9, x + oz * 1.2 + ox * 1.9, 0.45, z - ox * 1.2 + oz * 1.9));
      push(buckets, 'wood', box(0.8, 0.8, 0.8, x + oz * 1.1 - ox * 1.9, 0.4, z - ox * 1.1 - oz * 1.9));
      if (p.sign) {
        // Two short legs off the awning, a dark board, then the lit face just
        // in front of it so the neon is never z-fighting its own backing.
        for (const k of [-1.0, 1.0]) {
          push(buckets, 'dark', cyl(0.05, 0.75, x + ox * k, 2.6, z + oz * k, 6));
        }
        push(buckets, 'dark', box(SIGN_W + 0.16, SIGN_H + 0.16, 0.1, x, SIGN_Y, z, rot));
        // A face on each side, so the logo reads the right way round whichever
        // way the shop happens to be turned to the road.
        const nx = Math.sin(rot);
        const nz = Math.cos(rot);
        const faces: BufferGeometry[] = [];
        for (const side of [1, -1]) {
          const f = new PlaneGeometry(SIGN_W, SIGN_H);
          f.rotateY(side > 0 ? rot : rot + Math.PI);
          f.translate(x + nx * 0.07 * side, SIGN_Y, z + nz * 0.07 * side);
          faces.push(f);
        }
        const board = new Mesh(mergeGeometries(faces, false)!, signMaterial(p.sign));
        board.castShadow = false;
        board.receiveShadow = false;
        out.push(board);
      }
      break;
    }
    case 'banner':
      push(buckets, 'red', box(0.06, 3.4, 1.3 * s, x, 3.4, z, rot));
      break;
  }
}

interface BeamRig {
  shaft: Mesh;
  spot: Mesh;
  /** How high the camera hangs, so the beam knows where the floor is. */
  height: number;
  /** Unobstructed reach, along the floor. */
  reach: number;
  cell: CellXY;
}

export interface BeamHit {
  /** Horizontal distance from the pivot to the end of the beam. */
  x: number;
  /** Height of that end above the floor. */
  y: number;
  /** True if it stopped on plaster rather than on the floor. */
  wall: boolean;
}

/**
 * Walk the beam out from the lens until it meets a wall taller than the beam is
 * at that point, or reaches the floor. The sight grid is no use here: it is
 * flat, and a camera hanging at 3.6 m looks straight over the presses and
 * counters that block it. Only the built walls can stop a beam.
 */
export function beamHit(
  level: Level,
  tops: Float32Array,
  cell: CellXY,
  height: number,
  reach: number,
  facingDeg: number,
): BeamHit {
  const rad = (facingDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cs = level.cellSize;
  const ox = cell[0] + 0.5;
  const oy = cell[1] + 0.5;
  const own = cell[1] * level.w + cell[0];
  const span = reach - BEAM_START;
  const step = cs * 0.5;
  for (let t = BEAM_START; t <= reach; t += step) {
    const cx = Math.floor(ox + (dx * t) / cs);
    const cy = Math.floor(oy + (dy * t) / cs);
    if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) break;
    const i = cy * level.w + cx;
    // Never stop on the camera's own cell: plenty of them are bracketed to a wall.
    if (i === own || tops[i] <= 0) continue;
    const y = height * (1 - (t - BEAM_START) / span);
    if (tops[i] <= y) continue;
    // Stop at the near face of the cell rather than at its centre, so the beam
    // lands on the plaster instead of a hand's width inside it.
    const end = Math.max(BEAM_START + 0.2, t - cs * 0.5);
    return { x: end, y: height * (1 - (end - BEAM_START) / span), wall: true };
  }
  return { x: reach, y: 0, wall: false };
}

/** Lay the shaft and its spot along the beam, given where it ends. */
function shapeBeam(rig: BeamRig, hit: BeamHit): void {
  const dx = hit.x - BEAM_START;
  const dy = hit.y - rig.height;
  const len = Math.hypot(dx, dy);
  rig.shaft.rotation.z = Math.atan2(-dx, dy);
  rig.shaft.position.set(BEAM_START + dx / 2, dy / 2, 0);
  rig.shaft.scale.y = len;
  if (hit.wall) {
    // A dot on the plaster, stood up to face back down the beam.
    rig.spot.rotation.set(0, -Math.PI / 2, 0);
    rig.spot.position.set(hit.x - 0.03, dy, 0);
  } else {
    rig.spot.rotation.set(-Math.PI / 2, 0, 0);
    rig.spot.position.set(hit.x, dy + 0.03, 0);
  }
}

export function buildBuilding(level: Level, models: ModelLib): BuildingView {
  const root = new Group();
  root.name = 'building';
  makeFloors(level, root);

  const cs = level.cellSize;
  const fullBuckets: BufferGeometry[] = [];
  const cutBuckets: BufferGeometry[] = [];

  const exfil = level.json.exfil;
  const holeSkip = new Set<number>();
  // The stretch that comes down is wider than the gap you walk through: a wall
  // does not fail neatly, and a 6-metre shell standing over the hole would hide
  // the van from the only camera angle the visitor has.
  const span = exfil
    ? {
        x: Math.max(0, exfil.hole[0] - HOLE_SPREAD),
        y: exfil.hole[1],
        w: exfil.hole[2] + HOLE_SPREAD * 2,
        h: exfil.hole[3],
      }
    : null;
  if (span) {
    for (let y = span.y; y < span.y + span.h; y++) {
      for (let x = span.x; x < span.x + span.w; x++) holeSkip.add(y * level.w + x);
    }
  }

  for (const run of wallRuns(level, holeSkip)) {
    // A run can mix shell and interior cells, so split it by classification.
    let seg = 0;
    while (seg < run.len) {
      const startX = run.x + seg;
      const info = shellFacing(level, startX, run.y);
      let len = 1;
      while (seg + len < run.len) {
        const nInfo = shellFacing(level, run.x + seg + len, run.y);
        if (nInfo.shell !== info.shell || nInfo.nx !== info.nx || nInfo.ny !== info.ny) break;
        len++;
      }
      const w = len * cs;
      const cx = fineXYToWorldX(level, startX + len / 2);
      const cz = fineXYToWorldZ(level, run.y + 0.5);
      const fullH = info.shell ? EXTERIOR_WALL_H : INTERIOR_WALL_H;
      fullBuckets.push(box(w, fullH, cs, cx, fullH / 2, cz));
      // The gameplay camera looks from the south-east, so shell walls facing
      // that way are cut down to a stub and the interior stays visible.
      const nearSide = info.shell && (info.nx > 0 || info.ny > 0);
      const cutH = nearSide ? STUB_WALL_H : fullH;
      cutBuckets.push(box(w, cutH, cs, cx, cutH / 2, cz));
      seg += len;
    }
  }

  const mergeWalls = (geoms: BufferGeometry[]) => {
    const merged = mergeGeometries(geoms, false);
    for (const g of geoms) g.dispose();
    const wall = surfaces().plaster;
    if (merged) worldUV(merged, wall.metres);
    const m = new Mesh(merged ?? new BoxGeometry(0.01, 0.01, 0.01), wall.material);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const shellFull = mergeWalls(fullBuckets);
  const shellCut = mergeWalls(cutBuckets);
  shellFull.visible = false;

  // The breach: the wall as it stands, and the same wall after it has come
  // down. Two meshes swapped by `setHole`, because a hole cannot be cut out of
  // a merged geometry at runtime.
  let holeWall: Mesh | null = null;
  let holeBroken: Group | null = null;
  if (exfil && span) {
    const gapX0 = fineXYToWorldX(level, exfil.hole[0]);
    const gapX1 = fineXYToWorldX(level, exfil.hole[0] + exfil.hole[2]);
    const spanZ = fineXYToWorldZ(level, span.y + span.h / 2);
    const depth = span.h * cs;
    const intact: BufferGeometry[] = [];
    for (let x = span.x; x < span.x + span.w; x++) {
      intact.push(box(cs, EXTERIOR_WALL_H, depth, fineXYToWorldX(level, x + 0.5), EXTERIOR_WALL_H / 2, spanZ));
    }
    const wall = surfaces().plaster;
    const intactGeo = mergeGeometries(intact, false);
    for (const g of intact) g.dispose();
    if (intactGeo) {
      worldUV(intactGeo, wall.metres);
      holeWall = new Mesh(intactGeo, wall.material);
      holeWall.castShadow = true;
      holeWall.receiveShadow = true;
      root.add(holeWall);
    }

    // What is left afterwards: two stubs of broken masonry either side of the
    // gap, stepped down so the top edge reads as torn rather than sawn, and
    // rubble on the floor both sides of it.
    holeBroken = new Group();
    holeBroken.visible = false;
    const brokenGeo: BufferGeometry[] = [];
    const rubble: BufferGeometry[] = [];
    for (let x = span.x; x < span.x + span.w; x++) {
      const wx = fineXYToWorldX(level, x + 0.5);
      if (wx > gapX0 - cs * 0.5 && wx < gapX1 + cs * 0.5) continue;
      // Nearer the gap, less is left standing.
      const away = Math.min(Math.abs(wx - gapX0), Math.abs(wx - gapX1));
      const h = HOLE_STUB_H + Math.min(1.5, away * 1.1);
      brokenGeo.push(box(cs, h, depth, wx, h / 2, spanZ));
    }
    const brokenMerged = mergeGeometries(brokenGeo, false);
    for (const g of brokenGeo) g.dispose();
    if (brokenMerged) {
      worldUV(brokenMerged, wall.metres);
      const m = new Mesh(brokenMerged, wall.material);
      m.castShadow = true;
      m.receiveShadow = true;
      holeBroken.add(m);
    }
    const gapMidX = (gapX0 + gapX1) / 2;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const r = 0.55 + (i % 3) * 0.42;
      const sz = 0.16 + ((i * 7) % 5) * 0.05;
      rubble.push(
        box(sz, sz * 0.7, sz, gapMidX + Math.cos(a) * r, sz * 0.35, spanZ + Math.sin(a) * (r + 0.5), a),
      );
    }
    const rubbleMerged = mergeGeometries(rubble, false);
    for (const g of rubble) g.dispose();
    if (rubbleMerged) {
      worldUV(rubbleMerged, wall.metres);
      const m = new Mesh(rubbleMerged, wall.material);
      m.castShadow = true;
      m.receiveShadow = true;
      holeBroken.add(m);
    }
    root.add(holeBroken);
  }

  // Props, merged by material.
  const propBuckets = new Map<MatKey, Bucket>();
  const modelProps: Object3D[] = [];
  const namedProps = new Map<string, Object3D>();
  // The presses the money is lifted from have to stay individual objects: the
  // mission glow outlines one of them at a time, and there is nothing to
  // outline once four presses are one mesh. Four extra draw calls.
  const wanted = new Set((level.json.exfil?.presses ?? []).map((c) => `${c[0]},${c[1]}`));
  for (const p of level.json.props) {
    const before = modelProps.length;
    propGeometry(level, p, propBuckets, models, modelProps);
    const key = `${p.cell[0]},${p.cell[1]}`;
    if (p.kind === 'press' && wanted.has(key) && modelProps.length > before) {
      const own = modelProps.splice(before);
      const g = new Group();
      for (const o of own) g.add(o);
      root.add(g);
      namedProps.set(`press:${key}`, g);
    }
  }
  mergeBuckets(propBuckets, root);
  // Static props bake down to one mesh per material; the scene stays cheap.
  root.updateMatrixWorld(true);
  mergeStatic(modelProps, root);

  // Doors swing on a hinge at their edge, like doors do, and the vault gets a
  // real slab filling the opening. Without one the doorway reads as permanently
  // open however locked it actually is.
  const doors = new Map<number, Object3D>();
  const doorHinges = new Map<number, Object3D>();
  const doorLeaves = new Map<number, Mesh>();
  let vaultWheel: Object3D | null = null;
  let vaultDoor: Object3D | null = null;

  level.doors.forEach((d, i) => {
    const [rx, ry, rw, rh] = d.rect;
    const pivot = new Group();
    pivot.position.set(fineXYToWorldX(level, rx + rw / 2), 0, fineXYToWorldZ(level, ry + rh / 2));
    const spanX = rw * cs;
    const spanZ = rh * cs;
    const wide = rw >= rh;
    const width = wide ? spanX : spanZ;

    // Hinge at one edge; the leaf sits back over the opening.
    const hinge = new Group();
    const leafRoot = new Group();
    if (wide) {
      hinge.position.x = -width / 2;
      leafRoot.position.x = width / 2;
    } else {
      hinge.position.z = -width / 2;
      leafRoot.position.z = width / 2;
      hinge.rotation.y = Math.PI / 2;
      leafRoot.rotation.y = -Math.PI / 2;
    }

    let leaf: Mesh;
    const vaultModel = d.kind === 'vault' ? models.props.get('vaultDoor') : undefined;
    if (d.kind === 'vault' && vaultModel) {
      // The Blender door: slab plus frame, a child named "Wheel" to spin.
      const height = 2.45;
      const inst = vaultModel.clone(true);
      inst.scale.setScalar((width + 0.16) / 2.36);
      // Face the leaf along the opening's normal, like the box version.
      inst.rotation.y = 0;
      leaf = new Mesh(new BoxGeometry(width - 0.12, height, 0.5), mat('metal'));
      leaf.visible = false;
      leaf.position.y = height / 2;
      const wheel = inst.getObjectByName('Wheel') ?? null;
      vaultWheel = wheel;
      leafRoot.add(leaf, inst);
      vaultDoor = pivot;
    } else if (d.kind === 'vault') {
      const height = 2.45;
      leaf = new Mesh(new BoxGeometry(width - 0.12, height, 0.5), mat('metal'));
      leaf.position.y = height / 2;
      leaf.castShadow = true;
      const rim = new Mesh(new TorusGeometry(width * 0.34, 0.09, 8, 26), mat('brass'));
      rim.position.set(0, height * 0.54, 0.28);
      const wheel = new Mesh(new CylinderGeometry(width * 0.2, width * 0.2, 0.18, 28), mat('metal'));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(0, height * 0.54, 0.34);
      const spokes = new Mesh(new TorusGeometry(width * 0.14, 0.055, 6, 16), mat('brass'));
      spokes.rotation.x = Math.PI / 2;
      spokes.position.set(0, height * 0.54, 0.42);
      const hub = new Group();
      hub.add(wheel, spokes);
      vaultWheel = hub;
      leafRoot.add(leaf, rim, hub);
      vaultDoor = pivot;
    } else {
      const height = 2.3;
      leaf = new Mesh(
        new BoxGeometry(width - 0.08, height, 0.16),
        mat(d.kind === 'gate' ? 'metal' : 'wood'),
      );
      leaf.position.y = height / 2;
      leaf.castShadow = true;
      const handle = new Mesh(new SphereGeometry(0.09, 8, 6), mat('brass'));
      handle.position.set(width * 0.36, height * 0.46, 0.14);
      leafRoot.add(leaf, handle);
    }

    doorLeaves.set(i, leaf);
    hinge.add(leafRoot);
    pivot.add(hinge);
    doorHinges.set(i, hinge);
    pivot.userData.doorIndex = i;
    root.add(pivot);
    doors.set(i, pivot);
  });

  // Keycards and portal mouths.
  // The vault card: a stand, a slowly turning badge and a shaft of light, so it
  // is findable across a dim hall without a label pointing at it.
  const keycards = new Map<number, KeycardView>();
  level.json.keycards.forEach((k, i) => {
    const g = new Group();
    const kind = k.kind ?? 'card';
    if (kind !== 'card') {
      // Fixtures: a coat stand with a uniform on it, or a grey fuse box with a lever.
      let card: Mesh;
      if (kind === 'uniform') {
        const stand = new Mesh(new CylinderGeometry(0.05, 0.05, 1.9, 8), mat('brass'));
        stand.position.y = 0.95;
        const foot = new Mesh(new CylinderGeometry(0.3, 0.34, 0.06, 12), mat('dark'));
        foot.position.y = 0.03;
        card = new Mesh(new BoxGeometry(0.55, 0.8, 0.28), mat('police'));
        card.position.y = 1.35;
        const cap = new Mesh(new CylinderGeometry(0.16, 0.18, 0.1, 12), mat('police'));
        cap.position.y = 1.95;
        g.add(stand, foot, card, cap);
      } else {
        card = new Mesh(new BoxGeometry(0.7, 0.9, 0.22), mat('metal'));
        card.position.y = 1.35;
        const lever = new Mesh(new BoxGeometry(0.08, 0.34, 0.08), mat('emissiveRed'));
        lever.position.set(0.18, 1.5, 0.15);
        lever.rotation.z = -0.5;
        const led = new Mesh(new SphereGeometry(0.05, 8, 6), mat('emissiveRed'));
        led.position.set(-0.2, 1.62, 0.13);
        const conduit = new Mesh(new CylinderGeometry(0.04, 0.04, 1.4, 8), mat('dark'));
        conduit.position.set(0, 2.5, 0);
        g.add(card, lever, led, conduit);
      }
      card.castShadow = true;
      const beam = new Mesh(new CylinderGeometry(0.16, 0.34, 2.2, 14, 1, true), mat('beamGold'));
      beam.position.y = 2.2;
      const halo = new Mesh(new CircleGeometry(0.6, 24), mat('beamGold'));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.12;
      g.add(beam, halo);
      g.position.set(fineXYToWorldX(level, k.cell[0] + 0.5), 0, fineXYToWorldZ(level, k.cell[1] + 0.5));
      root.add(g);
      keycards.set(i, { root: g, card, beam, halo });
      return;
    }

    const post = new Mesh(new CylinderGeometry(0.07, 0.09, 0.82, 10), mat('metal'));
    post.position.y = 0.41;
    post.castShadow = true;
    const base = new Mesh(new CylinderGeometry(0.3, 0.34, 0.09, 16), mat('dark'));
    base.position.y = 0.045;
    base.receiveShadow = true;
    const tray = new Mesh(new CylinderGeometry(0.24, 0.2, 0.06, 16), mat('brass'));
    tray.position.y = 0.85;

    const card = new Mesh(new BoxGeometry(0.44, 0.025, 0.3), mat('emissiveGold'));
    card.position.y = 1.12;
    card.castShadow = true;
    const stripe = new Mesh(new BoxGeometry(0.44, 0.03, 0.07), mat('dark'));
    stripe.position.set(0, 1.12, 0.09);
    card.add(stripe);
    stripe.position.set(0, 0, 0.09);

    const beam = new Mesh(new CylinderGeometry(0.16, 0.3, 2.2, 14, 1, true), mat('beamGold'));
    beam.position.y = 1.9;
    const halo = new Mesh(new CircleGeometry(0.55, 24), mat('beamGold'));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.12;

    g.add(base, post, tray, card, beam, halo);
    g.position.set(fineXYToWorldX(level, k.cell[0] + 0.5), 0, fineXYToWorldZ(level, k.cell[1] + 0.5));
    root.add(g);
    keycards.set(i, { root: g, card, beam, halo });
  });

  // Cameras: a stem up to the ceiling and a housing that turns with the sweep,
  // so the red cone visibly comes from a device rather than from nowhere.
  const cameras = new Map<number, Object3D>();
  const cameraLeds = new Map<number, Mesh>();
  const cameraBeams = new Map<number, Object3D>();
  const beamRigs = new Map<number, BeamRig>();
  level.json.cameras.forEach((c, i) => {
    const pivot = new Group();
    const height = c.height ?? 3.6;

    // A short mount, not a flagpole; matte so it does not pick up the warm
    // interior light and read as red.
    const stem = new Mesh(new CylinderGeometry(0.045, 0.045, 0.62, 8), mat('dark'));
    stem.position.y = 0.31;
    stem.castShadow = true;
    const plate = new Mesh(new CylinderGeometry(0.2, 0.2, 0.06, 12), mat('dark'));
    plate.position.y = 0.62;

    const housing = new Mesh(new BoxGeometry(0.58, 0.28, 0.28), mat('dark'));
    housing.position.set(0.08, 0, 0);
    housing.castShadow = true;
    const hood = new Mesh(new BoxGeometry(0.34, 0.05, 0.34), mat('metal'));
    hood.position.set(0.22, 0.17, 0);

    const lens = new Mesh(new CylinderGeometry(0.1, 0.12, 0.1, 14), mat('lens'));
    lens.rotation.z = Math.PI / 2;
    lens.position.set(0.4, 0, 0);

    const led = new Mesh(new SphereGeometry(0.045, 8, 6), mat('emissiveRed'));
    led.position.set(0.26, 0.13, 0.08);
    cameraLeds.set(i, led);

    // The beam: lens to the point its range reaches on the floor. Built in the
    // pivot's frame, where local +x is whichever way the camera is looking, so
    // it sweeps with the housing for free. It is a unit cylinder scaled to
    // length, because `aimBeam` reshapes it every frame as the sweep brings
    // walls in and out of the way.
    const beams = new Group();
    const shaft = new Mesh(new CylinderGeometry(0.022, 0.05, 1, 6, 1, true), mat('beamRed'));
    const spot = new Mesh(new CircleGeometry(0.32, 16), mat('beamRed'));
    beams.add(shaft, spot);
    cameraBeams.set(i, beams);
    beamRigs.set(i, { shaft, spot, height, reach: Math.min(c.range, BEAM_REACH), cell: c.cell });

    pivot.add(stem, plate, housing, hood, lens, led, beams);
    pivot.position.set(
      fineXYToWorldX(level, c.cell[0] + 0.5),
      height,
      fineXYToWorldZ(level, c.cell[1] + 0.5),
    );
    pivot.rotation.y = (-c.facingDeg * Math.PI) / 180;
    root.add(pivot);
    cameras.set(i, pivot);
  });

  const portalMarks = new Map<string, Object3D>();
  for (const p of level.json.portals) {
    for (const [tag, cell] of [
      ['from', p.from],
      ['to', p.to],
    ] as const) {
      const g = new Group();
      const isSewer = p.kind === 'sewer';
      const ring = new Mesh(
        isSewer ? new CylinderGeometry(0.75, 0.75, 0.14, 16) : new BoxGeometry(1.2, 0.12, 1.2),
        mat('metal'),
      );
      ring.position.y = 0.07;
      g.add(ring);
      const grate = new Mesh(new CircleGeometry(0.6, 14), mat('dark'));
      grate.rotation.x = -Math.PI / 2;
      grate.position.y = 0.15;
      g.add(grate);
      g.position.set(fineXYToWorldX(level, cell[0] + 0.5), 0, fineXYToWorldZ(level, cell[1] + 0.5));
      root.add(g);
      portalMarks.set(`${p.id}:${tag}`, g);
    }
  }

  // Wall-height maps, because both the cutaway and the breach change what a
  // beam can hit. The vault camera sweeps straight across the breach, so a
  // beam still stopping at a wall that has come down would give the game away.
  const tops = { full: wallTops(level, false), cut: wallTops(level, true) };
  const broken = { full: Float32Array.from(tops.full), cut: Float32Array.from(tops.cut) };
  for (const i of holeSkip) {
    broken.full[i] = HOLE_STUB_H;
    broken.cut[i] = HOLE_STUB_H;
  }
  let cutaway = shellCut.visible;
  let holeIsOpen = false;
  const aimBeam = (index: number, facingDeg: number): void => {
    const rig = beamRigs.get(index);
    if (!rig) return;
    const set = holeIsOpen ? broken : tops;
    shapeBeam(rig, beamHit(level, cutaway ? set.cut : set.full, rig.cell, rig.height, rig.reach, facingDeg));
  };
  // Point them once at their resting angle, so the first frame is not a beam
  // through a wall waiting to be corrected.
  level.json.cameras.forEach((c, i) => aimBeam(i, c.facingDeg));

  return {
    root,
    shellFull,
    shellCut,
    doors,
    doorHinges,
    doorLeaves,
    vaultWheel,
    cameras,
    cameraLeds,
    cameraBeams,
    aimBeam,
    breachWall: holeWall,
    namedProps,
    setHole(open: boolean) {
      holeIsOpen = open;
      if (holeWall) holeWall.visible = !open;
      if (holeBroken) holeBroken.visible = open;
    },
    vaultDoor,
    keycards,
    portalMarks,
    setCutaway(cut: boolean) {
      cutaway = cut;
      shellCut.visible = cut;
      shellFull.visible = !cut;
    },
  };
}
