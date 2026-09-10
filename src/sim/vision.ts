import { hasLineOfSight } from '../level/los';

const DEG = Math.PI / 180;

/** Smallest absolute difference between two angles, in degrees. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

/**
 * Can an observer at (ox, oy) facing `facingDeg` see the point (tx, ty)?
 * All coordinates are in fine cells. Angles use 0 deg = +x, 90 deg = +y.
 */
export function seesPoint(
  opaque: Uint8Array,
  w: number,
  h: number,
  ox: number,
  oy: number,
  facingDeg: number,
  fovDeg: number,
  rangeCells: number,
  tx: number,
  ty: number,
): boolean {
  const dx = tx - ox;
  const dy = ty - oy;
  const d2 = dx * dx + dy * dy;
  if (d2 > rangeCells * rangeCells) return false;
  if (d2 > 0.25) {
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDelta(ang, facingDeg) > fovDeg / 2) return false;
  }
  return hasLineOfSight(opaque, w, h, ox, oy, tx, ty);
}

/**
 * Visit every cell any part of which falls inside a vision sector.
 *
 * Testing only the centre of a cell is not enough: along the edge of a cone a
 * centre can be hidden while a corner is exposed, and an agent standing there
 * gets seen by a plan that believed the ground was clear. The centre is tried
 * first and the corners only when it misses, so the common case stays cheap.
 */
export function forEachVisibleCell(
  opaque: Uint8Array,
  w: number,
  h: number,
  ox: number,
  oy: number,
  facingDeg: number,
  fovDeg: number,
  rangeCells: number,
  visit: (cell: number, x: number, y: number) => void,
): void {
  const half = fovDeg / 2;
  const r2 = rangeCells * rangeCells;
  // One cell of slack: a cell can be clipped at a corner while its centre sits
  // outside the sector entirely.
  const x0 = Math.max(0, Math.floor(ox - rangeCells) - 1);
  const x1 = Math.min(w - 1, Math.ceil(ox + rangeCells) + 1);
  const y0 = Math.max(0, Math.floor(oy - rangeCells) - 1);
  const y1 = Math.min(h - 1, Math.ceil(oy + rangeCells) + 1);

  const visible = (px: number, py: number): boolean => {
    const dx = px - ox;
    const dy = py - oy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) return false;
    if (d2 > 0.25) {
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angleDelta(ang, facingDeg) > half) return false;
    }
    return hasLineOfSight(opaque, w, h, ox, oy, px, py);
  };

  const K = 0.48; // corner probes, pulled just inside the cell boundary
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5;
      // Centre first: inside the cone that hits immediately and costs one test.
      if (
        visible(cx, cy) ||
        visible(cx - K, cy - K) ||
        visible(cx + K, cy - K) ||
        visible(cx - K, cy + K) ||
        visible(cx + K, cy + K)
      ) {
        visit(y * w + x, cx, cy);
      }
    }
  }
}

/** Camera facing at an absolute tick, including its sweep. */
export function cameraFacingAt(
  facingDeg: number,
  sweep: { amplitudeDeg: number; periodTicks: number } | undefined,
  tick: number,
): number {
  if (!sweep || sweep.periodTicks <= 0) return facingDeg;
  return facingDeg + Math.sin((tick / sweep.periodTicks) * Math.PI * 2) * sweep.amplitudeDeg;
}

export { DEG };
