import { floodFill, makeScratch, staticAStar } from '../level/grid';

export interface WalkPoint { x: number; y: number }
export const PLAYER_RADIUS = 0.7;
type Passable = (cell: number) => boolean;

function clearCell(w: number, h: number, x: number, y: number, passable: Passable): boolean {
  return x >= 0 && y >= 0 && x < w && y < h && passable(y * w + x);
}

/** The same centre and four body probes used by player collision. */
export function playerPointClear(w: number, h: number, x: number, y: number, passable: Passable): boolean {
  return clearCell(w, h, Math.floor(x), Math.floor(y), passable)
    && clearCell(w, h, Math.floor(x - PLAYER_RADIUS), Math.floor(y), passable)
    && clearCell(w, h, Math.floor(x + PLAYER_RADIUS), Math.floor(y), passable)
    && clearCell(w, h, Math.floor(x), Math.floor(y - PLAYER_RADIUS), passable)
    && clearCell(w, h, Math.floor(x), Math.floor(y + PLAYER_RADIUS), passable);
}

/** Supercover traversal: even a very short corner crossing checks both sides. */
function clearRay(w: number, h: number, ax: number, ay: number, bx: number, by: number, passable: Passable): boolean {
  let x = Math.floor(ax), y = Math.floor(ay);
  const endX = Math.floor(bx), endY = Math.floor(by), dx = bx - ax, dy = by - ay;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const stepX = dx ? Math.abs(1 / dx) : Infinity, stepY = dy ? Math.abs(1 / dy) : Infinity;
  let nextX = dx ? ((sx > 0 ? x + 1 : x) - ax) / dx : Infinity;
  let nextY = dy ? ((sy > 0 ? y + 1 : y) - ay) / dy : Infinity;
  if (!clearCell(w, h, x, y, passable)) return false;
  while (x !== endX || y !== endY) {
    const tx = x === endX ? Infinity : nextX, ty = y === endY ? Infinity : nextY;
    if (Math.abs(tx - ty) < 1e-10) {
      if (!clearCell(w, h, x + sx, y, passable) || !clearCell(w, h, x, y + sy, passable)) return false;
      x += sx; y += sy; nextX += stepX; nextY += stepY;
    } else if (tx < ty) { x += sx; nextX += stepX; }
    else { y += sy; nextY += stepY; }
    if (!clearCell(w, h, x, y, passable)) return false;
  }
  return true;
}

/** Sweep the player's whole collision footprint, rather than a zero-width line. */
export function playerSegmentClear(w: number, h: number, from: WalkPoint, to: WalkPoint, passable: Passable): boolean {
  for (const [ox, oy] of [[0, 0], [-PLAYER_RADIUS, 0], [PLAYER_RADIUS, 0], [0, -PLAYER_RADIUS], [0, PLAYER_RADIUS]]) {
    if (!clearRay(w, h, from.x + ox, from.y + oy, to.x + ox, to.y + oy, passable)) return false;
  }
  return true;
}

/** Half-cell nodes include the middle of two-cell doorways, where the body fits.
 * All searches and shortcuts use the current player's actual door permissions. */
export class PlayerNavigator {
  private nw: number;
  private nh: number;
  private walk: Uint8Array;
  private scratch;

  constructor(private w: number, private h: number) {
    this.nw = w * 2 + 1; this.nh = h * 2 + 1;
    this.walk = new Uint8Array(this.nw * this.nh);
    this.scratch = makeScratch(this.walk.length);
  }
  private point(cell: number): WalkPoint {
    return { x: (cell % this.nw) / 2, y: Math.floor(cell / this.nw) / 2 };
  }

  route(from: WalkPoint, goal: number, passable: Passable): WalkPoint[] | null {
    if (!Number.isInteger(goal) || goal < 0 || goal >= this.w * this.h) return null;
    for (let c = 0; c < this.walk.length; c++) {
      const p = this.point(c);
      this.walk[c] = playerPointClear(this.w, this.h, p.x, p.y, passable) ? 1 : 0;
    }
    // Connect the real (possibly between-cell) position without cutting a corner
    // on the first step or snapping the player back to a cell centre.
    let start = -1, closest = Infinity;
    const cx = Math.round(from.x * 2), cy = Math.round(from.y * 2);
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || y < 0 || x >= this.nw || y >= this.nh) continue;
      const c = y * this.nw + x, p = this.point(c), distance = Math.hypot(p.x - from.x, p.y - from.y);
      if (this.walk[c] && distance < closest && playerSegmentClear(this.w, this.h, from, p, passable)) {
        start = c; closest = distance;
      }
    }
    if (start < 0) return null;
    const target = { x: goal % this.w + 0.5, y: Math.floor(goal / this.w) + 0.5 };
    let end = target.y * 2 * this.nw + target.x * 2;
    let path = staticAStar(this.walk, this.nw, this.nh, start, end, this.scratch);
    if (!path) {
      // A click on a prop edge or a wall selects nearby reachable floor, never
      // an inaccessible point on the other side of the obstacle.
      const reachable = floodFill(this.walk, this.nw, this.nh, start);
      let distance = 3 * 3 + 1e-8;
      end = -1;
      for (let c = 0; c < reachable.length; c++) if (reachable[c]) {
        const p = this.point(c), d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
        if (d < distance) { distance = d; end = c; }
      }
      if (end < 0) return null;
      path = staticAStar(this.walk, this.nw, this.nh, start, end, this.scratch);
    }
    if (!path) return null;
    const points = [{ x: from.x, y: from.y }, ...Array.from(path, c => this.point(c))];
    const smooth: WalkPoint[] = [points[0]];
    let anchor = 0;
    for (let i = 2; i < points.length; i++) {
      if (!playerSegmentClear(this.w, this.h, points[anchor], points[i], passable)) {
        smooth.push(points[i - 1]); anchor = i - 1;
      }
    }
    smooth.push(points[points.length - 1]);
    // Keep the final contract explicit even at tight diagonal lattice corners.
    return smooth.every((p, i) => i === 0 || playerSegmentClear(this.w, this.h, smooth[i - 1], p, passable)) ? smooth : null;
  }
}
