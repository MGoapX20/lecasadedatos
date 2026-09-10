import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { WireCutGame } from '../src/sim/wirecut';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

const TICK_HZ = 20;

function game(seed = 3, count = 4, live = 2): WireCutGame {
  return new WireCutGame(0, new Rng(seed), TICK_HZ, TICK_HZ * 14, count, live);
}

describe('the fuse box wire panel', () => {
  it('starts with the asked-for number of live wires and the cutters on one', () => {
    const g = game();
    expect(g.wires).toHaveLength(4);
    expect(g.liveLeft).toBe(2);
    expect(g.wires[g.cursor].live, 'the cutters should start on something worth cutting').toBe(true);
  });

  it('goes dark once every live wire is cut', () => {
    const g = game();
    let guard = 0;
    while (!g.complete && guard++ < 40) {
      const i = g.wires.findIndex((w) => w.live && !w.cut);
      g.select(i);
      g.cut();
    }
    expect(g.complete).toBe(true);
    expect(g.liveLeft).toBe(0);
  });

  it('shorts on an earth wire, jams the cutters, and makes no progress', () => {
    const g = game();
    const earth = g.wires.findIndex((w) => !w.live);
    g.select(earth);
    expect(g.cut()).toBe('short');
    expect(g.shorts).toBe(1);
    expect(g.jammed, 'a short should jam the cutters for a moment').toBe(true);
    expect(g.liveLeft).toBe(2);
    // Jammed cutters do nothing at all, even on a live wire.
    g.select(g.wires.findIndex((w) => w.live));
    expect(g.cut()).toBe('nothing');
    for (let i = 0; i < TICK_HZ; i++) g.step();
    expect(g.jammed).toBe(false);
    expect(g.cut()).toBe('cut');
  });

  it('ignores a wire that is already cut', () => {
    const g = game();
    const live = g.wires.findIndex((w) => w.live);
    g.select(live);
    expect(g.cut()).toBe('cut');
    expect(g.cut()).toBe('nothing');
  });

  it('wraps the cutters around the panel', () => {
    const g = game();
    g.select(0);
    g.moveCursor(-1);
    expect(g.cursor).toBe(g.wires.length - 1);
    g.moveCursor(1);
    expect(g.cursor).toBe(0);
  });

  it('gives way eventually, but only to somebody who actually cut something', () => {
    const g = game();
    for (let i = 0; i < TICK_HZ * 20; i++) g.step();
    expect(g.complete, 'standing at the box doing nothing must not open it').toBe(false);
    g.select(g.wires.findIndex((w) => w.live));
    g.cut();
    expect(g.complete, 'one cut plus the grace period is enough').toBe(true);
  });
});

describe('the fuse box in the world', () => {
  const level = loadMint();
  const fuseIdx = level.json.keycards.findIndex((k) => k.kind === 'fuse');
  const fuse = level.json.keycards[fuseIdx];

  function standAtTheBox(): { world: SimWorld; player: ReturnType<SimWorld['spawnPlayer']> } {
    const world = new SimWorld(level, 11);
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0;
    player.x = fuse.cell[0] + 0.5;
    player.y = fuse.cell[1] + 0.5;
    world.setPlayerMove(0, 0);
    return { world, player };
  }

  it('opens the panel instead of handing the fuse over for walking past', () => {
    const { world, player } = standAtTheBox();
    world.step();
    expect(world.activeWire, 'standing at the box should open the panel').not.toBeNull();
    expect(player.keys.has(fuse.id), 'the fuse must be worked for, not walked over').toBe(false);
    expect(world.camerasDown).toBe(false);
  });

  it('kills the cameras only when the last live wire goes', () => {
    const { world, player } = standAtTheBox();
    world.step();
    const g = world.activeWire!;
    let guard = 0;
    while (world.activeWire && guard++ < 40) {
      const i = world.activeWire.wires.findIndex((w) => w.live && !w.cut);
      world.activeWire.select(i);
      world.attemptCut();
      world.step();
    }
    expect(g.liveLeft).toBe(0);
    expect(player.keys.has(fuse.id)).toBe(true);
    expect(world.camerasDown, 'the last wire should take the cameras with it').toBe(true);
  });

  it('brings the guards over when the panel shorts', () => {
    const { world } = standAtTheBox();
    world.step();
    const g = world.activeWire!;
    g.select(g.wires.findIndex((w) => !w.live));
    world.attemptCut();
    const noises = world.drainEvents().filter((e) => e.kind === 'noise');
    expect(noises.length, 'a short is loud').toBeGreaterThan(0);
  });

  it('closes the panel when the player walks away', () => {
    const { world } = standAtTheBox();
    world.step();
    expect(world.activeWire).not.toBeNull();
    world.setPlayerMove(1, 0);
    for (let i = 0; i < 12; i++) world.step();
    expect(world.activeWire, 'walking off the box should drop the panel').toBeNull();
  });
});
