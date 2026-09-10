import type { Level } from './loader';

/** How far out a door notices someone heading for it, in fine cells. */
const APPROACH = 3.0;
/** Close enough to be standing in the opening: the leaf must be out of the way. */
const IN_DOORWAY = 1.2;
/** A shoulder either side of the opening, so brushing the frame still counts. */
const MOUTH_MARGIN = 0.5;
/** How square-on the approach has to be. 0.35 allows about 70 degrees off. */
const HEADING_DOT = 0.35;

/**
 * Is this agent crossing the doorway, rather than merely near it?
 *
 * A door sits in a wall, so the useful frame is the door's own: `along` runs
 * across the opening and `through` is the way you travel to get from one side
 * to the other. Somebody walking a corridor past a door sweeps through `along`
 * with almost no `through` component, and a plain radius cannot tell that apart
 * from someone stepping in — which is why every guard on patrol used to leave a
 * wake of swinging doors behind them.
 */
export function crossingDoorway(
  level: Level,
  doorIdx: number,
  x: number,
  y: number,
  facingDeg: number,
): boolean {
  const rect = level.doors[doorIdx].rect;
  const cx = rect[0] + rect[2] / 2;
  const cy = rect[1] + rect[3] / 2;
  // Doors are wider than they are deep; you travel across the short axis.
  const wide = rect[2] >= rect[3];
  const span = wide ? rect[2] : rect[3];
  const along = wide ? x - cx : y - cy;
  const through = wide ? y - cy : x - cx;

  if (Math.abs(along) > span / 2 + MOUTH_MARGIN) return false;
  const gap = Math.abs(through);
  if (gap > APPROACH) return false;
  // Standing in the opening: the leaf has to be aside whichever way they face.
  if (gap <= IN_DOORWAY) return true;

  const rad = (facingDeg * Math.PI) / 180;
  const headingThrough = wide ? Math.sin(rad) : Math.cos(rad);
  // Heading that closes the gap rather than running alongside the wall.
  return -Math.sign(through) * headingThrough >= HEADING_DOT;
}
