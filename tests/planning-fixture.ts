import { buildLevel } from '../src/level/loader';
import { loadMint } from './helpers';

/** A card behind a sealed door, an agent already past it, and a card-only vault. */
export function planningFixture(camera = false) {
  const base = loadMint().json;
  return buildLevel({
    ...base, grid: { w: 11, h: 3, cellSize: 1, planStride: 1 },
    areas: [{ id: 'hall', kind: 'corridor', floor: 'concrete', rect: [1, 1, 9, 1] }],
    openings: [], guards: [], props: [], portals: [], safeSpots: [], keycardSpots: [],
    delivery: undefined, exfil: undefined, shiftChange: undefined,
    entries: [{ id: 'front', kind: 'door', cell: [1, 1], spawn: [1, 1], nameKey: 'entry.front', analogyKey: 'analogy.front' }],
    doors: [
      { id: 'sealed', kind: 'door', rect: [5, 1, 1, 1], locked: true, pickable: false, lockableByChief: true, lockpickQuanta: 4 },
      { id: 'vault', kind: 'vault', rect: [8, 1, 1, 1], locked: true, pickable: false, lockableByChief: false, keyId: 'k_manager', lockpickQuanta: 4 },
    ],
    keycards: [
      { id: 'k_manager', nameKey: 'card.manager', cell: [2, 1], kind: 'card' },
      { id: 'k_uniform', nameKey: 'item.uniform', cell: [3, 1], kind: 'uniform' },
      { id: 'k_fuse', nameKey: 'item.fuse', cell: [4, 1], kind: 'fuse' },
    ],
    cameras: camera ? [{ id: 'camera', cell: [7, 1], facingDeg: 0, fovDeg: 360, range: 20 }] : [],
    vault: { ...base.vault, cell: [9, 1], rect: [9, 1, 1, 1] },
  });
}
