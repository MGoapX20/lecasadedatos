import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { cellOf, fineToPlan, fineXYToWorldX, fineXYToWorldZ } from '../src/level/loader';
import { keycardSpots, placeKeycards, setKeycardCell } from '../src/level/keycard';
import { compileGuardProgram } from '../src/sim/patrol';
import { enumerateRequests } from '../src/planner/options';
import { CARD_CLEARANCE, cardSpotHasSightline, propClearance } from '../src/level/clearance';
import { makeCtx, runJob } from '../src/planner/planner';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

describe('the vault card moves between visits', () => {
  const level = loadMint();

  it('offers several distinct places to leave it', () => {
    const spots = keycardSpots(level);
    expect(spots.length).toBeGreaterThanOrEqual(4);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it('only ever places it where somebody can stand and plan a route', () => {
    for (const cell of keycardSpots(level)) {
      expect(level.walk[cell], `card spot ${cell} is not walkable`).toBe(1);
      expect(level.pwalk[fineToPlan(level, cell)], `card spot ${cell} unreachable when planning`).toBe(1);
      expect(level.indoor[cell], 'the card should be indoors').toBe(1);
    }
  });

  it('keeps the lookup grid in step when it moves', () => {
    const spots = keycardSpots(level);
    for (const cell of spots) {
      setKeycardCell(level, 0, cell);
      expect(level.keyAt[cell]).toBe(0);
      expect(cellOf(level, level.json.keycards[0].cell)).toBe(cell);
      // Exactly one cell claims the card.
      let claims = 0;
      for (let i = 0; i < level.cellCount; i++) if (level.keyAt[i] === 0) claims++;
      expect(claims).toBe(1);
    }
  });

  it('never leaves the card inside a piece of furniture', () => {
    // Walkability alone allowed spots inside a teller counter, because the
    // collision circle is narrower than the counter is long.
    for (const cell of keycardSpots(level)) {
      const x = cell % level.w;
      const y = (cell / level.w) | 0;
      const clear = propClearance(level, fineXYToWorldX(level, x + 0.5), fineXYToWorldZ(level, y + 0.5));
      expect(clear, `card spot ${x},${y} is only ${clear.toFixed(2)}m from a prop`).toBeGreaterThanOrEqual(
        CARD_CLEARANCE,
      );
      expect(
        cardSpotHasSightline(level, cell),
        `card spot ${x},${y} is hidden behind a wall from the gameplay camera`,
      ).toBe(true);
    }
  });

  it('offers more than one clear spot, so a repeat visitor learns nothing', () => {
    expect(keycardSpots(level).length).toBeGreaterThanOrEqual(3);
  });

  it('leaves the card route workable wherever it lands', () => {
    const programs = level.json.guards.map((g) => compileGuardProgram(level, g));
    const doorLocked = new Uint8Array(level.doors.length);
    level.doors.forEach((d, i) => (doorLocked[i] = d.locked ? 1 : 0));
    const ctx = makeCtx(level);

    for (const cell of keycardSpots(level)) {
      setKeycardCell(level, 0, cell);
      const res = runJob({
        level, ctx, programs, baseTick: 0, doorLocked, alarmWindows: [],
        requests: enumerateRequests(level, 60, 5, 1),
        budgetMs: 20000,
        keycardCells: { k_manager: cell },
      });
      const viaCard = res.plans.filter((p) => p.request.keyStrategy.kind === 'key').length;
      console.log(`card at ${cell % level.w},${(cell / level.w) | 0}: ${viaCard} routes fetch it`);
      expect(viaCard, `card at cell ${cell} makes the card route impossible`).toBeGreaterThan(0);
    }
  });

  it('a player who walks over it can then open the vault door', () => {
    const rng = new Rng(4);
    const cells = placeKeycards(level, rng);
    const world = new SimWorld(level, 4);
    const player = world.spawnPlayer('front', 'Tokyo');
    const vaultIdx = level.doors.findIndex((d) => d.id === 'd_vault');
    expect(world.doorOpenFor(vaultIdx, player), 'vault must start shut').toBe(false);
    player.x = (cells[0] % level.w) + 0.5;
    player.y = ((cells[0] / level.w) | 0) + 0.5;
    world.step();
    expect(player.keys.has('k_manager'), 'walking over the card must pick it up').toBe(true);
    expect(world.doorOpenFor(vaultIdx, player), 'the card must open the vault').toBe(true);
  });
});
