import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Level } from '../level/loader';
import { PALETTE } from './palette';
import { mergeStatic, type ModelLib } from './models';
import { surfaces, worldUV } from './textures';

/**
 * The night city around the Mint. Nothing here is walkable or simulated; it
 * exists so the bank sits in a place rather than floating in a black void.
 * Everything is procedural boxes merged by material, a handful of draw calls.
 */
export interface CityView {
  root: Group;
  /** Rooftop beacons, blinked from the frame loop. */
  beacons: Mesh;
  update: (dtSec: number) => void;
}

// ------------------------------------------------------------- utilities

/** Deterministic random so the skyline is the same on every machine. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

/** A flat quad lying on the ground. */
function slab(w: number, d: number, x: number, z: number, y = 0, rotY = 0): BufferGeometry {
  const g = new PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

/** A vertical quad facing +z, then turned to face `facing` (0 = +z, PI/2 = +x). */
function pane(w: number, h: number, x: number, y: number, z: number, facing: number): BufferGeometry {
  const g = new PlaneGeometry(w, h);
  g.rotateY(facing);
  g.translate(x, y, z);
  return g;
}

/** Bucket keys that carry a world-mapped texture, and their repeat in metres. */
const TEXTURED: Record<string, number> = { road: 6, ground: 6, pavement: 5 };

class Buckets {
  private map = new Map<string, { m: MeshStandardMaterial; geoms: BufferGeometry[]; key: string }>();
  constructor(private defs: Record<string, MeshStandardMaterial>) {}
  push(key: string, g: BufferGeometry): void {
    let b = this.map.get(key);
    if (!b) {
      b = { m: this.defs[key], geoms: [], key };
      this.map.set(key, b);
    }
    b.geoms.push(g);
  }
  key(k: string): string {
    return k;
  }
  flush(parent: Object3D, castShadow: boolean, receiveShadow = true): Mesh[] {
    const out: Mesh[] = [];
    for (const b of this.map.values()) {
      if (!b.geoms.length) continue;
      const merged = mergeGeometries(b.geoms, false);
      for (const g of b.geoms) g.dispose();
      b.geoms = [];
      if (!merged) continue;
      const tex = TEXTURED[b.key];
      if (tex) worldUV(merged, tex);
      const m = new Mesh(merged, b.m);
      m.castShadow = castShadow;
      m.receiveShadow = receiveShadow;
      m.frustumCulled = false;
      parent.add(m);
      out.push(m);
    }
    return out;
  }
}

// ------------------------------------------------------------- materials

const M: Record<string, MeshStandardMaterial> = {
  ground: new MeshStandardMaterial({ color: 0x15151a, roughness: 0.97 }),
  road: new MeshStandardMaterial({ color: 0x1f2026, roughness: 0.94 }),
  kerb: new MeshStandardMaterial({ color: 0x3a3a3f, roughness: 0.9 }),
  pavement: new MeshStandardMaterial({ color: 0x2b2b31, roughness: 0.92 }),
  lane: new MeshStandardMaterial({
    color: 0xd9d2c2,
    emissive: 0xd9d2c2,
    emissiveIntensity: 0.22,
    roughness: 0.8,
  }),
  laneYellow: new MeshStandardMaterial({
    color: 0xc9a227,
    emissive: 0xc9a227,
    emissiveIntensity: 0.28,
    roughness: 0.8,
  }),
  zebra: new MeshStandardMaterial({ color: 0x8a867c, roughness: 0.9 }),
  facade: new MeshStandardMaterial({ color: 0x2a2b35, roughness: 0.92 }),
  facadeWarm: new MeshStandardMaterial({ color: 0x3a2e2a, roughness: 0.9 }),
  facadeDark: new MeshStandardMaterial({ color: 0x1a1b22, roughness: 0.95 }),
  skyline: new MeshStandardMaterial({ color: 0x0f1017, roughness: 1 }),
  trim: new MeshStandardMaterial({ color: 0x4a4b55, roughness: 0.85 }),
  windowLit: new MeshStandardMaterial({
    color: 0x8a7150,
    emissive: 0xffc97a,
    emissiveIntensity: 0.55,
    roughness: 0.5,
  }),
  windowCool: new MeshStandardMaterial({
    color: 0x5a6a80,
    emissive: 0x9ec4ff,
    emissiveIntensity: 0.4,
    roughness: 0.5,
  }),
  windowDark: new MeshStandardMaterial({ color: 0x0c0f16, roughness: 0.25, metalness: 0.35 }),
  pole: new MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6, metalness: 0.6 }),
  lampHead: new MeshStandardMaterial({
    color: 0xffd9a0,
    emissive: 0xffc678,
    emissiveIntensity: 2.6,
    roughness: 0.4,
  }),
  carDark: new MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.35, metalness: 0.5 }),
  carNavy: new MeshStandardMaterial({ color: 0x1c2a4a, roughness: 0.35, metalness: 0.5 }),
  carGrey: new MeshStandardMaterial({ color: 0x5a5d66, roughness: 0.4, metalness: 0.5 }),
  carRed: new MeshStandardMaterial({ color: PALETTE.redDark, roughness: 0.35, metalness: 0.5 }),
  carGlass: new MeshStandardMaterial({ color: 0x0f141c, roughness: 0.15, metalness: 0.6 }),
  tail: new MeshStandardMaterial({
    color: 0xff2a2a,
    emissive: 0xff2a2a,
    emissiveIntensity: 1.4,
    roughness: 0.5,
  }),
  head: new MeshStandardMaterial({
    color: 0xfff4d6,
    emissive: 0xfff4d6,
    emissiveIntensity: 0.9,
    roughness: 0.5,
  }),
  beacon: new MeshStandardMaterial({
    color: PALETTE.redBright,
    emissive: PALETTE.redBright,
    emissiveIntensity: 2.2,
    roughness: 0.5,
  }),
  neonRed: new MeshStandardMaterial({
    color: PALETTE.redBright,
    emissive: PALETTE.redBright,
    emissiveIntensity: 1.8,
    roughness: 0.5,
  }),
  neonGold: new MeshStandardMaterial({
    color: PALETTE.gold,
    emissive: PALETTE.gold,
    emissiveIntensity: 1.6,
    roughness: 0.5,
  }),
};

