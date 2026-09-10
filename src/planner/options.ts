import { Rng } from '../core/rng';
import { cellOf, fineToPlan, type Level } from '../level/loader';
import type { KeyStrategy, Personality, PlanRequest } from './types';

/** Start delays, in quanta. Staggering the swarm is what makes shift gaps findable. */
const START_DELAYS = [0, 4, 10, 18, 28, 40, 56, 72, 92];

export function personalityFor(rng: Rng): Personality {
  return {
    heatLambda: 0.06 + rng.next() * 0.34,
    noiseEps: rng.next() * 0.5,
    waitBias: rng.next() * 0.14,
    margin: rng.next() < 0.22 ? 1 : 0,
  };
}

/**
 * The strategies worth spending a search on. "Touch nothing locked" is kept out
 * of the default swarm because the vault door is always locked, so it would burn
 * a third of the budget proving the obvious.
 */
export function keyStrategiesFor(level: Level, includeNone = false): KeyStrategy[] {
  const out: KeyStrategy[] = includeNone ? [{ kind: 'none' }, { kind: 'lockpick' }] : [{ kind: 'lockpick' }];
  for (const k of level.json.keycards) {
    const kind = k.kind ?? 'card';
    out.push({ kind: kind === 'uniform' ? 'uniform' : kind === 'fuse' ? 'power' : 'key', keyId: k.id });
  }
  return out;
}

/**
 * The high-level decisions are enumerated here rather than searched, which keeps
 * the low-level state space small and guarantees the swarm tries genuinely
 * different ideas instead of 100 variations of one route.
 */
export function enumerateRequests(
  level: Level,
  count: number,
  seed: number,
  moveQuanta = 1,
  delays: readonly number[] = START_DELAYS,
): PlanRequest[] {
  const rng = new Rng(seed);
  const strategies = keyStrategiesFor(level);
  const combos: { entryId: string; key: KeyStrategy; delayQ: number }[] = [];
  for (const e of level.json.entries) {
    for (const key of strategies) {
      for (const delayQ of delays) {
        combos.push({ entryId: e.id, key, delayQ });
      }
    }
  }
  rng.shuffle(combos);
  const out: PlanRequest[] = [];
  for (let i = 0; i < count; i++) {
    const c = combos[i % combos.length];
    out.push({
      agentId: i,
      seed: (seed * 2654435761 + i * 40503) >>> 0,
      entryId: c.entryId,
      keyStrategy: c.key,
      startDelayQ: c.delayQ + (i >= combos.length ? rng.int(6) : 0),
      moveQuanta,
      personality: personalityFor(rng),
    });
  }
  return out;
}

/**
 * Plan cells belonging to each entrance. An agent assigned the sewer is barred
 * from the other four, otherwise every agent would converge on the single best
 * door and the swarm would look like one idea repeated.
 */
export function buildEntryMasks(level: Level): Map<string, Uint8Array> {
  const own = new Map<string, number[]>();
  for (const e of level.json.entries) {
    const cells: number[] = [];
    if (e.doorId) {
      const d = level.doors[level.doorIndex.get(e.doorId) ?? -1];
      if (d) {
        for (let y = d.rect[1]; y < d.rect[1] + d.rect[3]; y++) {
          for (let x = d.rect[0]; x < d.rect[0] + d.rect[2]; x++) {
            cells.push(fineToPlan(level, y * level.w + x));
          }
        }
      }
    } else {
      cells.push(fineToPlan(level, cellOf(level, e.spawn)));
      cells.push(fineToPlan(level, cellOf(level, e.cell)));
    }
    own.set(e.id, [...new Set(cells)]);
  }
  const masks = new Map<string, Uint8Array>();
  for (const e of level.json.entries) {
    const mask = new Uint8Array(level.planCount);
    for (const other of level.json.entries) {
      if (other.id === e.id) continue;
      for (const c of own.get(other.id) ?? []) mask[c] = 1;
    }
    for (const c of own.get(e.id) ?? []) mask[c] = 0;
    masks.set(e.id, mask);
  }
  return masks;
}

/** Tighter stagger for the live swarm, which only has 45 seconds on screen. */
export const SWARM_DELAYS = [0, 2, 4, 6, 9, 12, 16, 21, 27];

export { START_DELAYS };
