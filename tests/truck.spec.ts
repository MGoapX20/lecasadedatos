import { describe, expect, it } from 'vitest';
import { SimWorld } from '../src/sim/world';
import { stopForCycle, truckIsOpen, truckPoseAt, type DeliveryDef } from '../src/sim/truck';
import { loadMint } from './helpers';

const level = loadMint();
const def = level.json.delivery as DeliveryDef;
const HZ = level.json.rules.tickHz;

describe("the supplier's delivery round", () => {
  it('is authored on the level', () => {
    expect(def, 'the level needs a delivery round for the loading bay to work').toBeTruthy();
    expect(def.stops.length).toBeGreaterThanOrEqual(3);
  });

  it('fits a whole round trip inside its cycle, from every shop', () => {
    // If a leg overran the cycle the truck would teleport at the wrap, so this
    // is the constraint that keeps the loop continuous.
    for (let stop = 0; stop < def.stops.length; stop++) {
      const seen = new Set<string>();
      for (let t = 0; t < def.cycleTicks; t++) {
        const p = truckPoseAt({ ...def, stops: [def.stops[stop]] }, HZ, t);
        seen.add(p.phase);
      }
      expect([...seen], `shop ${stop} never lets the truck finish its round`).toContain('unloading');
    }
  });

  it('visits different shops on different rounds', () => {
    const visited = new Set<number>();
    for (let c = 0; c < 40; c++) visited.add(stopForCycle(def, c));
    expect(visited.size, 'the truck should not always collect from the same shop').toBeGreaterThan(1);
  });

  it('runs the same route for the same tick, every time', () => {
    for (const t of [0, 137, 611, 1500, 4321]) {
      const a = truckPoseAt(def, HZ, t);
      const b = truckPoseAt(def, HZ, t);
      expect([a.x, a.y, a.phase]).toEqual([b.x, b.y, b.phase]);
    }
  });

  it('stands still with the shutters up, at a shop and in the bay', () => {
    let loading = 0;
    let unloading = 0;
    for (let t = 0; t < def.cycleTicks; t++) {
      const p = truckPoseAt(def, HZ, t);
      if (p.phase === 'loading') loading++;
      if (p.phase === 'unloading') unloading++;
      if (truckIsOpen(p)) expect(p.phase === 'loading' || p.phase === 'unloading').toBe(true);
    }
    expect(loading).toBe(def.loadTicks);
    expect(unloading).toBe(def.unloadTicks);
  });

  it('comes back to the bay to be emptied', () => {
    let t = 0;
    while (truckPoseAt(def, HZ, t).phase !== 'unloading' && t < def.cycleTicks) t++;
    const p = truckPoseAt(def, HZ, t);
    expect(Math.hypot(p.x - (def.dockCell[0] + 0.5), p.y - (def.dockCell[1] + 0.5))).toBeLessThan(0.6);
  });
});

describe('stowing away in the truck', () => {
  /** Wind the world on to the next moment the truck is loading at a shop. */
  function atAShop(): { world: SimWorld; stopTick: number } {
    const world = new SimWorld(level, 5);
    let t = 0;
    while (truckPoseAt(def, HZ, t).phase !== 'loading' && t < def.cycleTicks) t++;
    return { world, stopTick: t };
  }

  it('lets the player climb in only when it is stopped and within reach', () => {
    const { world, stopTick } = atAShop();
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0;
    world.tick = stopTick - 1;
    world.step();
    // Standing at the front door, nowhere near the shop.
    expect(world.canBoardTruck()).toBe(false);
    player.x = world.truck.x;
    player.y = world.truck.y;
    expect(world.canBoardTruck(), 'standing at an open truck should offer a ride').toBe(true);
    expect(world.boardTruck()).toBe(true);
    expect(world.playerInTruck).toBe(true);
    expect(player.hidden, 'a stowaway must not be visible to the guards').toBe(true);
  });

  it('refuses a moving truck', () => {
    const world = new SimWorld(level, 5);
    const player = world.spawnPlayer('front', 'Tokyo');
    let t = 0;
    while (truckPoseAt(def, HZ, t).phase !== 'outbound' && t < def.cycleTicks) t++;
    world.tick = t - 1;
    world.step();
    player.x = world.truck.x;
    player.y = world.truck.y;
    expect(world.canBoardTruck(), 'you cannot jump onto a moving lorry').toBe(false);
    expect(world.boardTruck()).toBe(false);
  });

  it('carries the player through the shut gate and puts them down inside', () => {
    const { world, stopTick } = atAShop();
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0;
    world.tick = stopTick - 1;
    world.step();
    player.x = world.truck.x;
    player.y = world.truck.y;
    world.boardTruck();

    const gate = level.doors.findIndex((d) => d.id === 'd_dock_outer');
    expect(world.doorLocked[gate], 'the bay gate stays shut for people').toBe(1);
    expect(level.doors[gate].pickable, 'and it has no lock to pick').toBe(false);

    let guard = 0;
    while (world.playerInTruck && guard++ < def.cycleTicks) world.step();
    expect(world.playerInTruck, 'the ride has to end').toBe(false);
    expect(player.hidden).toBe(false);
    const insideCell = Math.floor(player.y) * level.w + Math.floor(player.x);
    expect(level.indoor[insideCell], 'the truck should have carried them inside').toBe(1);
  });

  it('rides along with the truck rather than standing still', () => {
    const { world, stopTick } = atAShop();
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0;
    world.tick = stopTick - 1;
    world.step();
    player.x = world.truck.x;
    player.y = world.truck.y;
    world.boardTruck();
    const start = { x: player.x, y: player.y };
    for (let i = 0; i < def.loadTicks + 60; i++) world.step();
    expect(world.playerInTruck).toBe(true);
    expect(Math.hypot(player.x - start.x, player.y - start.y), 'the player moves with it').toBeGreaterThan(2);
    expect(Math.hypot(player.x - world.truck.x, player.y - world.truck.y)).toBeLessThan(0.01);
  });

  it('lets the player think better of it while it is still stopped', () => {
    const { world, stopTick } = atAShop();
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0;
    world.tick = stopTick - 1;
    world.step();
    player.x = world.truck.x;
    player.y = world.truck.y;
    world.boardTruck();
    expect(world.leaveTruck()).toBe(true);
    expect(world.playerInTruck).toBe(false);
    expect(player.hidden).toBe(false);
  });
});
