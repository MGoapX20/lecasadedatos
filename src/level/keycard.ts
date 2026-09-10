import type { Rng } from '../core/rng';
import { cardSpotIsClear } from './clearance';
import { cellOf, fineToPlan, type Level } from './loader';

/**
 * Where the vault card is left changes every visit, so a visitor who watched
 * somebody else play cannot simply walk to the same desk. The chosen spot has
 * to be somewhere an agent can actually stand, on the coarse planning grid as
 * well as the fine one, or the route to it would not exist.
 */
export function keycardSpots(level: Level): number[] {
  const authored = level.json.keycardSpots ?? [];
  const usable = authored
    .map((c) => cellOf(level, c))
    // Walkable is not enough: a cell can be clear to walk through and still sit
    // inside a teller counter, which is where the card used to hide.
    .filter(
      (cell) =>
        level.walk[cell] && level.pwalk[fineToPlan(level, cell)] && cardSpotIsClear(level, cell),
    );
  if (usable.length) return usable;
  // Nothing authored or nothing usable: fall back to where it already is.
  return level.json.keycards.map((k) => cellOf(level, k.cell));
}

/** Move the card to `fineCell`, keeping the lookup grids in step. */
export function setKeycardCell(level: Level, index: number, fineCell: number): void {
  const def = level.json.keycards[index];
  if (!def) return;
  const old = cellOf(level, def.cell);
  if (level.keyAt[old] === index) level.keyAt[old] = -1;
  const oldPlan = fineToPlan(level, old);
  if (level.pkeyAt[oldPlan] === index) level.pkeyAt[oldPlan] = -1;

  def.cell = [fineCell % level.w, (fineCell / level.w) | 0];
  level.keyAt[fineCell] = index;
  level.pkeyAt[fineToPlan(level, fineCell)] = index;
}

/** Choose a fresh spot for every card. Returns the fine cells chosen. */
export function placeKeycards(level: Level, rng: Rng): number[] {
  const spots = keycardSpots(level);
  const chosen: number[] = [];
  const taken = new Set<number>();
  level.json.keycards.forEach((k, i) => {
    // Only the card wanders; the uniform and the fuse box are fixtures.
    if ((k.kind ?? 'card') !== 'card') return;
    const free = spots.filter((c) => !taken.has(c));
    const cell = free.length ? rng.pick(free) : spots[0];
    taken.add(cell);
    setKeycardCell(level, i, cell);
    chosen.push(cell);
  });
  return chosen;
}
