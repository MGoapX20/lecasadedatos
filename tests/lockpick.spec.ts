import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { LockpickGame, DEFAULT_PICK } from '../src/sim/lockpick';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

const TICK_HZ = 20;

function game(spec = DEFAULT_PICK, grace = 400): LockpickGame {
  return new LockpickGame(0, spec, new Rng(9), TICK_HZ, grace);
}

describe('the lockpicking mini-game', () => {
  it('sweeps the marker back and forth without leaving the bar', () => {
    const g = game({ pins: 3, zone: 0.2, speed: 1.4 });
    let min = 1;
    let max = 0;
    for (let i = 0; i < 400; i++) {
      g.step();
      min = Math.min(min, g.marker);
      max = Math.max(max, g.marker);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min, 'the marker must actually travel').toBeGreaterThan(0.7);
  });

  it('sets a pin when pressed inside the zone and never when outside', () => {
    const g = game({ pins: 4, zone: 0.2, speed: 1.0 });
    let hits = 0;
    let misses = 0;
    for (let i = 0; i < 600 && g.pinsSet < 4; i++) {
      g.step();
      if (g.inZone) {
        const before = g.pinsSet;
        const r = g.attempt();
        expect(r === 'hit' || r === 'done').toBe(true);
        expect(g.pinsSet).toBe(before + 1);
        hits++;
      }
    }
    expect(hits).toBe(4);
    expect(misses).toBe(0);
  });

  it('keeps the zone reachable rather than pinned to an edge', () => {
    for (let seed = 0; seed < 40; seed++) {
      const g = new LockpickGame(0, { pins: 5, zone: 0.13, speed: 1.5 }, new Rng(seed), TICK_HZ, 400);
      for (let p = 0; p < 5; p++) {
        expect(g.zoneStart).toBeGreaterThanOrEqual(0.05);
        expect(g.zoneEnd).toBeLessThanOrEqual(0.95);
        while (!g.inZone) g.step();
        g.attempt();
      }
    }
  });

  it('never hard-fails: a miss costs the pin, not the lock', () => {
    const g = game({ pins: 2, zone: 0.15, speed: 1.0 });
    for (let i = 0; i < 40; i++) {
      g.step();
      if (!g.inZone) expect(g.attempt()).toBe('miss');
    }
    expect(g.pinsSet).toBe(0);
    expect(g.complete, 'missing must not lock the player out').toBe(false);
  });

  it('rescues someone who is trying, but never someone who just waits', () => {
    // Nobody home: standing at the door forever must achieve nothing, or
    // waiting becomes a third way in that beats both picking and the card.
    const idle = game({ pins: 3, zone: 0.05, speed: 2 }, 8 * TICK_HZ);
    for (let i = 0; i < 30 * TICK_HZ; i++) idle.step();
    expect(idle.pinsSet).toBe(0);
    expect(idle.complete, 'waiting alone must not open a lock').toBe(false);

    // One pin set, then struggling: mercy takes over.
    const trying = game({ pins: 3, zone: 0.2, speed: 1 }, 8 * TICK_HZ);
    while (!trying.inZone) trying.step();
    trying.attempt();
    expect(trying.pinsSet).toBe(1);
    expect(trying.complete).toBe(false);
    for (let i = 0; i < 8 * TICK_HZ; i++) trying.step();
    expect(trying.complete, 'a struggling visitor must eventually get through').toBe(true);
  });
});

describe('every lock is fair to press', () => {
  const level = loadMint();

  it('never demands a press window tighter than a person can hit', () => {
    for (const d of level.doors) {
      // A gate with no lock has nothing to press; see `pickable` in the schema.
      if (d.pickable === false) continue;
      const spec = d.pick;
      expect(spec, `${d.id} has no pick spec`).toBeDefined();
      const windowMs = (spec!.zone / spec!.speed) * 1000;
      expect(windowMs, `${d.id} gives only ${windowMs.toFixed(0)}ms to press`).toBeGreaterThan(120);
      expect(spec!.pins, `${d.id} asks for too many pins`).toBeLessThanOrEqual(3);
    }
  });
});

