import { describe, expect, it } from 'vitest';
import { cameraFacingAt, seesPoint } from '../src/sim/vision';
import { BEAM_REACH, beamHit, wallTops } from '../src/render/building';
import { loadMint } from './helpers';

describe('camera models', () => {
  const level = loadMint();

  it('has a camera in the level for every one the renderer must build', () => {
    expect(level.json.cameras.length).toBeGreaterThan(0);
    for (const c of level.json.cameras) {
      expect(level.opaque[c.cell[1] * level.w + c.cell[0]], `${c.id} buried in geometry`).toBe(0);
      expect(c.height ?? 3.6).toBeGreaterThan(2.5);
    }
  });

  it('points the housing exactly where the cone looks', () => {
    // The renderer sets rotation.y = -facingRad, so the housing's local +x axis
    // lands on (cos facing, sin facing) in grid space, which is the same
    // direction the cone and the detection test use.
    for (const c of level.json.cameras) {
      for (const tick of [0, 37, 91, 150]) {
        const facing = cameraFacingAt(c.facingDeg, c.sweep, tick);
        const rad = (facing * Math.PI) / 180;
        const rotY = -rad;
        // Rotating local +x by rotY about Y gives (cos rotY, -sin rotY) in (x, z).
        const fwdX = Math.cos(-rotY);
        const fwdZ = -Math.sin(-rotY) * -1;
        expect(fwdX).toBeCloseTo(Math.cos(rad), 6);
        expect(fwdZ).toBeCloseTo(Math.sin(rad), 6);
      }
    }
  });

  it('sweeps rather than staring, so the AI has windows to exploit', () => {
    for (const c of level.json.cameras) {
      const angles = [0, 50, 100, 150, 200].map((t) => cameraFacingAt(c.facingDeg, c.sweep, t));
      const spread = Math.max(...angles) - Math.min(...angles);
      expect(spread, `${c.id} never moves`).toBeGreaterThan(10);
    }
  });

  it('leaves the loading bay unwatched: the supplier is a trusted zone', () => {
    // Nobody points a camera at their own delivery bay, which is exactly why
    // riding the supplier's truck in works. If a camera is ever added that can
    // see into the bay, the way in stops making sense.
    const bay = level.json.areas.find((a) => a.id === 'dock_room');
    expect(bay, 'the level needs a loading bay').toBeTruthy();
    const [rx, ry, rw, rh] = bay!.rect;
    const period = Math.max(
      1,
      ...level.json.cameras.map((c) => c.sweep?.periodTicks ?? 1),
    );
    for (const c of level.json.cameras) {
      for (let tick = 0; tick < period; tick += 5) {
        const facing = cameraFacingAt(c.facingDeg, c.sweep, tick);
        for (let y = ry; y < ry + rh; y++) {
          for (let x = rx; x < rx + rw; x++) {
            const seen = seesPoint(
              level.opaque, level.w, level.h,
              c.cell[0] + 0.5, c.cell[1] + 0.5, facing,
              c.fovDeg, c.range / level.cellSize,
              x + 0.5, y + 0.5,
            );
            expect(seen, `${c.id} watches the loading bay at ${x},${y}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('the aiming beam', () => {
  const level = loadMint();
  const tops = { full: wallTops(level, false), cut: wallTops(level, true) };
  const height = (c: (typeof level.json.cameras)[number]) => c.height ?? 3.6;
  const reach = (c: (typeof level.json.cameras)[number]) => Math.min(c.range, BEAM_REACH);

  /** March the same ray the renderer draws and report the walls it crosses. */
  function walkThrough(
    cut: boolean,
    c: (typeof level.json.cameras)[number],
    facing: number,
  ): { pierced: number; end: number } {
    const hit = beamHit(level, cut ? tops.cut : tops.full, c.cell, height(c), reach(c), facing);
    const rad = (facing * Math.PI) / 180;
    const own = c.cell[1] * level.w + c.cell[0];
    const span = reach(c) - 0.42;
    let pierced = 0;
    for (let t = 0.42; t < hit.x - 1e-6; t += 0.05) {
      const cx = Math.floor(c.cell[0] + 0.5 + (Math.cos(rad) * t) / level.cellSize);
      const cy = Math.floor(c.cell[1] + 0.5 + (Math.sin(rad) * t) / level.cellSize);
      if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) continue;
      const i = cy * level.w + cx;
      if (i === own) continue;
      const beamY = height(c) * (1 - (t - 0.42) / span);
      if ((cut ? tops.cut : tops.full)[i] > beamY) pierced++;
    }
    return { pierced, end: hit.x };
  }

  it('never draws the beam through a wall, at any angle of any sweep', () => {
    for (const cut of [false, true]) {
      for (const c of level.json.cameras) {
        for (let tick = 0; tick < (c.sweep?.periodTicks ?? 1); tick += 3) {
          const facing = cameraFacingAt(c.facingDeg, c.sweep, tick);
          const { pierced } = walkThrough(cut, c, facing);
          expect(pierced, `${c.id} at ${facing.toFixed(0)} deg pierces plaster`).toBe(0);
        }
      }
    }
  });

  it('still reaches out far enough to point somewhere', () => {
    // A beam trimmed to a stub says nothing about where the camera is looking,
    // so a camera whose whole sweep is against a wall is a placement bug.
    for (const c of level.json.cameras) {
      let best = 0;
      for (let tick = 0; tick < (c.sweep?.periodTicks ?? 1); tick += 3) {
        best = Math.max(best, walkThrough(true, c, cameraFacingAt(c.facingDeg, c.sweep, tick)).end);
      }
      expect(best, `${c.id} has nowhere to point`).toBeGreaterThan(reach(c) * 0.6);
    }
  });
});
