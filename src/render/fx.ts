import {
  AdditiveBlending,
  AlwaysStencilFunc,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  BufferAttribute,
  BackSide,
  Box3,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  DynamicDrawUsage,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  RingGeometry,
  CylinderGeometry,
  Object3D,
  Vector3,
  CircleGeometry,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fineXYToWorldX, fineXYToWorldZ, type Level } from '../level/loader';
import { coneSamples, type ConeSample } from '../level/visibility';
import type { Plan } from '../planner/types';
import { planCellCenterX, planCellCenterY } from '../sim/planFollow';
import { PALETTE } from './palette';
import { secretDocumentTexture } from './documents';

/** A vision cone clipped against the walls it actually cannot see through. */
/** How wide the bright band along the far edge of a cone is, in world units. */
const RIM_WIDTH = 0.46;

export class VisionCone {
  readonly mesh: Mesh;
  /** A bright band along the outer arc. A washed fill is easy to miss on a
   *  pale marble floor; an edge is what makes the shape read. */
  private rim: Mesh;
  private geo: BufferGeometry;
  private pos: Float32Array;
  private attr: BufferAttribute;
  private rimGeo: BufferGeometry;
  private rimPos: Float32Array;
  private rimAttr: BufferAttribute;
  private material: MeshBasicMaterial;
  private rimMaterial: MeshBasicMaterial;
  private samples: ConeSample[] = [];
  private pts: number[] = [];

  constructor(color: number = PALETTE.gold) {
    this.geo = new BufferGeometry();
    this.pos = new Float32Array(256 * 9);
    this.attr = new BufferAttribute(this.pos, 3);
    this.attr.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', this.attr);
    this.material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new Mesh(this.geo, this.material);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;

    this.rimGeo = new BufferGeometry();
    this.rimPos = new Float32Array(256 * 18);
    this.rimAttr = new BufferAttribute(this.rimPos, 3);
    this.rimAttr.setUsage(DynamicDrawUsage);
    this.rimGeo.setAttribute('position', this.rimAttr);
    this.rimMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.rim = new Mesh(this.rimGeo, this.rimMaterial);
    this.rim.renderOrder = 7;
    this.rim.frustumCulled = false;
    // A child, so it inherits the cone's visibility and needs no extra wiring.
    this.mesh.add(this.rim);
  }

  setColor(hex: number, opacity: number, rimHex = hex, rimOpacity = 0.9): void {
    this.material.color.setHex(hex);
    this.material.opacity = opacity;
    this.rimMaterial.color.setHex(rimHex);
    this.rimMaterial.opacity = rimOpacity;
  }

  private ensure(triangles: number): void {
    const needed = triangles * 9;
    if (this.pos.length >= needed) return;
    this.pos = new Float32Array(needed * 2);
    this.attr = new BufferAttribute(this.pos, 3);
    this.attr.setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', this.attr);
  }

  private ensureRim(quads: number): void {
    const needed = quads * 18;
    if (this.rimPos.length >= needed) return;
    this.rimPos = new Float32Array(needed * 2);
    this.rimAttr = new BufferAttribute(this.rimPos, 3);
    this.rimAttr.setUsage(DynamicDrawUsage);
    this.rimGeo.setAttribute('position', this.rimAttr);
  }

  update(
    level: Level,
    opaque: Uint8Array,
    ox: number,
    oy: number,
    facingDeg: number,
    fovDeg: number,
    rangeCells: number,
  ): void {
    const y = 0.055;
    const cx = fineXYToWorldX(level, ox);
    const cz = fineXYToWorldZ(level, oy);
    const samples = coneSamples(
      opaque,
      level.w,
      level.h,
      ox,
      oy,
      facingDeg,
      fovDeg,
      rangeCells,
      this.samples,
    );
    this.ensure(Math.max(1, samples.length - 1));
    this.ensureRim(Math.max(1, samples.length - 1));

    // The arc in world coordinates, reused for both the fill and the edge.
    const pts = this.pts;
    pts.length = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      pts.push(
        fineXYToWorldX(level, ox + Math.cos(s.angle) * s.dist),
        fineXYToWorldZ(level, oy + Math.sin(s.angle) * s.dist),
      );
    }

