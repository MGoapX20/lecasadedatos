/**
 * Visibility polygons for guard and camera cones.
 *
 * This is deliberately free of any rendering code so it can be tested against
 * the simulation's own `seesPoint`: what the cone draws and what actually
 * catches you are then the same thing by construction.
 */

/** Pull vertices this far back off a wall face so they never land inside it. */
const SKIN = 0.02;

/** Angular gap between base rays, in degrees, before adaptive refinement. */
const BASE_STEP_DEG = 1.25;

/** A depth jump larger than this (in cells) is treated as a shadow edge. */
const EDGE_JUMP = 0.5;

/** How many times a shadow edge is bisected to pin it down. */
const MAX_REFINE = 6;

/**
 * Exact distance along a ray to the first opaque cell, using the same grid
 * traversal as line-of-sight checks. Returns `maxDist` when nothing is hit.
 */
export function rayDistance(
  opaque: Uint8Array,
  w: number,
  h: number,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
): number {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  // The starting cell is never treated as a blocker, exactly as line-of-sight
  // checks do, so an observer mounted flush against a wall still sees out.

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const invDx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const invDy = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) * invDx : stepX < 0 ? (ox - x) * invDx : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * invDy : stepY < 0 ? (oy - y) * invDy : Infinity;

  const limit = w + h + 4;
  for (let i = 0; i < limit; i++) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      x += stepX;
      tMaxX += invDx;
    } else {
      t = tMaxY;
      y += stepY;
      tMaxY += invDy;
    }
    if (t >= maxDist) return maxDist;
    if (x < 0 || y < 0 || x >= w || y >= h) return t;
    if (opaque[y * w + x]) return t;
  }
  return maxDist;
}

export interface ConeSample {
  /** Absolute angle in radians. */
  angle: number;
  /** Visible distance along that angle, in fine cells. */
  dist: number;
}

/**
 * The outline of what an observer can actually see: rays at a fixed angular
 * step, with extra rays bisected in wherever the depth jumps, so the polygon
 * edge follows a wall corner instead of cutting the corner off.
 */
export function coneSamples(
  opaque: Uint8Array,
  w: number,
  h: number,
  ox: number,
  oy: number,
  facingDeg: number,
  fovDeg: number,
  rangeCells: number,
  out: ConeSample[] = [],
): ConeSample[] {
  out.length = 0;
  const half = ((fovDeg / 2) * Math.PI) / 180;
  const base = (facingDeg * Math.PI) / 180;
  const steps = Math.max(8, Math.ceil(fovDeg / BASE_STEP_DEG));

  const cast = (angle: number): number => {
    const d = rayDistance(opaque, w, h, ox, oy, Math.cos(angle), Math.sin(angle), rangeCells);
    return Math.max(0, d - SKIN);
  };

  let prevAngle = base - half;
  let prevDist = cast(prevAngle);
  out.push({ angle: prevAngle, dist: prevDist });

  for (let i = 1; i <= steps; i++) {
    const angle = base - half + (2 * half * i) / steps;
    const dist = cast(angle);
    // Bisect toward the discontinuity so both sides of a corner are sampled.
    if (Math.abs(dist - prevDist) > EDGE_JUMP) {
      let loA = prevAngle;
      let loD = prevDist;
      let hiA = angle;
      let hiD = dist;
      for (let r = 0; r < MAX_REFINE; r++) {
        const midA = (loA + hiA) / 2;
        const midD = cast(midA);
        if (Math.abs(midD - loD) > Math.abs(midD - hiD)) {
          hiA = midA;
          hiD = midD;
        } else {
          loA = midA;
          loD = midD;
        }
      }
      // Two vertices at the corner: the near side, then the far side.
      out.push({ angle: loA, dist: loD });
      out.push({ angle: hiA, dist: hiD });
    }
    out.push({ angle, dist });
    prevAngle = angle;
    prevDist = dist;
  }
  return out;
}
