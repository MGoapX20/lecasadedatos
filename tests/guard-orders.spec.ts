import { describe, expect, it } from 'vitest';
import { buildLevel } from '../src/level/loader';
import type { AreaDef, GuardDef } from '../src/level/schema';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

/** Tiny maps make route length, blocked rooms, and diagonal costs explicit. */
function fixture(rows: string[]) {
  const base = loadMint().json;
  const w = rows[0].length;
  const areas: AreaDef[] = [];
  const guards: GuardDef[] = [];
  let target = -1;
  rows.forEach((row, y) => {
    expect(row.length).toBe(w);
    [...row].forEach((symbol, x) => {
      if (symbol === '#') return;
      areas.push({ id: `${x},${y}`, kind: 'outdoor', floor: 'concrete', rect: [x, y, 1, 1] });
      if (symbol === 'T') target = y * w + x;
      if (/\d/.test(symbol)) guards.push({
        id: `g${symbol}`, nameKey: `guard.${symbol}`, vision: { fovDeg: 90, range: 8 },
        patrol: { loop: false, waypoints: [{ cell: [x, y] }] },
      });
    });
  });
  guards.sort((a, b) => a.id.localeCompare(b.id));
  const level = buildLevel({
    ...base, grid: { w, h: rows.length, cellSize: .5, planStride: 1 }, areas,
    guards, openings: [], doors: [], portals: [], entries: [], keycards: [],
    keycardSpots: [], cameras: [], props: [], safeSpots: [],
    delivery: undefined, exfil: undefined, shiftChange: undefined,
    vault: { ...base.vault, cell: [target % w, Math.floor(target / w)], rect: [target % w, Math.floor(target / w), 1, 1] },
  });
  return { world: new SimWorld(level), target };
}

describe('automatic defending guard orders', () => {
  it('previews the same guard and route without issuing an order', () => {
    const { world, target } = fixture(['...........', '.0.T.....1.', '...........']);
    const before = structuredClone(world.guards.map((guard) => guard.program));
    const preview = world.nearestGuardOrder(target)!;
    expect(preview.guard.id).toBe('g0');
    expect(preview.route.points.at(-1)).toEqual([3.5, 1.5]);
    expect(world.guards.map((guard) => guard.program)).toEqual(before);
    expect(world.drainEvents()).toEqual([]);
    expect(world.orderNearestGuardTo(target)).toBe(preview.guard);
  });
  it('sends the guard with the shorter route around walls, then walks to the destination', () => {
    const { world, target } = fixture([
      '.............',
      '.....#.......',
      '.....#.......',
      '....0#T......',
      '.....#.......',
      '.....#.......',
      '.....#.......',
      '.....#....1..',
      '.....#.......',
      '.....#.......',
      '.............',
    ]);
    const [nearAcrossWall, nearByRoute] = world.guards;
    const unchanged = structuredClone(nearAcrossWall.program);
    expect(world.orderNearestGuardTo(target)).toBe(nearByRoute);
    expect(nearAcrossWall.program).toEqual(unchanged);
    expect(world.drainEvents()).toEqual([{ kind: 'guardOrdered', guard: nearByRoute.id }]);
    const tx = target % world.level.w + .5;
    const ty = Math.floor(target / world.level.w) + .5;
    for (let i = 0; i < 160; i++) {
      world.step();
      expect(world.level.walk[Math.floor(nearByRoute.y) * world.level.w + Math.floor(nearByRoute.x)]).toBe(1);
    }
    expect(nearByRoute.x).toBeCloseTo(tx);
    expect(nearByRoute.y).toBeCloseTo(ty);
  });

  it('counts physical distance, so four straight steps beat three diagonals', () => {
    const { world, target } = fixture([
      '.........',
      '.0.......',
      '.........',
      '.........',
      '....T...1',
      '.........',
    ]);
    expect(world.orderNearestGuardTo(target)?.id).toBe('g1');
  });

  it('uses live guard positions instead of their original patrol positions', () => {
    const { world, target } = fixture(['...........', '.0.T.....1.', '...........']);
    world.guards[0].x = 9.5;
    world.guards[1].x = 2.5;
    expect(world.orderNearestGuardTo(target)?.id).toBe('g1');
  });

  it('skips a nearer guard in a disconnected room, even beside a thin wall', () => {
    const { world, target } = fixture([
      '.....#.......',
      '.....#.......',
      '....0#T....1.',
      '.....#.......',
      '.....#.......',
    ]);
    expect(world.orderNearestGuardTo(target)?.id).toBe('g1');
  });

  it('skips absent guards and keeps a stable choice when distances tie', () => {
    const { world, target } = fixture(['.........', '.0..T..1.', '.........']);
    expect(world.orderNearestGuardTo(target)?.id).toBe('g0');
    world.guards[0].present = false;
    expect(world.orderNearestGuardTo(target)?.id).toBe('g1');
  });

  it('rejects unreachable, solid, and out-of-bounds destinations without changing orders', () => {
    const { world, target } = fixture(['...#...', '.0.#.T.', '...#...']);
    const before = structuredClone(world.guards[0].program);
    for (const cell of [target, 3, -1, world.level.cellCount, NaN]) {
      expect(world.orderNearestGuardTo(cell)).toBeNull();
    }
    world.guards[0].present = false;
    expect(world.orderNearestGuardTo(world.level.w + 1)).toBeNull();
    expect(world.guards[0].program).toEqual(before);
    expect(world.drainEvents()).toEqual([]);
  });
});
