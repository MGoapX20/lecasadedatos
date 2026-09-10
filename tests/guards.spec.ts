import { describe, expect, it } from 'vitest';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

describe('guard behaviour', () => {
  const level = loadMint();

  it('escalates to a chase when a thief stands in plain view at range', () => {
    const world = new SimWorld(level, 7);
    world.respawnEnabled = false;
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0; // this test is about the guard, not the fair start
    const g = world.guards[0]; // corridor guard, holds at its first waypoint facing east
    world.step();
    // Park the player 6 m (12 cells) straight ahead of the guard, inside the cone.
    const rad = (g.facing * Math.PI) / 180;
    player.x = g.x + Math.cos(rad) * 12;
    player.y = g.y + Math.sin(rad) * 12;
    let firstChase = -1;
    for (let i = 0; i < 60; i++) {
      world.step();
      if (g.state === 'chase' && firstChase < 0) firstChase = i;
      // keep the player still in front of him
      player.x = g.x + Math.cos(rad) * 12;
      player.y = g.y + Math.sin(rad) * 12;
    }
    console.log(`state after 3s: ${g.state}, suspicion ${g.suspicion}, first chase at tick ${firstChase}`);
    expect(g.state).toBe('chase');
    expect(firstChase).toBeGreaterThanOrEqual(0);
    expect(firstChase).toBeLessThan(30);
  });

  it('gives a fresh player a few seconds before anyone can see him', () => {
    const world = new SimWorld(level, 7);
    world.respawnEnabled = false;
    const player = world.spawnPlayer('front', 'Tokyo');
    expect(player.graceTicks).toBeGreaterThan(0);
    const g = world.guards[0];
    const rad = (g.facing * Math.PI) / 180;
    for (let i = 0; i < 20; i++) {
      player.x = g.x + Math.cos(rad) * 3;
      player.y = g.y + Math.sin(rad) * 3;
      world.step();
    }
    expect(player.caughtCount).toBe(0);
    expect(g.state).toBe('patrol');
  });
});
