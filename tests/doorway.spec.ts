import { describe, expect, it } from 'vitest';
import { crossingDoorway } from '../src/level/doorway';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

describe('when a door swings open', () => {
  const level = loadMint();
  const idx = (id: string) => level.doorIndex.get(id)!;
  // d_west is [20, 28, 4, 2]: a wide opening centred on (22, 29), so the way
  // through runs north-south and the corridor below runs east-west past it.
  const west = idx('d_west');
  const EAST = 0;
  const NORTH = -90;
  const SOUTH = 90;

  it('opens for someone walking through it', () => {
    expect(crossingDoorway(level, west, 22, 31, NORTH)).toBe(true);
    expect(crossingDoorway(level, west, 22, 27, SOUTH)).toBe(true);
  });

  it('stays shut for a guard walking the corridor past it', () => {
    for (let x = 18; x <= 26; x++) {
      expect(crossingDoorway(level, west, x, 31, EAST), `guard at x=${x}`).toBe(false);
    }
  });

  it('opens for anyone standing in the opening, whichever way they face', () => {
    for (const facing of [0, 90, -90, 180]) {
      expect(crossingDoorway(level, west, 22, 29, facing)).toBe(true);
    }
  });

  it('ignores someone alongside the wall rather than in the opening', () => {
    expect(crossingDoorway(level, west, 28, 31, NORTH)).toBe(false);
    expect(crossingDoorway(level, west, 16, 31, NORTH)).toBe(false);
  });

  it('ignores someone still a room away', () => {
    expect(crossingDoorway(level, west, 22, 34, NORTH)).toBe(false);
  });

  it('reads a tall door across its short axis too', () => {
    // d_side is [82, 32, 2, 4]: you travel east-west through this one.
    const side = idx('d_side');
    expect(crossingDoorway(level, side, 80.5, 34, EAST)).toBe(true);
    expect(crossingDoorway(level, side, 80.5, 34, NORTH)).toBe(false);
  });

  it('leaves the doors alone while the guards walk their rounds', () => {
    // The complaint that started this: every guard passing a door set it
    // swinging. With nobody in the building, doors should be still almost all
    // of the time, and only move when a guard actually goes through one.
    const world = new SimWorld(level, 7);
    let openTicks = 0;
    const ticks = 2000;
    for (let i = 0; i < ticks; i++) {
      world.step();
      for (let d = 0; d < level.doors.length; d++) {
        const swung = world.guards.some(
          (g) => g.present && crossingDoorway(level, d, g.x, g.y, g.facing),
        );
        if (swung) openTicks++;
      }
    }
    const share = openTicks / (ticks * level.doors.length);
    expect(share, `doors swung on ${(share * 100).toFixed(1)}% of door-ticks`).toBeLessThan(0.05);
  });
});
