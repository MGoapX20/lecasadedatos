/**
 * Line of sight over a grid of opaque cells, using an amanatides-woo style DDA
 * on continuous coordinates (in cell units). Endpoints are never treated as
 * blockers, so an observer standing next to a wall can still see past it.
 */
export function hasLineOfSight(
  opaque: Uint8Array,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  if (x === ex && y === ey) return true;

  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const invDx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const invDy = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX =
    stepX > 0 ? (x + 1 - ax) * invDx : stepX < 0 ? (ax - x) * invDx : Infinity;
  let tMaxY =
    stepY > 0 ? (y + 1 - ay) * invDy : stepY < 0 ? (ay - y) * invDy : Infinity;
  const tDeltaX = invDx;
  const tDeltaY = invDy;

  // Bounded: the diagonal of the grid is the worst case.
  const limit = w + h + 4;
  for (let i = 0; i < limit; i++) {
    if (tMaxX < tMaxY) {
      x += stepX;
      tMaxX += tDeltaX;
    } else {
      y += stepY;
      tMaxY += tDeltaY;
    }
    if (x === ex && y === ey) return true;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    if (opaque[y * w + x]) return false;
  }
  return false;
}
