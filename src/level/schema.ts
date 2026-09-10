/** Rect in fine grid cells, half-open: [x, y, w, h]. */
export type Rect = [number, number, number, number];
export type CellXY = [number, number];

export type AreaKind = 'outdoor' | 'room' | 'corridor';
export type FloorKind = 'marble' | 'concrete' | 'wood' | 'asphalt' | 'grate';

export interface AreaDef {
  id: string;
  kind: AreaKind;
  rect: Rect;
  floor: FloorKind;
  /** Wall height in metres for walls bounding this area. Outdoor areas have none. */
  wallHeight?: number;
  nameKey?: string;
}

export interface OpeningDef {
  id: string;
  rect: Rect;
  /** Visual treatment of the gap in the wall. */
  kind?: 'arch' | 'gap';
}

export interface DoorDef {
  id: string;
  rect: Rect;
  kind: 'door' | 'vault' | 'gate' | 'grate';
  locked: boolean;
  keyId?: string;
  lockpickQuanta?: number;
  /** false = no lock to pick. The vault answers to the card and nothing else. */
  pickable?: boolean;
  lockableByChief: boolean;
  /** Mini-game difficulty when the player picks this lock by hand. */
  pick?: { pins: number; zone: number; speed: number };
  nameKey?: string;
  analogyKey?: string;
  /** Hinge side for the swing animation. */
  swing?: 'x' | 'z';
}

/** A non-walkable shortcut between two cells (vent shaft, sewer crawl, drainpipe). */
export interface PortalDef {
  id: string;
  from: CellXY;
  to: CellXY;
  traverseQuanta: number;
  kind: 'vent' | 'sewer' | 'climb';
  bidirectional?: boolean;
}

export interface EntryDef {
  id: string;
  /** Where an attacker materialises outside the building. */
  spawn: CellXY;
  /** First cell inside the perimeter this entry leads to. */
  cell: CellXY;
  kind: 'door' | 'vent' | 'hatch' | 'gate' | 'truck';
  doorId?: string;
  nameKey: string;
  analogyKey: string;
}

export interface KeycardDef {
  id: string;
  cell: CellXY;
  nameKey: string;
  /** What picking it up does: a card opens doors, a uniform fools guards, a fuse kills the cameras. */
  kind?: 'card' | 'uniform' | 'fuse';
  analogyKey?: string;
}

export interface PatrolWaypoint {
  cell: CellXY;
  holdTicks?: number;
}

export interface GuardDef {
  id: string;
  nameKey: string;
  vision: { fovDeg: number; range: number };
  patrol: { loop: boolean; waypoints: PatrolWaypoint[]; speed?: number };
}

export interface CameraDef {
  id: string;
  cell: CellXY;
  height?: number;
  facingDeg: number;
  fovDeg: number;
  range: number;
  sweep?: { amplitudeDeg: number; periodTicks: number };
}

/** The trades on the service road, each with its own lit roof sign. */
export type SignKind = 'computer' | 'food';

export interface PropDef {
  kind:
    | 'column'
    | 'desk'
    | 'press'
    | 'plant'
    | 'crate'
    | 'truck'
    | 'lamp'
    | 'bench'
    | 'teller'
    | 'sofa'
    | 'cabinet'
    | 'moneyStack'
    | 'store'
    | 'chandelier'
    | 'statue'
    | 'banner';
  cell: CellXY;
  rotDeg?: number;
  scale?: number;
  /** Crates only: boxes stacked vertically on this single floor footprint. */
  stack?: number;
  /** Blocks movement (rasterised into the walk grid). */
  solid?: boolean;
  radius?: number;
  /** Shopfronts only: which trade the roof sign advertises. */
  sign?: SignKind;
}

export interface LevelRules {
  tickHz: number;
  quantumTicks: number;
  horizonSec: number;
  aiCellsPerQuantum: number;
  humanQuantaPerCell: number;
  playerSpeed: number;
  guardSpeed: number;
  chaseSpeed: number;
  vaultPrintQuanta: number;
  defaultLockpickQuanta: number;
  maxLocks: number;
  alarmBoostSec: number;
  alarmCooldownSec: number;
  alarmVisionMul: number;
}