describe('picking a lock in the world', () => {
  const level = loadMint();

  it('starts when the player stands against a locked door and opens it on success', () => {
    const world = new SimWorld(level, 3);
    const player = world.spawnPlayer('front', 'Tokyo');
    const di = level.doors.findIndex((d) => d.id === 'd_side');
    const door = level.doors[di];
    // Stand on the door cell, holding still.
    player.x = door.rect[0] + door.rect[2] / 2;
    player.y = door.rect[1] + door.rect[3] / 2;
    world.setPlayerMove(0, 0);
    world.step();
    expect(world.activePick, 'standing at a locked door starts the mini-game').not.toBeNull();
    expect(world.activePick!.door).toBe(di);

    let guard = 0;
    while (!world.doorPickedOpen[di] && guard++ < 4000) {
      world.step();
      if (world.activePick?.inZone) world.attemptPick();
    }
    expect(world.doorPickedOpen[di], 'hitting every pin must open the door').toBe(1);
    expect(world.activePick).toBeNull();
  });

  it('offers nothing to pick at the vault, which only answers to the card', () => {
    const world = new SimWorld(level, 3);
    const player = world.spawnPlayer('front', 'Tokyo');
    const di = level.doors.findIndex((d) => d.id === 'd_vault');
    const door = level.doors[di];
    player.x = door.rect[0] + door.rect[2] / 2;
    player.y = door.rect[1] + door.rect[3] / 2;
    world.setPlayerMove(0, 0);
    for (let i = 0; i < 20; i++) world.step();
    expect(world.activePick, 'the vault must not offer a lock to pick').toBeNull();
    expect(world.doorPickedOpen[di]).toBe(0);
  });

  it('turns heads on a first fumble and brings them over on the next', () => {
    const world = new SimWorld(level, 3);
    const player = world.spawnPlayer('front', 'Tokyo');
    const g = world.guards[1];
    player.x = g.x + 4;
    player.y = g.y + 4;

    g.state = 'patrol';
    world.makeNoise(player.x, player.y, 12, false);
    expect(g.state, 'the first fumble should only turn a head').toBe('suspicious');

    g.state = 'patrol';
    world.makeNoise(player.x, player.y, 12, true);
    expect(g.state, 'repeated fumbles must be investigated').toBe('chase');
    expect(Math.hypot(g.lastSeenX - player.x, g.lastSeenY - player.y)).toBeLessThan(0.01);
  });

  it('leaves the far side of the building undisturbed', () => {
    const world = new SimWorld(level, 3);
    const before = world.guards.map((g) => g.state);
    world.makeNoise(2.5, 2.5, 6);
    expect(world.guards.map((g) => g.state)).toEqual(before);
  });
});

describe('the card opens doors visibly', () => {
  const level = loadMint();

  it('lets the card holder through the vault door without picking it', () => {
    const world = new SimWorld(level, 21);
    const player = world.spawnPlayer('front', 'Tokyo');
    const di = level.doors.findIndex((d) => d.id === 'd_vault');
    expect(world.doorOpenFor(di, player), 'shut without the card').toBe(false);
    player.keys.add('k_manager');
    expect(world.doorOpenFor(di, player), 'the card must open it').toBe(true);
    // The lock itself is untouched: it is open for this thief, not for the world.
    expect(world.doorLocked[di]).toBe(1);
    expect(world.doorPickedOpen[di]).toBe(0);
  });

  it('announces the moment the card is actually used, once', () => {
    const world = new SimWorld(level, 22);
    const player = world.spawnPlayer('front', 'Tokyo');
    player.keys.add('k_manager');
    const di = level.doors.findIndex((d) => d.id === 'd_vault');
    const rect = level.doors[di].rect;
    let badges = 0;
    for (let i = 0; i < 12; i++) {
      player.x = rect[0] + rect[2] / 2;
      player.y = rect[1] + 0.5;
      world.step();
      for (const e of world.drainEvents()) if (e.kind === 'badged' && e.door === di) badges++;
    }
    expect(badges, 'the badge should announce itself exactly once').toBe(1);
  });
});
