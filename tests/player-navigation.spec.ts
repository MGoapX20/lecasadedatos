import { describe, expect, it } from 'vitest';
import { buildLevel } from '../src/level/loader';
import { PlayerNavigator, playerPointClear, playerSegmentClear } from '../src/sim/navigation';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

function fixture(doors = false) {
  const base = loadMint().json, w = 24, h = 18;
  const level = buildLevel({ ...base, grid: { w, h, cellSize: .5, planStride: 2 },
    areas: [{ id: 'room', kind: 'corridor', floor: 'concrete', rect: [1, 1, w - 2, h - 2] }],
    openings: [], guards: [], props: [], portals: [], cameras: [], keycards: [], keycardSpots: [], safeSpots: [],
    delivery: undefined, exfil: undefined, shiftChange: undefined,
    entries: [{ id: 'front', kind: 'door', cell: [3, 4], spawn: [3, 4], nameKey: 'entry.front', analogyKey: 'analogy.front' }],
    doors: doors ? [{ id: 'test', kind: 'door', rect: [10, 3, 2, 2], locked: false,
      pickable: false, lockableByChief: true, lockpickQuanta: 4 }] : [],
    vault: { ...base.vault, cell: [21, 15], rect: [21, 15, 1, 1] },
  });
  const world = new SimWorld(level, 5); world.catchesEnabled = false;
  const player = world.spawnPlayer('front', 'Mouse');
  const block = (x: number, y: number, width: number, height: number) => {
    for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) world.walkNow[yy * w + xx] = 0;
  };
  const passable = (cell: number) => world.passable(cell, player);
  const finish = (max = 300) => {
    const positions = [{ x: player.x, y: player.y }];
    for (let i = 0; i < max && player.routePoints; i++) {
      const before = { x: player.x, y: player.y };
      world.step();
      expect(playerPointClear(w, h, player.x, player.y, passable), `body at ${player.x},${player.y}`).toBe(true);
      expect(playerSegmentClear(w, h, before, player, passable)).toBe(true);
      expect(Math.hypot(player.x - before.x, player.y - before.y)).toBeLessThanOrEqual(player.speed + 1e-8);
      positions.push({ x: player.x, y: player.y });
    }
    expect(player.routePoints, 'the mouse route should finish without getting stuck').toBeNull();
    return positions;
  };
  return { level, world, player, block, passable, finish, w, h };
}

describe('mouse movement around obstacles', () => {
  it('rounds a large prop from an off-grid position without shaving its corners or pausing at waypoints', () => {
    const f = fixture(); f.block(8, 5, 5, 6);
    f.player.x = 4.2; f.player.y = 7.8;
    expect(f.world.setPlayerRoute(7 * f.w + 17)).toBe(true);
    const points = f.finish();
    expect([f.player.x, f.player.y]).toEqual([17.5, 7.5]);
    expect(points.some(p => p.y <= 4.3 || p.y >= 11.7)).toBe(true);
    for (let i = 1; i < points.length; i++) expect(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)).toBeGreaterThan(0.001);
  });

  it('finds its way out of a U-shaped obstacle before approaching the clicked ground', () => {
    const f = fixture(); f.block(6, 4, 10, 2); f.block(6, 4, 2, 9); f.block(14, 4, 2, 9);
    f.player.x = 10.2; f.player.y = 8.2;
    expect(f.world.setPlayerRoute(8 * f.w + 19)).toBe(true);
    const points = f.finish();
    expect(points.some(p => p.y >= 13.7)).toBe(true);
    expect([f.player.x, f.player.y]).toEqual([19.5, 8.5]);
  });

  it('uses the middle of a two-cell doorway, where fine-cell centres cannot fit the body', () => {
    const f = fixture(); f.block(10, 1, 2, 16);
    for (let x = 10; x < 12; x++) for (let y = 7; y < 9; y++) f.world.walkNow[y * f.w + x] = 1;
    f.player.x = 4.5; f.player.y = 7.5;
    expect(f.world.setPlayerRoute(7 * f.w + 18)).toBe(true);
    const points = f.finish();
    expect(points.some(p => p.x > 10 && p.x < 12 && p.y >= 7.7 && p.y <= 8.3)).toBe(true);
    expect([f.player.x, f.player.y]).toEqual([18.5, 7.5]);
  });

  it.each([false, true])('routes around a locked door, including when it closes during the walk (%s)', closesLater => {
    const f = fixture(true); f.block(10, 1, 2, 16);
    for (const y of [3, 4, 12, 13]) for (const x of [10, 11]) f.world.walkNow[y * f.w + x] = 1;
    if (!closesLater) f.world.lockDoor(0, true, true);
    expect(f.world.setPlayerRoute(4 * f.w + 19)).toBe(true);
    if (closesLater) { for (let i = 0; i < 5; i++) f.world.step(); f.world.lockDoor(0, true, true); }
    const points = f.finish();
    expect(points.some(p => p.x > 10 && p.x < 12 && p.y >= 12.7)).toBe(true);
    expect([f.player.x, f.player.y]).toEqual([19.5, 4.5]);
  });

  it('ends on nearby reachable floor when the click touches the edge of a prop', () => {
    const f = fixture(); f.block(8, 5, 5, 6);
    expect(f.world.setPlayerRoute(7 * f.w + 8)).toBe(true);
    f.finish();
    expect(f.player.x).toBeLessThan(8);
    expect(Math.hypot(f.player.x - 8.5, f.player.y - 7.5)).toBeLessThanOrEqual(3);
  });

  it('cancels an old route on an unreachable new click and lets the keyboard take over immediately', () => {
    const f = fixture(); f.block(10, 1, 2, 16);
    expect(f.world.setPlayerRoute(12 * f.w + 5)).toBe(true);
    expect(f.world.setPlayerRoute(7 * f.w + 19)).toBe(false);
    expect(f.player.routePoints).toBeNull();
    expect(f.world.setPlayerRoute(12 * f.w + 5)).toBe(true);
    f.world.setPlayerMove(-1, 0);
    expect(f.player.routePoints).toBeNull();
    const x = f.player.x; f.world.step(); expect(f.player.x).toBeLessThan(x);
  });

  it('stops at the destination precisely, including clicks in the current cell', () => {
    const f = fixture(); f.player.x = 3.2; f.player.y = 4.1;
    expect(f.world.setPlayerRoute(4 * f.w + 3)).toBe(true); f.finish();
    expect([f.player.x, f.player.y]).toEqual([3.5, 4.5]);
    const stopped = [f.player.x, f.player.y];
    for (let i = 0; i < 15; i++) f.world.step();
    expect([f.player.x, f.player.y]).toEqual(stopped);
  });

  it('uses a newly opened wall breach from the current walk grid', () => {
    const f = fixture(); f.block(10, 1, 2, 16);
    expect(f.world.setPlayerRoute(7 * f.w + 19)).toBe(false);
    for (let y = 7; y < 10; y++) for (let x = 10; x < 12; x++) f.world.walkNow[y * f.w + x] = 1;
    expect(f.world.setPlayerRoute(7 * f.w + 19)).toBe(true); f.finish();
    expect([f.player.x, f.player.y]).toEqual([19.5, 7.5]);
  });
});

