import { makeScratch, type AStarScratch } from './grid';
import type {
  CellXY,
  DoorDef,
  FloorKind,
  LevelJson,
  PortalDef,
  PropDef,
  Rect,
} from './schema';
import { validateLevel } from './schema';

export const FLOOR_KINDS: FloorKind[] = ['marble', 'concrete', 'wood', 'asphalt', 'grate'];

/** Props that block sight as well as movement. */
const SIGHT_BLOCKING_PROPS = new Set<PropDef['kind']>([
  'press',
  'truck',
  'crate',
  'cabinet',
  'statue',
  'column',
  'teller',
  'moneyStack',
]);

export const DEFAULT_PROP_RADIUS: Partial<Record<PropDef['kind'], number>> = {
  column: 0.9,
  desk: 1.6,
  press: 2.2,
  plant: 0.7,
  crate: 1.2,
  truck: 3.2,
  lamp: 0.4,
  bench: 1.2,
  teller: 2.0,
  sofa: 1.4,
  cabinet: 1.1,
  moneyStack: 0.9,
  statue: 0.9,
};

export interface RuntimePortal {
  def: PortalDef;
  fromPlan: number;
  toPlan: number;
  fromFine: number;
  toFine: number;
  quanta: number;
}

export interface Level {
  json: LevelJson;
  id: string;
  w: number;
  h: number;
  cellSize: number;
  stride: number;
  pw: number;
  ph: number;
  cellCount: number;
  planCount: number;

  /** Fine grid, 1 = an agent may stand here. */
  walk: Uint8Array;
  /** Fine grid, 1 = blocks line of sight. */
  opaque: Uint8Array;
  /** Fine grid, 1 = built structure (wall or shell), before any furniture. */
  wall: Uint8Array;
  /** Fine grid eroded by one cell: where a body half a metre wide fits without clipping. */
  walkGuard: Uint8Array;
  /** Fine grid, 1 = inside the building. */
  indoor: Uint8Array;
  areaAt: Int16Array;
  floorAt: Uint8Array;
  doorAt: Int16Array;
  keyAt: Int16Array;

  /** Plan grid (coarse), 1 = the planner may route through here. */
  pwalk: Uint8Array;
  pdoorAt: Int16Array;
  pkeyAt: Int16Array;
  pindoor: Uint8Array;
  portalsFrom: Map<number, RuntimePortal[]>;
  portals: RuntimePortal[];

  doors: DoorDef[];
  doorIndex: Map<string, number>;
  vaultPlanCell: number;
  vaultFineCell: number;

  scratch: AStarScratch;
}

export function idx(l: Pick<Level, 'w'>, x: number, y: number): number {
  return y * l.w + x;
}

export function cellX(l: Pick<Level, 'w'>, i: number): number {
  return i % l.w;
}

export function cellY(l: Pick<Level, 'w'>, i: number): number {
  return (i / l.w) | 0;
}

export function fineToWorld(l: Level, i: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  const x = i % l.w;
  const y = (i / l.w) | 0;
  out.x = (x + 0.5) * l.cellSize - (l.w * l.cellSize) / 2;
  out.z = (y + 0.5) * l.cellSize - (l.h * l.cellSize) / 2;
  return out;
}

export function fineXYToWorldX(l: Level, x: number): number {
  return x * l.cellSize - (l.w * l.cellSize) / 2;
}

export function fineXYToWorldZ(l: Level, y: number): number {
  return y * l.cellSize - (l.h * l.cellSize) / 2;
}

export function worldToFine(l: Level, wx: number, wz: number): number {
  const x = Math.floor((wx + (l.w * l.cellSize) / 2) / l.cellSize);
  const y = Math.floor((wz + (l.h * l.cellSize) / 2) / l.cellSize);
  if (x < 0 || y < 0 || x >= l.w || y >= l.h) return -1;
  return y * l.w + x;
}

export function planToWorld(l: Level, p: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  const px = p % l.pw;
  const py = (p / l.pw) | 0;
  const size = l.cellSize * l.stride;
  out.x = (px + 0.5) * size - (l.w * l.cellSize) / 2;
  out.z = (py + 0.5) * size - (l.h * l.cellSize) / 2;
  return out;
}

export function fineToPlan(l: Level, i: number): number {
  const x = ((i % l.w) / l.stride) | 0;
  const y = (((i / l.w) | 0) / l.stride) | 0;
  return y * l.pw + x;
}