export interface ShiftChangeDef {
  startTick: number;
  durationTicks: number;
  guardsAffected: string[];
  analogyKey: string;
}

export interface LevelJson {
  id: string;
  grid: { w: number; h: number; cellSize: number; planStride: number };
  rules: LevelRules;
  areas: AreaDef[];
  openings: OpeningDef[];
  doors: DoorDef[];
  portals: PortalDef[];
  entries: EntryDef[];
  keycards: KeycardDef[];
  /** Places the vault card may be left; one is chosen per visit. */
  keycardSpots?: CellXY[];
  guards: GuardDef[];
  cameras: CameraDef[];
  props: PropDef[];
  vault: { cell: CellXY; rect: Rect; nameKey: string; analogyKey: string };
  /** The supplier's delivery round; see `src/sim/truck.ts`. */
  delivery?: {
    dockCell: CellXY;
    gateCell: CellXY;
    roadCell: CellXY;
    ring: CellXY[];
    stops: CellXY[];
    cycleTicks: number;
    loadTicks: number;
    unloadTicks: number;
    speedCells: number;
  };
  /** Getting the money out: the wall, the van, the presses. See `src/sim/exfil.ts`. */
  exfil?: {
    hole: Rect;
    stand: CellXY;
    van: CellXY;
    vanFrom: CellXY;
    loads: number;
    presses: CellXY[];
  };
  safeSpots: CellXY[];
  shiftChange?: ShiftChangeDef;
}

export function validateLevel(l: LevelJson): string[] {
  const errs: string[] = [];
  const { w, h, planStride } = l.grid;
  if (w % planStride !== 0 || h % planStride !== 0) {
    errs.push(`grid ${w}x${h} is not divisible by planStride ${planStride}`);
  }
  const inBounds = (c: CellXY, what: string) => {
    if (c[0] < 0 || c[0] >= w || c[1] < 0 || c[1] >= h) errs.push(`${what} out of bounds: ${c}`);
  };
  const rectOk = (r: Rect, what: string) => {
    if (r[2] <= 0 || r[3] <= 0) errs.push(`${what} has non-positive size`);
    if (r[0] < 0 || r[1] < 0 || r[0] + r[2] > w || r[1] + r[3] > h) {
      errs.push(`${what} out of bounds: ${r}`);
    }
  };
  l.areas.forEach((a) => rectOk(a.rect, `area ${a.id}`));
  l.openings.forEach((o) => rectOk(o.rect, `opening ${o.id}`));
  l.doors.forEach((d) => rectOk(d.rect, `door ${d.id}`));
  l.entries.forEach((e) => {
    inBounds(e.cell, `entry ${e.id}.cell`);
    inBounds(e.spawn, `entry ${e.id}.spawn`);
  });
  l.keycards.forEach((k) => inBounds(k.cell, `keycard ${k.id}`));
  l.guards.forEach((g) =>
    g.patrol.waypoints.forEach((wp, i) => inBounds(wp.cell, `guard ${g.id} wp${i}`)),
  );
  l.cameras.forEach((c) => inBounds(c.cell, `camera ${c.id}`));
  inBounds(l.vault.cell, 'vault.cell');
  const keyIds = new Set(l.keycards.map((k) => k.id));
  l.doors.forEach((d) => {
    if (d.keyId && !keyIds.has(d.keyId)) errs.push(`door ${d.id} needs unknown key ${d.keyId}`);
  });
  if (l.exfil) {
    rectOk(l.exfil.hole, 'exfil.hole');
    inBounds(l.exfil.stand, 'exfil.stand');
    inBounds(l.exfil.van, 'exfil.van');
    inBounds(l.exfil.vanFrom, 'exfil.vanFrom');
    l.exfil.presses.forEach((c, i) => inBounds(c, `exfil.presses[${i}]`));
    if (l.exfil.loads < 1) errs.push('exfil.loads must be at least 1');
    if (!l.exfil.presses.length) errs.push('exfil needs at least one press to lift money from');
  }
  const doorIds = new Set(l.doors.map((d) => d.id));
  l.entries.forEach((e) => {
    if (e.doorId && !doorIds.has(e.doorId)) errs.push(`entry ${e.id} names unknown door ${e.doorId}`);
  });
  return errs;
}
