import type { Level } from './loader';
import { fineXYToWorldX, fineXYToWorldZ, worldToFine } from './loader';

/**
 * How much floor a prop actually covers on screen, as half-extents in world
 * units along its own length (x) and depth (z).
 *
 * This is deliberately NOT the collision radius in `loader.ts`: that is a
 * circle sized for walking around, and it is smaller than the mesh at the ends
 * of long props. A teller counter blocks a 2.0 circle but is 4.7 wide, so the
 * cells past its collision radius are walkable and still inside the counter —
 * which is how the manager's card ended up spawning inside the furniture.
 *
 * Keep in step with `propGeometry` in `src/render/building.ts` and the model
 * lengths in `src/render/models.ts`.
 */
const FOOTPRINT: Record<string, [number, number]> = {
  column: [0.75, 0.75],
  desk: [1.2, 0.65],
  press: [1.6, 1.1],
  plant: [0.62, 0.62],
  crate: [0.75, 0.75],
  truck: [5.2, 1.4],
  lamp: [0.3, 0.3],
  bench: [1.1, 0.3],
  teller: [2.35, 0.53],
  sofa: [1.15, 0.5],
  cabinet: [0.8, 0.35],
  moneyStack: [0.45, 0.3],
  statue: [0.55, 0.55],
  banner: [0.65, 0.1],
  store: [1.9, 1.0],
};

/** Props that hang above head height and so never hide anything on the floor. */
const OVERHEAD = new Set(['chandelier']);

const DEFAULT_FOOTPRINT: [number, number] = [0.6, 0.6];

/**
 * Distance from a world point to the nearest prop's footprint, in world units.
 * Negative means the point is inside that prop's mesh.
 */
export function propClearance(level: Level, x: number, z: number): number {
  let worst = Infinity;
  for (const p of level.json.props) {
    if (OVERHEAD.has(p.kind)) continue;
    const [ex, ez] = FOOTPRINT[p.kind] ?? DEFAULT_FOOTPRINT;
    const s = p.scale ?? 1;
    const rot = ((p.rotDeg ?? 0) * Math.PI) / 180;
    const dx = x - fineXYToWorldX(level, p.cell[0] + 0.5);
    const dz = z - fineXYToWorldZ(level, p.cell[1] + 0.5);
    // Into the prop's own frame, then the gap to its box.
    const c = Math.cos(-rot);
    const sn = Math.sin(-rot);
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    const gap = Math.max(Math.abs(lx) - ex * s, Math.abs(lz) - ez * s);
    if (gap < worst) worst = gap;
  }
  return worst;
}

/**
 * The card stands on a base of this radius. A spot needs at least this much
 * clear floor or the stand grows out of a counter.
 */
export const CARD_CLEARANCE = 0.9;

/** Is this fine cell somewhere the card would actually be seen? */
export function cardSpotIsClear(level: Level, fineCell: number): boolean {
  const x = fineCell % level.w;
  const y = (fineCell / level.w) | 0;
  return (
    propClearance(level, fineXYToWorldX(level, x + 0.5), fineXYToWorldZ(level, y + 0.5)) >=
      CARD_CLEARANCE && cardSpotHasSightline(level, fineCell)
  );
}

/**
 * The gameplay camera looks down from the south-east; see `shotFor` in
 * `src/render/camera.ts`. Anything the visitor must spot has to clear the
 * interior walls along that line, or it is hidden behind a room divider.
 */
const CAMERA_AZIMUTH_DEG = 45;
const CAMERA_PITCH_DEG = 50;
/** Interior wall height in `src/render/building.ts`. */
const INTERIOR_WALL_H = 2.6;
/** The card badge sits about this high on its stand. */
const CARD_HEIGHT = 1.12;

/** Can the gameplay camera see a card standing on this cell, or is a wall in the way? */
export function cardSpotHasSightline(level: Level, fineCell: number): boolean {
  const az = (CAMERA_AZIMUTH_DEG * Math.PI) / 180;
  const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
  const dx = Math.cos(az) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = Math.sin(az) * Math.cos(pitch);
  let x = fineXYToWorldX(level, (fineCell % level.w) + 0.5);
  let z = fineXYToWorldZ(level, ((fineCell / level.w) | 0) + 0.5);
  let y = CARD_HEIGHT;
  for (let step = 0; step < 48; step++) {
    x += dx * 0.25;
    y += dy * 0.25;
    z += dz * 0.25;
    // Once the ray is over the dividers it cannot be blocked by them again.
    if (y > INTERIOR_WALL_H) return true;
    const cell = worldToFine(level, x, z);
    if (cell < 0) return true;
    if (!level.walk[cell]) return false;
  }
  return true;
}