    let p = 0;
    for (let i = 1; i < samples.length; i++) {
      const ax = pts[(i - 1) * 2];
      const az = pts[(i - 1) * 2 + 1];
      const bx = pts[i * 2];
      const bz = pts[i * 2 + 1];
      this.pos[p++] = cx;
      this.pos[p++] = y;
      this.pos[p++] = cz;
      this.pos[p++] = ax;
      this.pos[p++] = y;
      this.pos[p++] = az;
      this.pos[p++] = bx;
      this.pos[p++] = y;
      this.pos[p++] = bz;
    }
    // Draw only the triangles actually built; no degenerate leftovers.
    this.geo.setDrawRange(0, p / 3);
    this.attr.needsUpdate = true;
    this.geo.computeBoundingSphere();

    // The band: each arc segment pulled back toward the cone's origin.
    const pull = (px: number, pz: number): [number, number] => {
      const dx = px - cx;
      const dz = pz - cz;
      const d = Math.hypot(dx, dz);
      if (d <= 1e-4) return [px, pz];
      const k = Math.max(0, d - RIM_WIDTH) / d;
      return [cx + dx * k, cz + dz * k];
    };
    let r = 0;
    const ry = y + 0.008;
    for (let i = 1; i < samples.length; i++) {
      const ax = pts[(i - 1) * 2];
      const az = pts[(i - 1) * 2 + 1];
      const bx = pts[i * 2];
      const bz = pts[i * 2 + 1];
      const [aix, aiz] = pull(ax, az);
      const [bix, biz] = pull(bx, bz);
      const quad = [ax, az, bx, bz, bix, biz, ax, az, bix, biz, aix, aiz];
      for (let k = 0; k < quad.length; k += 2) {
        this.rimPos[r++] = quad[k];
        this.rimPos[r++] = ry;
        this.rimPos[r++] = quad[k + 1];
      }
    }
    this.rimGeo.setDrawRange(0, r / 3);
    this.rimAttr.needsUpdate = true;
    this.rimGeo.computeBoundingSphere();
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
    this.rimGeo.dispose();
    this.rimMaterial.dispose();
  }
}

/** Thin red lines showing routes the planner committed to. */
export class RouteTrails {
  readonly object: Group;
  private lines: LineSegments;
  private material: LineBasicMaterial;
  /** One or two routes are drawn as bold dots; a swarm stays as fine lines. */
  private dots: Mesh;
  private dotMaterial: MeshBasicMaterial;

