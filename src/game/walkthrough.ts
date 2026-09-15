import type { Level } from '../level/loader';
import type { SimWorld } from '../sim/world';
import type { MissionTracker, MarkRef } from './missions';
import type { FloorRoute } from './recon';

export interface GuideTarget { cell: readonly number[]; mark?: MarkRef }
export interface GuideStep { id: string; labelKey: string; targets: GuideTarget[]; floorRoute?: FloorRoute }

/** Advisory only: observing progress never changes the simulation or its missions. */
export class GuidedWalkthrough {
  update(world: SimWorld, level: Level, missions: MissionTracker): GuideStep | null {
    const p = world.player;
    if (!p || world.exfilDone) return null;
    const step = (id: string, targets: GuideTarget[]): GuideStep => ({ id, labelKey: `guide.${id}`, targets });
    const at = (cell: readonly number[], mark?: MarkRef): GuideTarget => ({ cell, mark });
    const door = (id: string): GuideTarget => {
      const d = level.doors.find(d => d.id === id)!;
      return at([d.rect[0] + d.rect[2] / 2 - .5, d.rect[1] + d.rect[3] / 2 - .5], { kind: 'door', id });
    };
    const entered = missions.phases.find(x => x.id === 'foothold')?.done || p.breached;
    if (world.playerInTruck) return step('ride', [door('d_dock_outer')]);
    const inside = level.indoor[Math.floor(p.y) * level.w + Math.floor(p.x)] === 1;
    if (!entered || (!inside && !p.breached)) {
      const discovered = new Set(missions.phases.find(phase => phase.id === 'foothold')?.objectives
        .filter(objective => objective.state !== 'hidden').map(objective => objective.id));
      const entrances = level.json.entries.filter(e => discovered.has(`foothold.${e.id}`)).map(e => e.id === 'dock'
        ? at([world.truck.x - .5, world.truck.y - .5], { kind: 'truck' })
        : e.doorId ? door(e.doorId) : at(e.spawn, { kind: 'portal', id: `p_${e.id}` }));
      if (!entered && !missions.recon.complete) return {
        ...step('circle', entrances),
        floorRoute: missions.recon.floorRoute(level),
      };
      return step('entry', entrances);
    }
    // Reaching the vault early skips optional preparation rather than sending the visitor back.
    if (!p.breached) {
      const used = missions.phases.find(x => x.id === 'foothold')?.objectives.find(x => x.state === 'done')?.id;
      const bay = level.json.areas.find(a => a.id === 'dock_room')?.rect;
      const dockDoor = level.doors.findIndex(d => d.id === 'd_dock_in');
      if (used === 'foothold.dock' && bay && p.x >= bay[0] && p.x < bay[0] + bay[2] && p.y >= bay[1] && p.y < bay[1] + bay[3]
        && dockDoor >= 0 && !world.doorOpenFor(dockDoor, p)) return step('garage', [door('d_dock_in')]);
      const order = used === 'foothold.vent' ? ['fuse', 'uniform', 'card'] : ['uniform', 'fuse', 'card'];
      const parallelPreparation = used !== 'foothold.vent' && used !== 'foothold.sewer';
      const preparation: { kind: string; target: GuideTarget }[] = [];
      for (const kind of order) {
        if (kind === 'card' && preparation.length) break;
        const index = level.json.keycards.findIndex(k => (k.kind ?? 'card') === kind);
        if (index < 0) continue;
        const k = level.json.keycards[index];
        if (p.keys.has(k.id) || (kind === 'fuse' && world.camerasDown)) continue;
        const target = at(k.cell, { kind: 'key', index });
        if (parallelPreparation && kind !== 'card') preparation.push({ kind, target });
        else return step(kind, [target]);
      }
      if (preparation.length) return step(preparation.length > 1 ? 'prepare' : preparation[0].kind,
        preparation.map(item => item.target));
      return step('vault', [door('d_vault')]);
    }
    const def = world.exfil;
    if (!def) return null;
    if (!world.holeOpen) return step('wall', [at(def.stand, { kind: 'breachWall' })]);
    if (p.carrying) return step('van', [at(def.van, { kind: 'van' })]);
    const press = [...def.presses].sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.y) - Math.hypot(b[0] - p.x, b[1] - p.y))[0];
    return step('load', [at(press, { kind: 'press', cell: press })]);
  }
}
