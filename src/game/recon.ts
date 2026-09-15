import { makeScratch, staticAStar } from '../level/grid';
import type { Level } from '../level/loader';

export interface ReconRoute {
  cells: number[];
  /** Indices into cells: four outside corners, then the starting point. */
  checkpoints: number[];
  bounds: { left: number; right: number; back: number; front: number };
}
export interface FloorRoute { cells: readonly number[]; from: number }

const routes = new WeakMap<Level, ReconRoute>();
const reverseRoutes = new WeakMap<Level, ReconRoute>();

/** A circuit on clear outdoor pavement, never a shortcut through a door. */
export function reconRoute(level: Level, reverse = false): ReconRoute {
  if (reverse) {
    const cached = reverseRoutes.get(level);
    if (cached) return cached;
    const forward = reconRoute(level), end = forward.cells.length - 1;
    const backward = { cells: [...forward.cells].reverse(), bounds: forward.bounds,
      checkpoints: [...forward.checkpoints.slice(0, -1).reverse().map(i => end - i), end] };
    reverseRoutes.set(level, backward);
    return backward;
  }
  const cached = routes.get(level);
  if (cached) return cached;
  const rooms = level.json.areas.filter(area => area.kind !== 'outdoor');
  const left = Math.min(...rooms.map(a => a.rect[0])) - 7;
  const right = Math.max(...rooms.map(a => a.rect[0] + a.rect[2])) + 7;
  const back = Math.min(...rooms.map(a => a.rect[1])) - 7;
  const front = Math.max(...rooms.map(a => a.rect[1] + a.rect[3])) + 7;
  const spawn = level.json.entries.find(entry => entry.id === 'front')!.spawn;
  const outdoor = level.walkGuard.map((walk, cell) => walk && !level.indoor[cell] && level.doorAt[cell] < 0 ? 1 : 0);
  const nearest = (x: number, y: number): number => {
    let best = -1, distance = Infinity;
    for (let cell = 0; cell < outdoor.length; cell++) {
      if (!outdoor[cell]) continue;
      const d = Math.hypot(cell % level.w - x, Math.floor(cell / level.w) - y);
      if (d < distance) { distance = d; best = cell; }
    }
    return best;
  };
  const stops = [spawn, [right, front], [right, back], [left, back], [left, front], spawn]
    .map(([x, y]) => nearest(x, y));
  const scratch = makeScratch(level.cellCount);
  const route: ReconRoute = { cells: [stops[0]], checkpoints: [],
    bounds: { left: left + 7, right: right - 7, back: back + 7, front: front - 7 } };
  for (let i = 1; i < stops.length; i++) {
    const leg = staticAStar(outdoor, level.w, level.h, stops[i - 1], stops[i], scratch);
    if (!leg) throw new Error(`Recon pavement route is blocked at corner ${i}`);
    route.cells.push(...leg.slice(1));
    route.checkpoints.push(route.cells.length - 1);
  }
  routes.set(level, route);
  return route;
}

const SECTORS = 24;
const TAU = Math.PI * 2;
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Survey the perimeter, not five exact points on a painted rail. */
export class ReconCircuit {
  private surveyed = new Set<number>();
  private finished = false;
  private reverse = false;
  private previousAngle: number | null = null;
  private directionTravel = 0;
  private progress = 0;
  reset(): void {
    this.surveyed.clear(); this.finished = this.reverse = false;
    this.previousAngle = null; this.directionTravel = this.progress = 0;
  }
  get complete(): boolean { return this.finished; }
  get fraction(): number { return this.finished ? 1 : Math.max(0, Math.min(.99, (this.surveyed.size - 1) / (SECTORS - 1))); }

  update(level: Level, player: { x: number; y: number }): void {
    if (this.complete) return;
    const { bounds } = reconRoute(level);
    // A small loop in an indoor gap is not a survey of the outside shell.
    if (player.x > bounds.left && player.x < bounds.right && player.y > bounds.back && player.y < bounds.front) return;
    const cx = (bounds.left + bounds.right) / 2, cy = (bounds.back + bounds.front) / 2;
    const angle = Math.atan2((player.y - cy) / (bounds.front - bounds.back), (player.x - cx) / (bounds.right - bounds.left));
    const spawn = level.json.entries.find(entry => entry.id === 'front')!.spawn;
    const startAngle = Math.atan2((spawn[1] + .5 - cy) / (bounds.front - bounds.back), (spawn[0] + .5 - cx) / (bounds.right - bounds.left));
    const offset = angleDelta(startAngle, angle);
    const sector = Math.floor(((offset + Math.PI / SECTORS + TAU) % TAU) / TAU * SECTORS);
    // Only credit the ground actually visited. Repeated steps or a respawn
    // cannot fill in missing portions of the perimeter.
    this.surveyed.add(sector);
    if (this.previousAngle !== null) this.directionTravel += angleDelta(this.previousAngle, angle);
    this.previousAngle = angle;
    if (this.surveyed.size <= 3 && Math.abs(this.directionTravel) > Math.PI / 24) {
      this.reverse = this.directionTravel > 0;
    }
    this.finished = this.surveyed.size === SECTORS && Math.abs(offset) < Math.PI / 6;

    const route = reconRoute(level, this.reverse);
    let best = Infinity;
    // Project onto the whole trail so a missed corner or a detour cannot
    // strand its progress. The coverage above decides completion separately.
    for (let i = 0; i < route.cells.length - 1; i++) {
      const cell = route.cells[i];
      const d = Math.hypot(cell % level.w + .5 - player.x, Math.floor(cell / level.w) + .5 - player.y);
      if (d < best) { best = d; this.progress = i; }
    }
  }

  floorRoute(level: Level): FloorRoute { return { cells: reconRoute(level, this.reverse).cells, from: this.progress }; }
}
