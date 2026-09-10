import type { CellXY } from '../level/schema';

/**
 * Getting the money out. Reaching the vault proves there is a way in; it is
 * not yet a robbery, and in the thing this stands for it is not yet a breach
 * either. Somebody has to open a channel to the outside and move the goods
 * down it while the building is still looking for them.
 *
 * The channel is a hole in the outside wall, drilled by hand. The far end is an
 * unmarked van that pulls up to it — a machine the thief controls, parked
 * somewhere nobody is watching, which is what a staging server is.
 */
export interface ExfilDef {
  /** The stretch of outside wall that can be broken through: [x, y, w, h]. */
  hole: [number, number, number, number];
  /** Where the thief has to stand to work on it. */
  stand: CellXY;
  /** Where the van parks, outside the hole. */
  van: CellXY;
  /** Where it comes in from, along the service road. */
  vanFrom: CellXY;
  /** How many loads have to reach the van. */
  loads: number;
  /** Presses the money can be lifted from. */
  presses: CellXY[];
}

export interface VanPose {
  x: number;
  y: number;
  /** Degrees, 0 = +x, like everything else in the simulation. */
  facing: number;
  parked: boolean;
}

/** How long the van takes to come down the road and back up to the hole. */
export const VAN_ARRIVE_TICKS = 70;

/**
 * Where the van is, `ticks` after the wall came down. Pure, so the view and the
 * rules cannot disagree about whether it has arrived.
 */
export function vanPoseAt(def: ExfilDef, ticks: number, out: VanPose = { x: 0, y: 0, facing: 0, parked: false }): VanPose {
  const ax = def.vanFrom[0] + 0.5;
  const ay = def.vanFrom[1] + 0.5;
  const bx = def.van[0] + 0.5;
  const by = def.van[1] + 0.5;
  const k = Math.max(0, Math.min(1, ticks / VAN_ARRIVE_TICKS));
  // Ease out: it comes in fast and settles, rather than sliding at one speed.
  const e = 1 - (1 - k) * (1 - k);
  out.x = ax + (bx - ax) * e;
  out.y = ay + (by - ay) * e;
  out.facing = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  out.parked = k >= 1;
  return out;
}

/** Every cell of the wall that comes down. */
export function holeCells(def: ExfilDef, width: number): number[] {
  const [x, y, w, h] = def.hole;
  const out: number[] = [];
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) out.push(j * width + i);
  }
  return out;
}
