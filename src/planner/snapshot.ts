import { cellOf } from '../level/loader';
import { withTemporaryPost } from '../sim/patrol';
import type { SimWorld } from '../sim/world';

/** The planner must see the defenses that are actually still working. */
export function planningSnapshot(world: SimWorld, nowTick = world.tick) {
  return {
    nowTick,
    doorLocked: world.doorLocked.map((locked, i) => locked && !world.doorPickedOpen[i] ? 1 : 0),
    cameras: !world.camerasDown,
    guardPrograms: world.guards.map(g => g.state === 'patrol' ? g.program
      : withTemporaryPost(g.program, g.x, g.y, g.facing, world.tick, 70)),
    alarmWindows: world.alarmWindows.map(window => ({ ...window })),
    keycardCells: Object.fromEntries(world.level.json.keycards.map(k => [k.id, cellOf(world.level, k.cell)])),
  };
}