export function planToFine(l: Level, p: number): number {
  const px = (p % l.pw) * l.stride + (l.stride >> 1);
  const py = ((p / l.pw) | 0) * l.stride + (l.stride >> 1);
  return py * l.w + px;
}

export function cellOf(l: Level, c: CellXY): number {
  return c[1] * l.w + c[0];
}

function fillRect(target: { [i: number]: number }, w: number, r: Rect, value: number): void {
  for (let y = r[1]; y < r[1] + r[3]; y++) {
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      target[y * w + x] = value;
    }
  }
}

export function buildLevel(json: LevelJson): Level {
  const errs = validateLevel(json);
  if (errs.length) throw new Error(`Invalid level ${json.id}:\n  ${errs.join('\n  ')}`);

  const { w, h, cellSize, planStride: stride } = json.grid;
  const cellCount = w * h;
  const walk = new Uint8Array(cellCount);
  const indoor = new Uint8Array(cellCount);
  const areaAt = new Int16Array(cellCount).fill(-1);
  const floorAt = new Uint8Array(cellCount);
  const doorAt = new Int16Array(cellCount).fill(-1);
  const keyAt = new Int16Array(cellCount).fill(-1);

  // 1. Carve areas.
  json.areas.forEach((a, ai) => {
    const floorId = Math.max(0, FLOOR_KINDS.indexOf(a.floor));
    for (let y = a.rect[1]; y < a.rect[1] + a.rect[3]; y++) {
      for (let x = a.rect[0]; x < a.rect[0] + a.rect[2]; x++) {
        const i = y * w + x;
        walk[i] = 1;
        areaAt[i] = ai;
        floorAt[i] = floorId;
        indoor[i] = a.kind === 'outdoor' ? 0 : 1;
      }
    }
  });

  // 2. Openings punch through walls (arches, gaps).
  for (const o of json.openings) {
    for (let y = o.rect[1]; y < o.rect[1] + o.rect[3]; y++) {
      for (let x = o.rect[0]; x < o.rect[0] + o.rect[2]; x++) {
        const i = y * w + x;
        walk[i] = 1;
        if (areaAt[i] < 0) {
          indoor[i] = 1;
          floorAt[i] = FLOOR_KINDS.indexOf('marble');
        }
      }
    }
  }

  // 3. Door cells are walkable but gated.
  const doors = json.doors.map((d) => ({
    ...d,
    lockpickQuanta: d.lockpickQuanta ?? json.rules.defaultLockpickQuanta,
  }));
  doors.forEach((d, di) => {
    for (let y = d.rect[1]; y < d.rect[1] + d.rect[3]; y++) {
      for (let x = d.rect[0]; x < d.rect[0] + d.rect[2]; x++) {
        const i = y * w + x;
        walk[i] = 1;
        doorAt[i] = di;
        if (areaAt[i] < 0) {
          floorAt[i] = FLOOR_KINDS.indexOf('marble');
          indoor[i] = 1;
        }
      }
    }
  });

  // 4. Walls are everything still unwalkable; they block sight. Kept as its own
  // grid because this, and not the walk grid, is what the renderer builds walls
  // from: a crate is unwalkable too, and plastering over it is not a wall.
  const opaque = new Uint8Array(cellCount);
  const wall = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    opaque[i] = walk[i] ? 0 : 1;
    wall[i] = opaque[i];
  }

  // 5. Solid props carve out of the walk grid.
  for (const p of json.props) {
    if (!p.solid) continue;
    const radius = (p.radius ?? DEFAULT_PROP_RADIUS[p.kind] ?? 0.8) / cellSize;
    const blocksSight = SIGHT_BLOCKING_PROPS.has(p.kind);
    const cx = p.cell[0] + 0.5;
    const cy = p.cell[1] + 0.5;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(w - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(h - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * w + x;
        if (doorAt[i] >= 0) continue; // never block a doorway with furniture
        walk[i] = 0;
        if (blocksSight) opaque[i] = 1;
      }
    }
  }

  json.keycards.forEach((k, ki) => {
    keyAt[k.cell[1] * w + k.cell[0]] = ki;
  });

  // Guards route on a grid shrunk by one cell so they walk down the middle of
  // corridors instead of dragging a shoulder through the plaster.
  const walkGuard = new Uint8Array(cellCount);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!walk[i]) continue;
      const ok =
        (x === 0 || walk[i - 1]) &&
        (x === w - 1 || walk[i + 1]) &&
        (y === 0 || walk[i - w]) &&
        (y === h - 1 || walk[i + w]);
      walkGuard[i] = ok ? 1 : 0;
    }
  }

  // 6. Coarse planning grid: a plan cell is usable only when every fine cell under it is.
  const pw = (w / stride) | 0;
  const ph = (h / stride) | 0;
  const planCount = pw * ph;
  const pwalk = new Uint8Array(planCount);
  const pdoorAt = new Int16Array(planCount).fill(-1);
  const pkeyAt = new Int16Array(planCount).fill(-1);
  const pindoor = new Uint8Array(planCount);
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      let ok = 1;
      let door = -1;
      let key = -1;
      let ind = 0;
      for (let sy = 0; sy < stride; sy++) {
        for (let sx = 0; sx < stride; sx++) {
          const i = (py * stride + sy) * w + (px * stride + sx);
          if (!walk[i]) ok = 0;
          if (doorAt[i] >= 0) door = doorAt[i];
          if (keyAt[i] >= 0) key = keyAt[i];
          if (indoor[i]) ind = 1;
        }
      }
      const p = py * pw + px;
      pwalk[p] = ok;
      pdoorAt[p] = door;
      pkeyAt[p] = key;
      pindoor[p] = ind;
    }
  }

  const level: Level = {
    json,
    id: json.id,
    w,
    h,
    cellSize,
    stride,
    pw,
    ph,
    cellCount,
    planCount,
    walk,
    opaque,
    wall,
    walkGuard,
    indoor,
    areaAt,
    floorAt,
    doorAt,
    keyAt,
    pwalk,
    pdoorAt,
    pkeyAt,
    pindoor,
    portalsFrom: new Map(),
    portals: [],
    doors,
    doorIndex: new Map(doors.map((d, i) => [d.id, i])),
    vaultPlanCell: 0,
    vaultFineCell: 0,
    scratch: makeScratch(cellCount),
  };

  level.vaultFineCell = cellOf(level, json.vault.cell);
  level.vaultPlanCell = fineToPlan(level, level.vaultFineCell);

  for (const def of json.portals) {
    const fromFine = cellOf(level, def.from);
    const toFine = cellOf(level, def.to);
    const rp: RuntimePortal = {
      def,
      fromFine,
      toFine,
      fromPlan: fineToPlan(level, fromFine),
      toPlan: fineToPlan(level, toFine),
      quanta: def.traverseQuanta,
    };
    level.portals.push(rp);
    pushPortal(level, rp.fromPlan, rp);
    if (def.bidirectional) {
      const back: RuntimePortal = {
        def,
        fromFine: toFine,
        toFine: fromFine,
        fromPlan: rp.toPlan,
        toPlan: rp.fromPlan,
        quanta: def.traverseQuanta,
      };
      level.portals.push(back);
      pushPortal(level, back.fromPlan, back);
    }
  }

  // Portal mouths must be standable even if they sit on a roof edge or a manhole.
  for (const p of level.portals) {
    pwalk[p.fromPlan] = 1;
    pwalk[p.toPlan] = 1;
  }

  return level;
}

