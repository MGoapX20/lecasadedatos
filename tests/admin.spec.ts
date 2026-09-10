import { expect, it } from 'vitest';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

it('disables arrests while leaving guards active, then restores catches', () => {
  const world = new SimWorld(loadMint(), 5);
  const player = world.spawnPlayer('front', 'Test');
  const guard = world.guards[0];
  const expose = () => {
    player.graceTicks = 0;
    player.x = guard.x;
    player.y = guard.y;
    world.step();
  };
  world.catchesEnabled = false;
  for (let i = 0; i < 20; i++) expose();
  expect(player.caughtCount).toBe(0);
  expect(world.drainEvents().some(e => e.kind === 'caught')).toBe(false);
  world.catchesEnabled = true;
  for (let i = 0; i < 20 && !player.caughtCount; i++) expose();
  expect(player.caughtCount).toBeGreaterThan(0);
});

it('toggles the real uniform inventory and pickup availability', () => {
  const world = new SimWorld(loadMint(), 5);
  expect(() => world.setPlayerUniform(true)).toThrow('requires a player');
  const player = world.spawnPlayer('front', 'Test');
  world.setPlayerUniform(true);
  expect(world.isDisguised(player)).toBe(true);
  const index = world.level.json.keycards.findIndex(k => k.kind === 'uniform');
  expect(world.keyTaken[index]).toBe(1);
  world.setPlayerUniform(false);
  expect(world.isDisguised(player)).toBe(false);
  expect(world.keyTaken[index]).toBe(0);
});

it('restores camera power after an indefinite operator cut', () => {
  const world = new SimWorld(loadMint(), 5);
  world.setPowerEnabled(false);
  world.tick += 1_000_000;
  expect(world.camerasDown).toBe(true);
  world.setPowerEnabled(true);
  expect(world.camerasDown).toBe(false);
});
