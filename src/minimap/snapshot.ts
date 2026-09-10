import type { SimWorld } from '../sim/world';
import { cameraFacingAt } from '../sim/vision';

export function mapSnapshot(world: SimWorld) {
  const l = world.level;
  // Geometry comes from the simulation, including the opened breach and solid props.
  const cells = new Uint8Array(l.cellCount);
  for (let i = 0; i < cells.length; i++) cells[i] = world.walkNow[i]
    ? (l.indoor[i] ? 1 : 0) : (l.wall[i] ? 2 : 3);
  return {
    w: l.w, h: l.h, cells, indoor: l.indoor, tick: world.tick, power: !world.camerasDown,
    doors: l.doors.map((d, i) => ({ id: d.id, rect: d.rect,
      open: world.doorOpenFor(i, null) || (d.id === 'd_dock_outer' && world.gateOpenForTruck) })),
    keys: l.json.keycards.flatMap((k, i) => {
      const kind = k.kind ?? 'card';
      if (kind === 'card' && world.keyTaken[i]) return [];
      return [{ cell: k.cell, kind, used: kind === 'fuse' ? world.camerasDown : !!world.keyTaken[i] }];
    }),
    portals: l.json.portals.filter(p => p.id !== 'p_truck').map(p => ({ from: p.from, to: p.to, kind: p.kind })),
    guards: world.guards.filter(g => g.present).map(g => ({ x:g.x, y:g.y, facing:g.facing })),
    thieves: world.thieves.filter(p => p.active && !p.hidden && !p.retired && !p.caught).map(p => ({ x:p.x, y:p.y, facing:p.facing, player:p.kind === 'player' })),
    cameras: l.json.cameras.map(c => ({ cell:c.cell, facing:world.camerasDown ? c.facingDeg : cameraFacingAt(c.facingDeg,c.sweep,world.tick) })),
    truck: l.json.delivery ? { ...world.truck } : null,
    van: world.holeOpen ? { ...world.van } : null,
    hole: world.exfil ? { rect:world.exfil.hole, open:world.holeOpen } : null,
    presses: world.exfil?.presses ?? [],
    shops: l.json.props.filter(p => p.kind === 'store').map(p => ({
      cell: p.cell, rotation: p.rotDeg ?? 0,
      width: 3.6 * (p.scale ?? 1) / l.cellSize,
      depth: 1.9 * (p.scale ?? 1) / l.cellSize,
    })),
    vault: l.json.vault.rect,
    riding: world.playerInTruck,
  };
}
export type MapSnapshot = ReturnType<typeof mapSnapshot>;
export const minimapChannel = () => `casa-minimap-v1:${new URL('.', location.href).pathname}`;