function pushPortal(l: Level, from: number, p: RuntimePortal): void {
  const list = l.portalsFrom.get(from);
  if (list) list.push(p);
  else l.portalsFrom.set(from, [p]);
}

/**
 * Walls plus every door that is currently shut. Sight lines must respect door
 * state, otherwise a guard watches you through a door he has just locked.
 * Doors that are open, or that this thief has picked, stay see-through.
 */
export function computeOpaqueWithDoors(
  level: Level,
  doorShut: Uint8Array,
  out: Uint8Array,
): Uint8Array {
  out.set(level.opaque);
  const doors = level.doors;
  for (let d = 0; d < doors.length; d++) {
    if (!doorShut[d]) continue;
    const [rx, ry, rw, rh] = doors[d].rect;
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) out[y * level.w + x] = 1;
    }
  }
  return out;
}

/** Nearest walkable fine cell to `i`, searched in expanding rings. */
export function nearestWalkable(l: Level, i: number, maxRadius = 24): number {
  if (l.walk[i]) return i;
  const x0 = i % l.w;
  const y0 = (i / l.w) | 0;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= l.w || y >= l.h) continue;
        const j = y * l.w + x;
        if (l.walk[j]) return j;
      }
    }
  }
  return i;
}

export async function loadLevel(url: string): Promise<Level> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cannot load level ${url}: ${res.status}`);
  return buildLevel((await res.json()) as LevelJson);
}