// ------------------------------------------------------------- sky

function makeSky(): { dome: Mesh; stars: Points } {
  const dome = new Mesh(
    new SphereGeometry(900, 24, 12),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Color(0x04050b) },
        uMid: { value: new Color(0x0b0b16) },
        uHorizon: { value: new Color(0x2a1a22) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uZenith;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.05, 1.0);
          // City glow hugs the horizon and dies fast; the zenith stays black.
          vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.14, h));
          c = mix(c, uZenith, smoothstep(0.14, 0.7, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -10;

  const r = rng(7);
  const n = 700;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Upper hemisphere only, biased away from the horizon where the glow is.
    const az = r() * Math.PI * 2;
    const el = 0.12 + Math.pow(r(), 0.7) * (Math.PI / 2 - 0.12);
    const d = 820;
    pos[i * 3] = Math.cos(az) * Math.cos(el) * d;
    pos[i * 3 + 1] = Math.sin(el) * d;
    pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * d;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  const stars = new Points(
    g,
    new PointsMaterial({
      color: 0xdfe6ff,
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.55,
      fog: false,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  return { dome, stars };
}

// ------------------------------------------------------------- buildings

interface Lot {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Which way the lit face points: toward the bank. */
  facing: number;
}

function addBuilding(
  b: Buckets,
  r: () => number,
  lot: Lot,
  height: number,
  opts: { windowRate: number; detail: boolean; skyline?: boolean },
  beacons: BufferGeometry[],
): void {
  const { x, z, w, d } = lot;
  const facadeKey = opts.skyline
    ? 'skyline'
    : r() < 0.3
      ? 'facadeWarm'
      : r() < 0.5
        ? 'facadeDark'
        : 'facade';
  b.push(facadeKey, box(w, height, d, x, height / 2, z));
  if (opts.detail) {
    // A cornice and a slab of roof plant, so the tops are not bare boxes.
    b.push('trim', box(w + 0.5, 0.35, d + 0.5, x, height + 0.17, z));
    if (r() < 0.6) {
      const pw = 1.5 + r() * 2.5;
      b.push('trim', box(pw, 1.2, pw, x + (r() - 0.5) * (w - pw), height + 0.95, z + (r() - 0.5) * (d - pw)));
    }
    if (r() < 0.35) {
      // Water tank on a little frame, the New York silhouette everyone knows.
      const tx = x + (r() - 0.5) * (w - 3);
      const tz = z + (r() - 0.5) * (d - 3);
      b.push('trim', box(0.15, 1.4, 0.15, tx - 0.9, height + 0.7, tz - 0.9));
      b.push('trim', box(0.15, 1.4, 0.15, tx + 0.9, height + 0.7, tz - 0.9));
      b.push('trim', box(0.15, 1.4, 0.15, tx - 0.9, height + 0.7, tz + 0.9));
      b.push('trim', box(0.15, 1.4, 0.15, tx + 0.9, height + 0.7, tz + 0.9));
      b.push('facadeWarm', new CylinderGeometry(1.1, 1.0, 2.2, 10).translate(tx, height + 2.4, tz));
      b.push('trim', new CylinderGeometry(0.2, 1.15, 0.5, 10).translate(tx, height + 3.7, tz));
    }
  }
  if (height > 26 && r() < 0.7) {
    beacons.push(new SphereGeometry(0.35, 8, 6).translate(x, height + (opts.detail ? 1.2 : 0.6), z));
  }

  // Windows on every face, thinned on the faces that look away from the bank.
  const floorH = 3.2;
  const floors = Math.floor((height - 1.5) / floorH);
  const faces: { facing: number; len: number; cx: number; cz: number; nx: number; nz: number }[] = [
    { facing: 0, len: w, cx: x, cz: z + d / 2, nx: 0, nz: 1 },
    { facing: Math.PI, len: w, cx: x, cz: z - d / 2, nx: 0, nz: -1 },
    { facing: Math.PI / 2, len: d, cx: x + w / 2, cz: z, nx: 1, nz: 0 },
    { facing: -Math.PI / 2, len: d, cx: x - w / 2, cz: z, nx: -1, nz: 0 },
  ];
  for (const f of faces) {
    // Faces pointing toward the origin (the bank) get the full treatment.
    const toward = f.nx * -Math.sign(x || 1) > 0 || f.nz * -Math.sign(z || 1) > 0;
    const rate = opts.windowRate * (toward ? 1 : 0.35);
    const cols = Math.max(1, Math.floor(f.len / 2.2));
    const pitch = f.len / cols;
    const ww = Math.min(1.0, pitch * 0.42);
    const wh = 1.3;
    for (let fl = 0; fl < floors; fl++) {
      const y = 2.2 + fl * floorH;
      for (let c = 0; c < cols; c++) {
        const t = (c + 0.5) / cols - 0.5;
        const px = f.cx + (f.nz !== 0 ? t * f.len : 0) + f.nx * 0.03;
        const pz = f.cz + (f.nx !== 0 ? -t * f.len * Math.sign(f.nx) * -1 : 0) + f.nz * 0.03;
        const v = r();
        const key = v < rate ? (r() < 0.2 ? 'windowCool' : 'windowLit') : 'windowDark';
        if (key === 'windowDark' && opts.skyline) continue;
        b.push(key, pane(ww, wh, px, y, pz, f.facing));
      }
    }
  }
}

// ------------------------------------------------------------- streets

interface Ring {
  /** Half extents of the bank lot. */
  hw: number;
  hd: number;
  kerb: number;
  pave: number;
  road: number;
}

function addStreets(b: Buckets, ring: Ring): void {
  const { hw, hd, kerb, pave, road } = ring;
  const inner = { x: hw + kerb, z: hd + kerb };
  const paveOut = { x: inner.x + pave, z: inner.z + pave };
  const roadOut = { x: paveOut.x + road, z: paveOut.z + road };
  const farPave = { x: roadOut.x + pave, z: roadOut.z + pave };

  // Near kerb: a low lip around the bank's own asphalt.
  const lip = 0.14;
  b.push('kerb', box(inner.x * 2, lip, kerb, 0, lip / 2, hd + kerb / 2));
  b.push('kerb', box(inner.x * 2, lip, kerb, 0, lip / 2, -(hd + kerb / 2)));
  b.push('kerb', box(kerb, lip, hd * 2, hw + kerb / 2, lip / 2, 0));
  b.push('kerb', box(kerb, lip, hd * 2, -(hw + kerb / 2), lip / 2, 0));

  // Near pavement ring, raised a hair over the road.
  const ph = 0.1;
  b.push('pavement', box(paveOut.x * 2, ph, pave, 0, ph / 2, inner.z + pave / 2));
  b.push('pavement', box(paveOut.x * 2, ph, pave, 0, ph / 2, -(inner.z + pave / 2)));
  b.push('pavement', box(pave, ph, inner.z * 2, inner.x + pave / 2, ph / 2, 0));
  b.push('pavement', box(pave, ph, inner.z * 2, -(inner.x + pave / 2), ph / 2, 0));

  // Road ring.
  b.push('road', slab(roadOut.x * 2, road, 0, paveOut.z + road / 2, 0.005));
  b.push('road', slab(roadOut.x * 2, road, 0, -(paveOut.z + road / 2), 0.005));
  b.push('road', slab(road, paveOut.z * 2, paveOut.x + road / 2, 0, 0.005));
  b.push('road', slab(road, paveOut.z * 2, -(paveOut.x + road / 2), 0, 0.005));

  // Far pavement ring, under the buildings.
  b.push('pavement', box(farPave.x * 2, ph, pave, 0, ph / 2, roadOut.z + pave / 2));
  b.push('pavement', box(farPave.x * 2, ph, pave, 0, ph / 2, -(roadOut.z + pave / 2)));
  b.push('pavement', box(pave, ph, roadOut.z * 2, roadOut.x + pave / 2, ph / 2, 0));
  b.push('pavement', box(pave, ph, roadOut.z * 2, -(roadOut.x + pave / 2), ph / 2, 0));

  // Lane markings: a dashed centre line and solid edge lines.
  const dash = 2.2;
  const gap = 2.2;
  const y = 0.012;
  const mid = { x: paveOut.x + road / 2, z: paveOut.z + road / 2 };
  for (const sz of [1, -1]) {
    for (let x = -roadOut.x + 3; x < roadOut.x - 3; x += dash + gap) {
      b.push('laneYellow', slab(dash, 0.16, x + dash / 2, sz * mid.z, y));
    }
    b.push('lane', slab(paveOut.x * 2, 0.12, 0, sz * (paveOut.z + 0.5), y));
    b.push('lane', slab(paveOut.x * 2, 0.12, 0, sz * (roadOut.z - 0.5), y));
  }
  for (const sx of [1, -1]) {
    for (let z = -roadOut.z + 3; z < roadOut.z - 3; z += dash + gap) {
      b.push('laneYellow', slab(0.16, dash, sx * mid.x, z + dash / 2, y));
    }
    b.push('lane', slab(0.12, paveOut.z * 2, sx * (paveOut.x + 0.5), 0, y));
    b.push('lane', slab(0.12, paveOut.z * 2, sx * (roadOut.x - 0.5), 0, y));
  }

  // Zebra crossings in front of the main entrance and at the back.
  for (const sz of [1, -1]) {
    for (let i = -3; i <= 3; i++) {
      b.push('zebra', slab(0.5, road - 2.4, i * 1.1, sz * mid.z, y + 0.002));
    }
  }
}

function addStreetlights(
  b: Buckets,
  ring: Ring,
  parent: Object3D,
  lights: number,
): void {
  const { hw, hd, kerb, pave } = ring;
  const edgeX = hw + kerb + pave - 0.6;
  const edgeZ = hd + kerb + pave - 0.6;
  const spots: { x: number; z: number; rot: number }[] = [];
  const stepX = 12;
  for (let x = -hw + 4; x <= hw - 4; x += stepX) {
    spots.push({ x, z: edgeZ, rot: 0 });
    spots.push({ x, z: -edgeZ, rot: Math.PI });
  }
  for (let z = -hd + 6; z <= hd - 6; z += stepX) {
    spots.push({ x: edgeX, z, rot: -Math.PI / 2 });
    spots.push({ x: -edgeX, z, rot: Math.PI / 2 });
  }
  const H = 6.4;
  for (const s of spots) {
    b.push('pole', new CylinderGeometry(0.09, 0.13, H, 8).translate(s.x, H / 2, s.z));
    // Arm reaches over the road (away from the bank).
    const ax = Math.sin(s.rot) * 0;
    const dz = Math.cos(s.rot) * 1.1;
    const dx = -Math.sin(s.rot) * 1.1;
    b.push('pole', box(0.1, 0.1, 2.2, s.x + dx + ax, H - 0.1, s.z + dz, s.rot));
    b.push('lampHead', box(0.5, 0.18, 0.9, s.x + dx * 2, H - 0.22, s.z + dz * 2, s.rot));
  }
  // Real light from a few of the poles only; emissive heads carry the rest.
  const pick = spots.filter((_, i) => i % Math.max(1, Math.round(spots.length / lights)) === 0).slice(0, lights);
  for (const s of pick) {
    const l = new PointLight(0xffc678, 9, 20, 1.8);
    l.position.set(s.x - Math.sin(s.rot) * 2, H - 0.4, s.z + Math.cos(s.rot) * 2);
    parent.add(l);
  }
}

function addCars(b: Buckets, ring: Ring, r: () => number, models: ModelLib, parent: Object3D): void {
  const carInstances: Object3D[] = [];
  const carKeys = ['car', 'suv', 'car', 'policeCar', 'suv', 'car'].filter((k) => models.props.has(k));
  const bodyTints = [0x1b1d24, 0x1c2a4a, 0x5a5d66, 0x2a2a30, PALETTE.redDark, 0x3a3f4a];
  const { hw, hd, kerb, pave, road } = ring;
  const paveOut = { x: hw + kerb + pave, z: hd + kerb + pave };
  const bodies = ['carDark', 'carNavy', 'carGrey', 'carDark', 'carRed', 'carDark'];
  const car = (x: number, z: number, rot: number) => {
    if (carKeys.length) {
      const key = carKeys[Math.floor(r() * carKeys.length)];
      const inst = models.props.get(key)!.clone(true);
      inst.position.set(x, 0, z);
      inst.rotation.y = rot + (r() < 0.5 ? 0 : Math.PI);
      if (key !== 'policeCar') {
        const tint = bodyTints[Math.floor(r() * bodyTints.length)];
        inst.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          m.material = mats.map((mm) => {
            const std = mm as MeshStandardMaterial;
            if (/LightBlue|White|Grey|Material/.test(std.name) && !/Window|Head|Tail/.test(std.name)) {
              const c = std.clone();
              c.color.setHex(tint);
              return c;
            }
            return mm;
          }) as MeshStandardMaterial[];
          if (!Array.isArray(m.material) || m.material.length === 1) m.material = (m.material as MeshStandardMaterial[])[0];
        });
      }
      carInstances.push(inst);
      return;
    }
    const key = bodies[Math.floor(r() * bodies.length)];
    const L = 4.4;
    const W = 1.9;
    b.push(key, box(L, 0.55, W, x, 0.55, z, rot));
    b.push(key, box(L * 0.55, 0.5, W * 0.9, x, 1.05, z, rot));
    b.push('carGlass', box(L * 0.5, 0.42, W * 0.92, x, 1.06, z, rot));
    for (const [ax, az] of [
      [0.32, 0.5],
      [-0.32, 0.5],
      [0.32, -0.5],
      [-0.32, -0.5],
    ] as const) {
      const wx = x + Math.cos(rot) * L * ax - Math.sin(rot) * W * az;
      const wz = z - Math.sin(rot) * L * ax - Math.cos(rot) * W * az;
      b.push('pole', new CylinderGeometry(0.34, 0.34, 0.25, 10).rotateZ(Math.PI / 2).rotateY(-rot).translate(wx, 0.34, wz));
    }
    // Lights: which end is "front" is random, and it reads either way.
    const f = r() < 0.5 ? 1 : -1;
    const cx = Math.cos(rot);
    const cz = -Math.sin(rot);
    for (const side of [1, -1]) {
      const sx = -cz * side * 0.7;
      const sz = cx * side * 0.7;
      b.push('tail', box(0.12, 0.16, 0.34, x - cx * L * 0.5 * f + sx, 0.6, z - cz * L * 0.5 * f + sz, rot));
      b.push('head', box(0.12, 0.16, 0.3, x + cx * L * 0.5 * f + sx, 0.6, z + cz * L * 0.5 * f + sz, rot));
    }
  };
  // Parked along both kerbs of each street, with gaps so it does not look like a car park.
  for (const sz of [1, -1]) {
    for (let x = -paveOut.x + 6; x < paveOut.x - 6; x += 6.5) {
      if (Math.abs(x) < 9 && sz === 1) continue; // keep the entrance clear
      if (r() < 0.45) car(x, sz * (paveOut.z + 1.6), 0);
      if (r() < 0.35) car(x, sz * (paveOut.z + road - 1.6), 0);
    }
  }
  for (const sx of [1, -1]) {
    for (let z = -paveOut.z + 6; z < paveOut.z - 6; z += 6.5) {
      if (r() < 0.45) car(sx * (paveOut.x + 1.6), z, Math.PI / 2);
      if (r() < 0.35) car(sx * (paveOut.x + road - 1.6), z, Math.PI / 2);
    }
  }
  parent.updateMatrixWorld(true);
  mergeStatic(carInstances, parent);
}

function addSignage(b: Buckets, ring: Ring, r: () => number, lots: Lot[]): void {
  // A few neon signs on the nearest facades: a bar, a hotel, a pharmacy cross.
  let placed = 0;
  for (const lot of lots) {
    if (placed >= 4) break;
    if (r() < 0.6) continue;
    const key = r() < 0.5 ? 'neonRed' : 'neonGold';
    const y = 5 + r() * 4;
    const along = 2.5 + r() * 3;
    // Sign as a slim bar hung off the face that looks at the bank.
    if (Math.abs(lot.z) > Math.abs(lot.x)) {
      const face = lot.z > 0 ? lot.z - lot.d / 2 : lot.z + lot.d / 2;
      b.push(key, box(along, 0.5, 0.18, lot.x + (r() - 0.5) * (lot.w - along), y, face + (lot.z > 0 ? -0.12 : 0.12)));
    } else {
      const face = lot.x > 0 ? lot.x - lot.w / 2 : lot.x + lot.w / 2;
      b.push(key, box(0.18, 0.5, along, face + (lot.x > 0 ? -0.12 : 0.12), y, lot.z + (r() - 0.5) * (lot.d - along)));
    }
    placed++;
  }
  void ring;
}

// ------------------------------------------------------------- main

export function buildCity(level: Level, models: ModelLib): CityView {
  const lib = surfaces();
  M.road = lib.asphalt.material.clone();
  M.road.color.setHex(0x8a8a90);
  M.ground = lib.asphalt.material.clone();
  M.ground.color.setHex(0x707076);
  M.pavement = lib.concrete.material.clone();
  M.pavement.color.setHex(0x6a6a70);
  const root = new Group();
  root.name = 'city';
  const r = rng(1312);
  const hw = (level.w * level.cellSize) / 2;
  const hd = (level.h * level.cellSize) / 2;
  const ring: Ring = { hw, hd, kerb: 0.6, pave: 3.2, road: 11 };

  // Ground to the horizon, under everything.
  const groundGeo = new PlaneGeometry(1400, 1400, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  worldUV(groundGeo, 6);
  const ground = new Mesh(groundGeo, M.ground);
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  root.add(ground);

  const { dome, stars } = makeSky();
  root.add(dome, stars);

  const near = new Buckets(M);
  addStreets(near, ring);
  addStreetlights(near, ring, root, 8);
  addCars(near, ring, r, models, root);
  near.flush(root, true);

  // Camera budget: the attract shot orbits the whole way round at roughly
  // radius 65 and height 40, so the first row stays low (2-4 floors) and the
  // taller second row starts outside that circle, across a back street.
  const far = new Buckets(M);
  const beaconGeoms: BufferGeometry[] = [];
  const edgeX = hw + ring.kerb + ring.pave * 2 + ring.road; // far pavement's outer edge
  const edgeZ = hd + ring.kerb + ring.pave * 2 + ring.road;
  const row1Depth = 20;
  const backRoad = ring.road;
  const row2Depth = 22;
  const row2Z = edgeZ + row1Depth + ring.pave + backRoad + ring.pave;
  const row2X = edgeX + row1Depth + ring.pave + backRoad + ring.pave;

  // Back streets between the rows, so the second row stands on something.
  const streets = new Buckets(M);
  const bx0 = edgeX + row1Depth;
  const bz0 = edgeZ + row1Depth;
  for (const s of [1, -1]) {
    const zc = s * (bz0 + ring.pave + backRoad / 2);
    streets.push('road', slab(row2X * 2, backRoad, 0, zc, 0.005));
    streets.push('pavement', box(row2X * 2, 0.1, ring.pave, 0, 0.05, s * (bz0 + ring.pave / 2)));
    streets.push('pavement', box(row2X * 2, 0.1, ring.pave, 0, 0.05, s * (row2Z - ring.pave / 2)));
    for (let x = -row2X + 3; x < row2X - 3; x += 4.4) streets.push('laneYellow', slab(2.2, 0.16, x + 1.1, zc, 0.012));
    const xc = s * (bx0 + ring.pave + backRoad / 2);
    streets.push('road', slab(backRoad, bz0 * 2, xc, 0, 0.005));
    streets.push('pavement', box(ring.pave, 0.1, bz0 * 2, s * (bx0 + ring.pave / 2), 0.05, 0));
    streets.push('pavement', box(ring.pave, 0.1, bz0 * 2, s * (row2X - ring.pave / 2), 0.05, 0));
    for (let z = -bz0 + 3; z < bz0 - 3; z += 4.4) streets.push('laneYellow', slab(0.16, 2.2, xc, z + 1.1, 0.012));
  }
  streets.flush(root, false);

  const lots: Lot[] = [];
  const fill = (from: number, to: number, place: (pos: number, size: number) => Lot) => {
    let p = from;
    while (p < to - 4) {
      const size = 8 + r() * 10;
      const gapW = r() < 0.25 ? 2.5 : 0.6;
      if (p + size > to) break;
      lots.push(place(p + size / 2, size));
      p += size + gapW;
    }
  };
  // First row: south and north run the long way, east and west fill between.
  const spanX = edgeX + row1Depth;
  fill(-spanX, spanX, (pos, size) => ({ x: pos, z: edgeZ + row1Depth / 2, w: size, d: row1Depth, facing: Math.PI }));
  fill(-spanX, spanX, (pos, size) => ({ x: pos, z: -(edgeZ + row1Depth / 2), w: size, d: row1Depth, facing: 0 }));
  fill(-edgeZ, edgeZ, (pos, size) => ({ x: edgeX + row1Depth / 2, z: pos, w: row1Depth, d: size, facing: -Math.PI / 2 }));
  fill(-edgeZ, edgeZ, (pos, size) => ({ x: -(edgeX + row1Depth / 2), z: pos, w: row1Depth, d: size, facing: Math.PI / 2 }));
  for (const lot of lots) {
    const h = 6.5 + Math.pow(r(), 1.4) * 7.5;
    addBuilding(far, r, lot, h, { windowRate: 0.3, detail: true }, beaconGeoms);
  }
  addSignage(far, ring, r, lots);

  // Second row: taller and denser, outside the orbit.
  const back: Lot[] = [];
  const spanX2 = row2X + row2Depth;
  for (let p = -spanX2; p < spanX2 - 6; ) {
    const size = 10 + r() * 14;
    back.push({ x: p + size / 2, z: row2Z + row2Depth / 2, w: size, d: row2Depth, facing: Math.PI });
    back.push({ x: p + size / 2, z: -(row2Z + row2Depth / 2), w: size, d: row2Depth, facing: 0 });
    p += size + 1.5;
  }
  for (let p = -row2Z; p < row2Z - 6; ) {
    const size = 10 + r() * 14;
    back.push({ x: row2X + row2Depth / 2, z: p + size / 2, w: row2Depth, d: size, facing: -Math.PI / 2 });
    back.push({ x: -(row2X + row2Depth / 2), z: p + size / 2, w: row2Depth, d: size, facing: Math.PI / 2 });
    p += size + 1.5;
  }
  for (const lot of back) {
    const h = 16 + Math.pow(r(), 1.3) * 22;
    addBuilding(far, r, lot, h, { windowRate: 0.22, detail: r() < 0.5 }, beaconGeoms);
  }
  far.flush(root, false);

  // Distant skyline: tall silhouettes with a scatter of lit windows, mostly
  // eaten by the fog so they read as a city, not as more boxes.
  const sky = new Buckets(M);
  const ringR = 165;
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + r() * 0.1;
    const dist = ringR + r() * 60;
    const w = 12 + r() * 20;
    const h = 30 + Math.pow(r(), 0.8) * 80;
    addBuilding(
      sky,
      r,
      { x: Math.cos(a) * dist, z: Math.sin(a) * dist * 0.75, w, d: w, facing: 0 },
      h,
      { windowRate: 0.12, detail: false, skyline: true },
      beaconGeoms,
    );
  }
  sky.flush(root, false, false);

  const beaconGeo = beaconGeoms.length ? mergeGeometries(beaconGeoms, false) : new SphereGeometry(0.01);
  for (const g of beaconGeoms) g.dispose();
  const beacons = new Mesh(beaconGeo!, M.beacon.clone());
  beacons.frustumCulled = false;
  root.add(beacons);

  let t = 0;
  return {
    root,
    beacons,
    update(dtSec: number) {
      t += dtSec;
      // Slow aviation blink, all in phase: it reads as one city breathing.
      const m = beacons.material as MeshStandardMaterial;
      m.emissiveIntensity = 0.6 + 1.8 * Math.max(0, Math.sin(t * 2.2)) ** 6;
    },
  };
}
