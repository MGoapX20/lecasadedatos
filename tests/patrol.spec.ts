import { describe, expect, it } from 'vitest';
import { compileGuardProgram, poseAt } from '../src/sim/patrol';
import { loadMint } from './helpers';

describe('continuous guard patrols', () => {
  const level = loadMint();

  for (const guard of level.json.guards) {
    it(`${guard.id} walks every leg and crosses the cycle boundary at walking speed`, () => {
      const program = compileGuardProgram(level, guard);
      const segment = program.segments[0];
      if (segment.kind !== 'loop') throw new Error('Expected a patrol loop');
      // Isolate the repeating patrol from the separately scheduled shift change.
      program.segments = [segment];
      let previous = poseAt(program, 0);
      for (let tick = 1; tick <= Math.ceil(segment.period * 2); tick++) {
        const pose = poseAt(program, tick);
        expect(Math.hypot(pose.x - previous.x, pose.y - previous.y), `tick ${tick}`)
          .toBeLessThanOrEqual(program.speedCellsPerTick + 1e-8);
        expect(level.walk[Math.floor(pose.y) * level.w + Math.floor(pose.x)]).toBe(1);
        previous = pose;
      }
      const before = poseAt(program, segment.period - 0.001);
      const after = poseAt(program, segment.period);
      expect(Math.hypot(after.x - before.x, after.y - before.y))
        .toBeLessThanOrEqual(program.speedCellsPerTick * 0.001 + 1e-8);
    });
  }

  it('retraces an open route and pauses once at each endpoint', () => {
    const program = compileGuardProgram(level, {
      ...level.json.guards[0],
      patrol: { loop: false, waypoints: [
        { cell: [18, 45], holdTicks: 26 },
        { cell: [40, 45], holdTicks: 22 },
      ] },
    });
    const segment = program.segments[0];
    if (segment.kind !== 'loop') throw new Error('Expected a patrol loop');
    program.segments = [segment];
    const travel = (segment.period - 26 - 22) / 2;
    for (let dt = 0; dt < travel; dt++) {
      const outward = poseAt(program, 26 + dt);
      const returning = poseAt(program, segment.period - dt);
      expect(returning.x).toBeCloseTo(outward.x, 8);
      expect(returning.y).toBeCloseTo(outward.y, 8);
    }
    expect(segment.steps.filter((s) => s.kind === 'hold').map((s) => s.dur)).toEqual([26, 22]);
  });

  it('keeps a single-waypoint patrol stationary', () => {
    for (const loop of [true, false]) {
      const program = compileGuardProgram(level, {
        ...level.json.guards[0],
        patrol: { loop, waypoints: [{ cell: [18, 45], holdTicks: 26 }] },
      });
      program.segments = [program.segments[0]];
      expect(poseAt(program, 500)).toEqual(poseAt(program, 0));
      expect(poseAt(program, 500).moving).toBe(false);
    }
  });
});