describe('body-width route smoothing', () => {
  it('checks tiny diagonal corner crossings and integer endpoints in both directions', () => {
    const w = 12, h = 12, walk = new Uint8Array(w * h).fill(1), passable = (c: number) => !!walk[c];
    walk[5 * w + 5] = 0;
    expect(playerSegmentClear(w, h, { x: 3.5, y: 4.5 }, { x: 6.5, y: 4.11 }, passable)).toBe(false);
    for (const [a, b] of [[{ x: 3.5, y: 1.5 }, { x: 1, y: 3 }], [{ x: 1, y: 3 }, { x: 3.5, y: 1.5 }]]) {
      expect(playerSegmentClear(w, h, a, b, passable)).toBe(true);
    }
    const route = new PlayerNavigator(w, h).route({ x: 3.5, y: 5.5 }, 5 * w + 8, passable)!;
    expect(route).not.toBeNull();
    route.forEach((p, i) => { if (i) expect(playerSegmentClear(w, h, route[i - 1], p, passable)).toBe(true); });
  });
});

describe('mouse routes on the real base', () => {
  it.each([
    { from: [48.5, 73.5], to: [36, 52], name: 'front door and lobby counters' },
    { from: [45.5, 63.5], to: [62, 52], name: 'across the furnished lobby' },
    { from: [40.5, 27.5], to: [53, 37], name: 'around the presses' },
    { from: [67.5, 25.5], to: [76, 38], name: 'around the loading-bay crates' },
    { from: [48.5, 73.5], to: [87, 16], name: 'around the outside of the building' },
  ])('walks $name without sticking', ({ from, to }) => {
    const level = loadMint(), world = new SimWorld(level, 5); world.catchesEnabled = false;
    const player = world.spawnPlayer('front', 'Mouse'); player.x = from[0]; player.y = from[1];
    for (const key of level.json.keycards) player.keys.add(key.id);
    const passable = (c: number) => world.passable(c, player);
    expect(playerPointClear(level.w, level.h, player.x, player.y, passable)).toBe(true);
    expect(world.setPlayerRoute(to[1] * level.w + to[0])).toBe(true);
    for (let i = 0; i < 1000 && player.routePoints; i++) {
      const before = { x: player.x, y: player.y };
      world.step();
      expect(playerSegmentClear(level.w, level.h, before, player, passable)).toBe(true);
    }
    expect(player.routePoints).toBeNull();
    expect(Math.hypot(player.x - to[0] - .5, player.y - to[1] - .5)).toBeLessThanOrEqual(3);
  });

  it.each(['vent', 'sewer'])('still enters the %s when the mouse route reaches its mouth', entryId => {
    const level = loadMint(), world = new SimWorld(level, 5); world.catchesEnabled = false;
    const player = world.spawnPlayer('front', 'Mouse'), entry = level.json.entries.find(e => e.id === entryId)!;
    expect(world.setPlayerRoute(entry.spawn[1] * level.w + entry.spawn[0])).toBe(true);
    for (let i = 0; i < 1000 && player.routePoints; i++) world.step();
    expect(player.routePoints).toBeNull();
    world.step();
    expect(player.hidden).toBe(true); expect(player.portalTicks).toBeGreaterThan(0);
  });
});
