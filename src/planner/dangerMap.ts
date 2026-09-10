import { computeOpaqueWithDoors, type Level } from '../level/loader';
import { cameraFacingAt, forEachVisibleCell } from '../sim/vision';
import { blankPose, poseAt, type PatrolProgram } from '../sim/patrol';
import type { AlarmWindow } from './types';

/** Ticks sampled inside each quantum, spread across it. */
const SAMPLES_PER_QUANTUM = 3;

export interface DangerMap {
  /** horizonQ * planCount, 1 = somebody can see this plan cell during that quantum. */
  bits: Uint8Array;
  /** Same, dilated by one plan cell, for cautious agents. */
  bitsMargin: Uint8Array | null;
  horizonQ: number;
  baseQ: number;
  planCount: number;
  /** Union over the horizon, for debug drawing. */
  everSeen: Uint8Array;
  bakeMs: number;
}

export interface BakeInput {
  level: Level;
  programs: PatrolProgram[];
  baseTick: number;
  horizonQ: number;
  alarmWindows: AlarmWindow[];
  withMargin: boolean;
  /** Shut doors block sight, so the planner must bake the same grid. */
  doorLocked?: Uint8Array;
  /** A disguised agent is only recognised up close. */
  guardRangeMul?: number;
  /** false once the power is cut: nothing on the cameras. */
  cameras?: boolean;
}

function alarmMulAt(windows: AlarmWindow[], tick: number, mul: number): number {
  for (const w of windows) {
    if (tick >= w.fromTick && tick < w.toTick) return mul;
  }
  return 1;
}

export function bakeDangerMap(input: BakeInput): DangerMap {
  const t0 = Date.now();
  const { level, programs, baseTick, horizonQ, alarmWindows, withMargin } = input;
  const opaque = input.doorLocked
    ? computeOpaqueWithDoors(level, input.doorLocked, new Uint8Array(level.cellCount))
    : level.opaque;
  const rules = level.json.rules;
  const qt = rules.quantumTicks;
  const planCount = level.planCount;
  const bits = new Uint8Array(horizonQ * planCount);
  const everSeen = new Uint8Array(planCount);
  const stride = level.stride;
  const pw = level.pw;
  const pose = blankPose();

  const markFine = (rowBase: number) => (cell: number) => {
    const fx = cell % level.w;
    const fy = (cell / level.w) | 0;
    const p = ((fy / stride) | 0) * pw + ((fx / stride) | 0);
    bits[rowBase + p] = 1;
    everSeen[p] = 1;
  };

  for (let q = 0; q < horizonQ; q++) {
    const rowBase = q * planCount;
    const mark = markFine(rowBase);
    for (let s = 0; s < SAMPLES_PER_QUANTUM; s++) {
      const tick = baseTick + q * qt + Math.round((s * (qt - 1)) / (SAMPLES_PER_QUANTUM - 1));
      const mul = alarmMulAt(alarmWindows, tick, rules.alarmVisionMul);

      for (let gi = 0; gi < programs.length; gi++) {
        poseAt(programs[gi], tick, pose);
        if (!pose.present) continue;
        const def = level.json.guards[gi];
        forEachVisibleCell(
          opaque,
          level.w,
          level.h,
          pose.x,
          pose.y,
          pose.facingDeg,
          def.vision.fovDeg,
          (def.vision.range / level.cellSize) * mul * (input.guardRangeMul ?? 1),
          mark,
        );
      }

      for (const c of level.json.cameras) {
        if (input.cameras === false) break;
        if (!c.sweep && s > 0) continue; // a fixed camera never changes
        const facing = cameraFacingAt(c.facingDeg, c.sweep, tick);
        forEachVisibleCell(
          opaque,
          level.w,
          level.h,
          c.cell[0] + 0.5,
          c.cell[1] + 0.5,
          facing,
          c.fovDeg,
          (c.range / level.cellSize) * mul,
          mark,
        );
      }
    }
  }

  let bitsMargin: Uint8Array | null = null;
  if (withMargin) {
    bitsMargin = new Uint8Array(bits.length);
    const ph = level.ph;
    for (let q = 0; q < horizonQ; q++) {
      const base = q * planCount;
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const i = base + y * pw + x;
          if (!bits[i]) continue;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= ph) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= pw) continue;
              bitsMargin[base + ny * pw + nx] = 1;
            }
          }
        }
      }
    }
  }

  return {
    bits,
    bitsMargin,
    horizonQ,
    baseQ: Math.floor(baseTick / qt),
    planCount,
    everSeen,
    bakeMs: Date.now() - t0,
  };
}