  constructor() {
    this.material = new LineBasicMaterial({
      color: PALETTE.redBright,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.lines = new LineSegments(new BufferGeometry(), this.material);
    this.lines.renderOrder = 3;
    this.lines.frustumCulled = false;
    this.dotMaterial = new MeshBasicMaterial({
      color: PALETTE.redBright,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.dots = new Mesh(new BufferGeometry(), this.dotMaterial);
    this.dots.renderOrder = 3;
    this.dots.frustumCulled = false;
    this.object = new Group();
    this.object.add(this.lines, this.dots);
  }

  setOpacity(v: number): void {
    this.material.opacity = v;
    this.dotMaterial.opacity = Math.min(1, v * 2);
  }

  show(level: Level, plans: Plan[], limit = 24): void {
    const pts: number[] = [];
    const n = Math.min(plans.length, limit);
    const dotGeoms: BufferGeometry[] = [];
    const asDots = n <= 2;
    for (let i = 0; i < n; i++) {
      const nodes = plans[i].nodes;
      for (let k = 1; k < nodes.length; k++) {
        const a = nodes[k - 1];
        const b = nodes[k];
        if (a.cell === b.cell) continue;
        if (asDots) {
          const g = new CircleGeometry(0.26, 10);
          g.rotateX(-Math.PI / 2);
          g.translate(
            fineXYToWorldX(level, planCellCenterX(level, b.cell)),
            0.1,
            fineXYToWorldZ(level, planCellCenterY(level, b.cell)),
          );
          dotGeoms.push(g);
        }
        pts.push(
          fineXYToWorldX(level, planCellCenterX(level, a.cell)),
          0.09,
          fineXYToWorldZ(level, planCellCenterY(level, a.cell)),
          fineXYToWorldX(level, planCellCenterX(level, b.cell)),
          0.09,
          fineXYToWorldZ(level, planCellCenterY(level, b.cell)),
        );
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = geo;
    this.lines.visible = !asDots;
    this.dots.geometry.dispose();
    const merged = dotGeoms.length ? mergeGeometries(dotGeoms, false) : null;
    for (const g of dotGeoms) g.dispose();
    this.dots.geometry = merged ?? new BufferGeometry();
    this.dots.visible = asDots && !!merged;
  }

  clear(): void {
    this.lines.geometry.dispose();
    this.lines.geometry = new BufferGeometry();
    this.dots.geometry.dispose();
    this.dots.geometry = new BufferGeometry();
  }
}

/** Classified pages scattering as documents are reached or extracted. */
export class MoneyBurst {
  readonly mesh: InstancedMesh;
  private vel: Float32Array;
  private pos: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private dummy = new Object3D();
  private cursor = 0;
  readonly capacity: number;

  constructor(capacity = 260) {
    this.capacity = capacity;
    const geo = new PlaneGeometry(0.26, 0.35);
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      map: secretDocumentTexture(),
      side: DoubleSide,
      transparent: true,
      opacity: 0.96,
    });
    this.mesh = new InstancedMesh(geo, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = capacity;
    this.vel = new Float32Array(capacity * 3);
    this.pos = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    const hide = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, hide);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  burst(x: number, y: number, z: number, count = 60): void {
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 1.2;
      this.pos[i * 3 + 1] = y + Math.random() * 0.4;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 1.2;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.6 + Math.random() * 2.6;
      this.vel[i * 3] = Math.cos(a) * sp * 0.5;
      this.vel[i * 3 + 1] = 3.4 + Math.random() * 3.2;
      this.vel[i * 3 + 2] = Math.sin(a) * sp * 0.5;
      this.spin[i * 3] = (Math.random() - 0.5) * 9;
      this.spin[i * 3 + 1] = (Math.random() - 0.5) * 9;
      this.spin[i * 3 + 2] = (Math.random() - 0.5) * 9;
      this.life[i] = 2.6 + Math.random() * 1.6;
    }
  }

  update(dt: number): void {
    const hide = new Matrix4().makeScale(0, 0, 0);
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, hide);
        continue;
      }
      any = true;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 6.2 * dt;
      this.vel[i * 3] *= 0.985;
      this.vel[i * 3 + 2] *= 0.985;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05) {
        this.pos[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] = 0;
        this.vel[i * 3] *= 0.8;
        this.vel[i * 3 + 2] *= 0.8;
      }
      this.dummy.position.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.dummy.rotation.set(
        this.spin[i * 3] * (3 - this.life[i]),
        this.spin[i * 3 + 1] * (3 - this.life[i]),
        this.spin[i * 3 + 2] * (3 - this.life[i]),
      );
      this.dummy.scale.setScalar(Math.min(1, this.life[i]));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Ground ring used to mark the selected guard or the player. */
export function makeMarkerRing(color: number, inner = 0.5, outer = 0.68): Mesh {
  const g = new RingGeometry(inner, outer, 28);
  g.rotateX(-Math.PI / 2);
  const m = new Mesh(
    g,
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  m.renderOrder = 4;
  m.position.y = 0.05;
  return m;
}

/** Soft pulsing disc used for objective and hint markers. */
export class Pulse {
  readonly mesh: Mesh;
  private t = 0;

  constructor(color: number) {
    const g = new RingGeometry(0.35, 1.4, 32);
    g.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(
      g,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.mesh.renderOrder = 4;
    this.mesh.position.y = 0.06;
    this.mesh.visible = false;
  }

  setAt(x: number, z: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    this.t += dt;
    const s = 0.75 + Math.sin(this.t * 3.4) * 0.22;
    this.mesh.scale.setScalar(s);
    (this.mesh.material as MeshBasicMaterial).opacity = 0.28 + Math.sin(this.t * 3.4) * 0.18;
  }
}

/**
 * A glowing green outline around whatever the mission board is currently asking
 * for. Green because nothing else in the building is: the alarm and the thieves
 * are red, the guards amber, the cameras teal, and the gold is money. A colour
 * with no other job cannot be misread as one.
 *
 * Built as an inverted hull: the object's own geometry, pushed out along its
 * normals and drawn back-faces-only. An unexpanded stencil mask of all selected
 * surfaces removes the internal outlines: wheels, handles and clothing details
 * cannot paint green over the object itself. No full-screen outline pass needed.
 *
 * Two hulls per object — a solid green edge and a wider faint one — because a
 * single line reads as a diagram and the wide one is what makes it a glow. The
 * bloom in the composer does the rest.
 *
 * The hulls are children of the object they outline, so a swinging door, a
 * lorry on its round and a van pulling up all carry their own highlight.
 */
const OUTLINE_TIGHT = 0.10;
const OUTLINE_WIDE = 0.18;

export class OutlineGlow {
  /** Surface masks and outline hulls for every object we have highlighted. */
  private built = new Map<Object3D, Mesh[]>();
  private live: Mesh[] = [];
  private t = 0;

  /** Light exactly these, and nothing else. */
  set(objects: Object3D[]): void {
    for (const m of this.live) m.visible = false;
    this.live = [];
    for (const o of objects) {
      const hulls = this.hullsFor(o);
      for (const h of hulls) {
        h.visible = true;
        this.live.push(h);
      }
    }
  }

  clear(): void {
    this.set([]);
  }

  /** Only the halo breathes; the solid edge stays fully opaque. */
  update(dt: number): void {
    if (!this.live.length) return;
    this.t += dt;
    const k = 0.72 + Math.sin(this.t * 1.9) * 0.28;
    for (const m of this.live) {
      const base = m.userData.baseOpacity as number;
      (m.material as MeshBasicMaterial).opacity = base === 1 ? 1 : base * (0.55 + k * 0.45);
    }
  }

  dispose(): void {
    for (const hulls of this.built.values()) {
      for (const m of hulls) {
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
        m.removeFromParent();
      }
    }
    this.built.clear();
    this.live = [];
  }

  private hullsFor(source: Object3D): Mesh[] {
    const cached = this.built.get(source);
    if (cached) return cached;
    const footprint = source.userData.highlightFootprint as
      { circular: boolean; radius: number; y: number } | undefined;
    if (footprint) {
      const hulls = [OUTLINE_TIGHT, OUTLINE_WIDE].map((width, i) => {
        // Four segments form a square vent border; a sewer gets a round one.
        const factor = footprint.circular ? 1 : Math.SQRT2;
        const geo = new RingGeometry(
          footprint.radius * factor,
          (footprint.radius + width) * factor,
          footprint.circular ? 64 : 4,
          1,
          footprint.circular ? 0 : Math.PI / 4,
        );
        geo.rotateX(-Math.PI / 2);
        const opacity = i === 0 ? 1 : 0.18;
        const mesh = new Mesh(geo, new MeshBasicMaterial({
          color: PALETTE.highlight,
          side: DoubleSide,
          transparent: true,
          opacity,
          toneMapped: false,
          depthWrite: false,
          blending: NormalBlending,
        }));
        mesh.position.y = footprint.y + (i === 0 ? 0.002 : 0);
        mesh.userData.baseOpacity = opacity;
        mesh.renderOrder = i === 0 ? 3 : 2;
        mesh.visible = false;
        source.add(mesh);
        return mesh;
      });
      this.built.set(source, hulls);
      return hulls;
    }
    source.updateMatrixWorld(true);
    // Size the swell from the whole object, so one thing gets one outline
    // weight, including its handles and other small parts.
    const bounds = new Box3().setFromObject(source);
    const span = bounds.getSize(new Vector3()).length();
    const scale = Math.min(1.6, Math.max(0.65, span / 3));
    const hulls: Mesh[] = [];
    const worldScale = new Vector3();
    forEachSolid(source, (m) => {
      const geo = strippedGeometry(m);
      if (!geo) return;
      // Each hull hangs off the mesh it outlines, so a swinging door leaf, a
      // spinning vault wheel and a lorry on its round all carry their own. An
      // earlier version baked one hull per object in the object's frame, and
      // the front doors left their outline behind the moment they opened.
      m.getWorldScale(worldScale);
      const unit = Math.max(1e-4, (worldScale.x + worldScale.y + worldScale.z) / 3);
      // Mask the complete object before drawing any expanded hulls. Keeping
      // each mask on its source mesh follows swinging leaves and moving parts.
      const mask = new Mesh(geo.clone(), new MeshBasicMaterial({
        side: DoubleSide,
        transparent: true,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: AlwaysStencilFunc,
        stencilZPass: ReplaceStencilOp,
      }));
      mask.userData.baseOpacity = 1;
      mask.userData.outlineMask = true;
      mask.renderOrder = 1;
      mask.frustumCulled = false;
      mask.visible = false;
      m.add(mask);
      hulls.push(mask);
      for (const [swell, opacity] of [
        [OUTLINE_TIGHT * scale, 1],
        [OUTLINE_WIDE * scale, 0.18],
      ] as const) {
        const hull = geo.clone();
        swellAlongNormals(hull, swell / unit);
        const mesh = new Mesh(
          hull,
          new MeshBasicMaterial({
            color: PALETTE.highlight,
            side: BackSide,
            transparent: true,
            opacity,
            toneMapped: false,
            depthWrite: false,
            // Keep every objective's green outline visible on bright surfaces.
            blending: NormalBlending,
            // Only pixels outside the union of the original surfaces survive.
            stencilWrite: true,
            stencilRef: 1,
            stencilFunc: NotEqualStencilFunc,
          }),
        );
        mesh.userData.baseOpacity = opacity;
        mesh.renderOrder = 2;
        mesh.frustumCulled = false;
        mesh.visible = false;
        m.add(mesh);
        hulls.push(mesh);
      }
      geo.dispose();
    });
    this.built.set(source, hulls);
    return hulls;
  }
}

/** Every mesh under `source` that is matter rather than light. */
function forEachSolid(source: Object3D, fn: (m: Mesh) => void): void {
  source.traverse((o) => {
    const m = o as Mesh;
    // Skip anything that is already a hull, and anything skinned: an inverted
    // hull of a rigged mesh does not follow the pose.
    if (!m.isMesh || m.userData.baseOpacity !== undefined) return;
    if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    // Effects are not part of the thing. Everything in this game that is light
    // rather than matter — the card's beam, its halo, marker rings — turns
    // depth writing off, and a hull swelled around a beam is a pillar of light
    // where an outline of a keycard was wanted.
    const mm = m.material as MeshBasicMaterial | MeshBasicMaterial[];
    const one = Array.isArray(mm) ? mm[0] : mm;
    if (one && one.depthWrite === false) return;
    fn(m);
  });
}

/** A copy of one mesh's geometry carrying only what a hull needs. */
function strippedGeometry(m: Mesh): BufferGeometry | null {
  const g = m.geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position') g.deleteAttribute(name);
  }
  if (!g.attributes.position) return null;
  // Asset normals split at hard edges. Inflating those disconnected faces
  // leaves gaps at corners; weld positions before generating hull normals.
  const welded = mergeVertices(g);
  welded.computeVertexNormals();
  g.dispose();
  return welded;
}

/** Push every vertex out along its normal, which is what makes it a hull. */
function swellAlongNormals(geo: BufferGeometry, by: number): void {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  if (!nrm) return;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nrm.getX(i) * by,
      pos.getY(i) + nrm.getY(i) * by,
      pos.getZ(i) + nrm.getZ(i) * by,
    );
  }
  pos.needsUpdate = true;
}

export function makeFxGroup(): Group {
  const g = new Group();
  g.name = 'fx';
  return g;
}

export { Color as FxColor, Vector3 as FxVector3 };

/**
 * One flat coloured ribbon per distinct way in, drawn along the plan the AI
 * actually found. Bold enough to read from across a booth, one colour per door.
 */
export class WayRibbons {
  readonly object = new Group();
  private meshes: Mesh[] = [];

  constructor() {
    this.object.renderOrder = 3;
  }

  /** Rebuild all ribbons; `upTo` limits how many are shown, in order. */
  build(level: Level, ways: { plan: Plan; color: number }[], width = 0.42): void {
    this.clear();
    for (const w of ways) {
      const nodes = w.plan.nodes;
      const geoms: BufferGeometry[] = [];
      let px = 0;
      let pz = 0;
      let has = false;
      for (let k = 0; k < nodes.length; k++) {
        const n = nodes[k];
        const x = fineXYToWorldX(level, planCellCenterX(level, n.cell));
        const z = fineXYToWorldZ(level, planCellCenterY(level, n.cell));
        if (has && (x !== px || z !== pz)) {
          const dx = x - px;
          const dz = z - pz;
          const len = Math.hypot(dx, dz);
          const g = new PlaneGeometry(len, width);
          g.rotateX(-Math.PI / 2);
          g.rotateY(-Math.atan2(dz, dx));
          g.translate((x + px) / 2, 0.11, (z + pz) / 2);
          geoms.push(g);
          const cap = new CircleGeometry(width / 2, 8);
          cap.rotateX(-Math.PI / 2);
          cap.translate(x, 0.11, z);
          geoms.push(cap);
        }
        px = x;
        pz = z;
        has = true;
      }
      const merged = geoms.length ? mergeGeometries(geoms, false) : null;
      for (const g of geoms) g.dispose();
      if (!merged) continue;
      const m = new Mesh(
        merged,
        // Normal blending on purpose: additive colour on white marble is just white.
        new MeshBasicMaterial({
          color: w.color,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      m.renderOrder = 3;
      m.frustumCulled = false;
      m.visible = false;
      this.meshes.push(m);
      this.object.add(m);
    }
  }

  /** Show the first `n` ribbons; the rest stay hidden until their turn. */
  reveal(n: number): void {
    this.meshes.forEach((m, i) => (m.visible = i < n));
  }

  setOpacity(v: number): void {
    for (const m of this.meshes) (m.material as MeshBasicMaterial).opacity = v;
  }

  clear(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
      this.object.remove(m);
    }
    this.meshes = [];
  }
}
