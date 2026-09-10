import { describe, expect, it } from 'vitest';
import { cellOf, fineToPlan, nearestWalkable } from '../src/level/loader';
import { floodFill, staticAStar } from '../src/level/grid';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

describe('mint_v1 level', () => {
  const level = loadMint();

  it('builds a grid of the declared size', () => {
    expect(level.w).toBe(96);
    expect(level.h).toBe(64);
    expect(level.walk.length).toBe(96 * 64);
    expect(level.pwalk.length).toBe(48 * 32);
  });

  it('has a walkable exterior ring joining every entry spawn', () => {
    const spawns = level.json.entries.map((e) => cellOf(level, e.spawn));
    const seen = floodFill(level.walk, level.w, level.h, spawns[0]);
    for (const s of spawns) {
      expect(level.walk[s], `spawn ${s} must be walkable`).toBe(1);
      expect(seen[s], `spawn ${s} must join the exterior ring`).toBe(1);
    }
  });

  it('reaches the vault from every entry when all doors are open', () => {
    const open = new Uint8Array(level.cellCount); // no blockers
    for (const e of level.json.entries) {
      const from = cellOf(level, e.cell);
      const path = staticAStar(
        level.walk,
        level.w,
        level.h,
        from,
        level.vaultFineCell,
        level.scratch,
        open,
      );
      expect(path, `entry ${e.id} must reach the vault`).not.toBeNull();
    }
  });

  it('places every guard waypoint, camera and keycard on walkable ground', () => {
    for (const g of level.json.guards) {
      for (const wp of g.patrol.waypoints) {
        const c = cellOf(level, wp.cell);
        expect(level.walk[c], `guard ${g.id} waypoint ${wp.cell} must be walkable`).toBe(1);
      }
    }
    for (const k of level.json.keycards) {
      expect(level.walk[cellOf(level, k.cell)], `keycard ${k.id}`).toBe(1);
    }
    for (const s of level.json.safeSpots) {
      expect(level.walk[cellOf(level, s)], `safe spot ${s}`).toBe(1);
    }
  });

  it('keeps door cells clear of furniture and reachable on the plan grid', () => {
    for (const d of level.doors) {
      const [x, y, w, h] = d.rect;
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          expect(level.walk[yy * level.w + xx], `door ${d.id} cell ${xx},${yy}`).toBe(1);
        }
      }
      const p = fineToPlan(level, y * level.w + x);
      expect(level.pwalk[p], `door ${d.id} plan cell`).toBe(1);
    }
  });

  it('exposes the vault and every entry on the coarse plan grid', () => {
    expect(level.pwalk[level.vaultPlanCell]).toBe(1);
    for (const e of level.json.entries) {
      expect(level.pwalk[fineToPlan(level, cellOf(level, e.spawn))], `entry ${e.id} spawn`).toBe(1);
      expect(level.pwalk[fineToPlan(level, cellOf(level, e.cell))], `entry ${e.id} cell`).toBe(1);
    }
  });

  it('mounts every camera somewhere it can actually see from', () => {
    for (const c of level.json.cameras) {
      const cell = cellOf(level, c.cell);
      expect(level.opaque[cell], `camera ${c.id} is buried inside solid geometry`).toBe(0);
    }
  });

  it('nearestWalkable escapes a wall', () => {
    const inWall = cellOf(level, [13, 30]);
    expect(level.walk[inWall]).toBe(0);
    expect(level.walk[nearestWalkable(level, inWall)]).toBe(1);
  });
});

describe('being caught throws you outside', () => {
  const level = loadMint();

  it('has at least one safe spot outside the building', () => {
    const outdoor = level.json.safeSpots.filter((s) => !level.indoor[cellOf(level, s)]);
    expect(outdoor.length).toBeGreaterThan(0);
  });

  it('keeps furniture out of the wall grid the renderer builds from', () => {
    // The building used to grow a plaster block over every solid prop, which
    // buried the floor plan under anonymous cubes. Structure and furniture are
    // separate grids now: props still block, but they are never architecture.
    for (const p of level.json.props) {
      if (!p.solid) continue;
      const i = p.cell[1] * level.w + p.cell[0];
      expect(level.wall[i], `${p.kind} at ${p.cell} must not be a wall`).toBe(0);
    }
    // Every wall cell is unwalkable, so nothing opened up that used to block.
    for (let i = 0; i < level.cellCount; i++) {
      if (level.wall[i]) expect(level.walk[i]).toBe(0);
    }
  });

  it('walls off the rooms it is supposed to, and only from the plan', () => {
    // A spot check either side of the corridor's north wall (y = 28-29).
    const at = (x: number, y: number) => level.wall[y * level.w + x];
    expect(at(16, 28), 'corridor/west-wing partition').toBe(1);
    expect(at(16, 31), 'inside the corridor').toBe(0);
    expect(at(16, 20), 'inside the west wing').toBe(0);
    expect(at(12, 30), 'west shell').toBe(1);
    expect(at(5, 30), 'out in the plaza').toBe(0);
  });

  it('respawns a caught player outside, never in the next room along', () => {
    const world = new SimWorld(level, 3);
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0; // the catch has to be certain here
    // Standing deep inside, right next to the vault.
    player.x = level.json.vault.cell[0] + 0.5;
    player.y = level.json.vault.cell[1] + 0.5;
    // Walk the player onto the vault guard so a catch is certain.
    const guard = world.guards[2];
    for (let i = 0; i < 40 && player.respawnIn === 0; i++) {
      player.x = guard.x;
      player.y = guard.y;
      world.step();
    }
    expect(player.caughtCount, 'the guard should have caught the player').toBeGreaterThan(0);
    const cell =
      Math.floor(player.y) * level.w + Math.floor(player.x);
    expect(level.indoor[cell], 'respawn must be outside the building').toBe(0);
  });
});
