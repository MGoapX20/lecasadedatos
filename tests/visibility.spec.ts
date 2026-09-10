import { describe, expect, it } from 'vitest';
import { coneSamples, rayDistance } from '../src/level/visibility';
import { seesPoint } from '../src/sim/vision';
import { compileGuardProgram, poseAt } from '../src/sim/patrol';
import { SimWorld } from '../src/sim/world';
import { computeOpaqueWithDoors } from '../src/level/loader';
import { loadMint } from './helpers';

describe('vision cones match what the guards can actually see', () => {
  const level = loadMint();
  const programs = level.json.guards.map((g) => compileGuardProgram(level, g));

  it('never reports distance through a wall', () => {
    // A ray fired from the corridor into the vault hall must stop at the wall.
    const ox = 48.5;
    const oy = 33.5; // main corridor
    const d = rayDistance(level.opaque, level.w, level.h, ox, oy, 0, -1, 40);
    const hitY = oy - d;
    // Everything between the observer and the hit point must be clear.
    for (let s = 0.05; s < d; s += 0.25) {
      const cell = Math.floor(oy - s) * level.w + Math.floor(ox);
      expect(level.opaque[cell], `wall crossed at ${s} before reported hit ${d}`).toBe(0);
    }
    expect(d).toBeLessThan(40);
    void hitY;
  });

  it('keeps every cone vertex out of solid walls, for every guard over a full patrol', () => {
    let checked = 0;
    let inWall = 0;
    for (let gi = 0; gi < programs.length; gi++) {
      const def = level.json.guards[gi];
      const range = def.vision.range / level.cellSize;
      for (let tick = 0; tick < 1200; tick += 7) {
        const pose = poseAt(programs[gi], tick);
        if (!pose.present) continue;
        for (const s of coneSamples(
          level.opaque, level.w, level.h,
          pose.x, pose.y, pose.facingDeg, def.vision.fovDeg, range,
        )) {
          const px = pose.x + Math.cos(s.angle) * s.dist;
          const py = pose.y + Math.sin(s.angle) * s.dist;
          const cx = Math.floor(px);
          const cy = Math.floor(py);
          if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) continue;
          checked++;
          if (level.opaque[cy * level.w + cx]) inWall++;
        }
      }
    }
    console.log(`cone vertices checked ${checked}, inside a wall ${inWall}`);
    expect(checked).toBeGreaterThan(5000);
    expect(inWall, 'no cone vertex may sit inside a wall').toBe(0);
  });

  it('agrees with the simulation: everything the cone covers is genuinely visible', () => {
    let tested = 0;
    let disagreed = 0;
    for (let gi = 0; gi < programs.length; gi++) {
      const def = level.json.guards[gi];
      const range = def.vision.range / level.cellSize;
      for (let tick = 0; tick < 900; tick += 11) {
        const pose = poseAt(programs[gi], tick);
        if (!pose.present) continue;
        for (const s of coneSamples(
          level.opaque, level.w, level.h,
          pose.x, pose.y, pose.facingDeg, def.vision.fovDeg, range,
        )) {
          // A point just inside the drawn edge must be visible to the guard.
          const d = s.dist * 0.92;
          if (d < 0.5) continue;
          const px = pose.x + Math.cos(s.angle) * d;
          const py = pose.y + Math.sin(s.angle) * d;
          tested++;
          if (
            !seesPoint(
              level.opaque, level.w, level.h,
              pose.x, pose.y, pose.facingDeg, def.vision.fovDeg + 0.6, range, px, py,
            )
          ) {
            disagreed++;
          }
        }
      }
    }
    const rate = disagreed / Math.max(1, tested);
    console.log(`cone/sim agreement: ${tested - disagreed}/${tested} (${((1 - rate) * 100).toFixed(2)}%)`);
    expect(tested).toBeGreaterThan(3000);
    expect(rate, 'the cone must not paint ground the guard cannot see').toBeLessThan(0.005);
  });
});

describe('shut doors block sight', () => {
  const level = loadMint();

  it('hides a thief behind a door the chief has just locked', () => {
    const world = new SimWorld(level, 11);
    const di = level.doors.findIndex((d) => d.id === 'd_manager');
    const door = level.doors[di];
    // A guard in the corridor, looking south straight through the doorway.
    const gx = door.rect[0] + door.rect[2] / 2;
    const doorY = door.rect[1] + door.rect[3] / 2;
    const guardY = doorY - 3;
    const thiefY = doorY + 3;

    const canSee = () =>
      seesPoint(world.opaqueNow, level.w, level.h, gx, guardY, 90, 100, 20, gx, thiefY);

    world.lockDoor(di, false, false);
    expect(canSee(), 'an open doorway must not block sight').toBe(true);

    world.lockDoor(di, true, false);
    expect(canSee(), 'a locked door must block sight').toBe(false);

    world.lockDoor(di, false, false);
    expect(canSee(), 'unlocking restores the sight line').toBe(true);
  });

  it('restores sight-blocking after a door was picked open in an earlier round', () => {
    const world = new SimWorld(level, 13);
    const di = level.doors.findIndex((d) => d.id === 'd_vault');
    const opaqueCount = () => {
      const [rx, ry, rw, rh] = level.doors[di].rect;
      let n = 0;
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) if (world.opaqueNow[y * level.w + x]) n++;
      }
      return n;
    };
    const cells = level.doors[di].rect[2] * level.doors[di].rect[3];
    expect(opaqueCount(), 'a locked door starts opaque').toBe(cells);

    world.doorPickedOpen[di] = 1;
    world.refreshOpacity();
    expect(opaqueCount(), 'picking it open lets sight through').toBe(0);

    // What a new round does: restore locks and clear picked doors.
    level.doors.forEach((d, i) => (world.doorLocked[i] = d.locked ? 1 : 0));
    world.doorPickedOpen.fill(0);
    world.refreshOpacity();
    expect(opaqueCount(), 'a fresh round must block sight again').toBe(cells);
  });

  it('keeps the planner and the simulation looking at the same doors', () => {
    const world = new SimWorld(level, 12);
    const baked = computeOpaqueWithDoors(
      level,
      Uint8Array.from(level.doors, (d, i) => (world.doorLocked[i] && !world.doorPickedOpen[i] ? 1 : 0)),
      new Uint8Array(level.cellCount),
    );
    expect(Array.from(baked)).toEqual(Array.from(world.opaqueNow));
  });
});
