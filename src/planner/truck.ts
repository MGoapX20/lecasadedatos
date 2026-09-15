import type { Level } from '../level/loader';
import { truckVisits } from '../sim/truck';

export interface TruckWindow { boardFrom: number; boardUntil: number; exitFrom: number; exitUntil: number }
/** Inclusive plan-quanta windows, conservatively rounded to actual stopped ticks. */
export function truckWindows(level: Level, baseTick: number, horizonQ: number): Map<number, TruckWindow[]> {
  const byStop = new Map<number, TruckWindow[]>(), def = level.json.delivery;
  if (!def) return byStop;
  const { tickHz, quantumTicks: qt } = level.json.rules;
  for (const trip of truckVisits(def, tickHz, baseTick, baseTick + horizonQ * qt)) {
    const window = {
      boardFrom: Math.ceil((trip.loadStartTick - baseTick) / qt),
      boardUntil: Math.floor((trip.departTick - 1 - baseTick) / qt),
      exitFrom: Math.ceil((trip.unloadTick - baseTick) / qt),
      exitUntil: Math.floor((trip.dockEndTick - 1 - baseTick) / qt),
    };
    const windows = byStop.get(trip.stop) ?? [];
    windows.push(window); byStop.set(trip.stop, windows);
  }
  return byStop;
}
