import { expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { ReconCircuit, reconRoute } from '../src/game/recon';
import { ReconFloorRoute } from '../src/render/reconRoute';
import { worldToFine } from '../src/level/loader';
import { cornerBlocked, makeScratch, staticAStar } from '../src/level/grid';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

it('routes every step around the building on pavement clear of doors, props and corners', () => {
  const level = loadMint(), route = reconRoute(level);
  expect(route.checkpoints).toHaveLength(5);
  expect(route.cells[0]).toBe(route.cells.at(-1));
  for (let i = 0; i < route.cells.length; i++) {
    const cell = route.cells[i];
    expect(level.walkGuard[cell]).toBe(1);
    expect(level.indoor[cell]).toBe(0);
    expect(level.doorAt[cell]).toBe(-1);
    if (!i) continue;
    const previous = route.cells[i - 1];
    const x = previous % level.w, y = Math.floor(previous / level.w);
    const dx = cell % level.w - x, dy = Math.floor(cell / level.w) - y;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
    expect(cornerBlocked(level.walkGuard, level.w, x, y, dx, dy)).toBe(false);
  }
});

it('does not complete from revisiting the starting point or walking back and forth on one side', () => {
  const level = loadMint(), circuit = new ReconCircuit();
  const start = level.json.entries.find(e => e.id === 'front')!.spawn;
  for (let i = 0; i < 5; i++) {
    circuit.update(level, { x: start[0] + .5, y: start[1] + .5 });
    circuit.update(level, { x: 89.5, y: 73.5 });
  }
  expect(circuit.complete).toBe(false);
  circuit.reset();
  expect(circuit.floorRoute(level).from).toBe(0);
});

it.each([false, true])('finishes a real walk around the green trail (reverse: %s)', reverse => {
  const level = loadMint(), circuit = new ReconCircuit(), world = new SimWorld(level);
  const player = world.spawnPlayer('front', 'Test'); world.catchesEnabled = false;
  circuit.update(level, player);
  for (const cell of reconRoute(level, reverse).cells) {
    const x = cell % level.w + .5, y = Math.floor(cell / level.w) + .5;
    let steps = 0;
    while (Math.hypot(x - player.x, y - player.y) > .45 && steps++ < 20) {
      world.setPlayerMove(x - player.x, y - player.y); world.step();
      circuit.update(level, player);
      expect(player.hidden).toBe(false);
      expect(level.indoor[Math.floor(player.y) * level.w + Math.floor(player.x)]).toBe(0);
    }
    expect(steps, `stuck walking toward ${x},${y}`).toBeLessThan(20);
  }
  expect(circuit.complete).toBe(true);
  expect(circuit.fraction).toBe(1);
  expect(circuit.floorRoute(level).cells).toBe(reconRoute(level, reverse).cells);
});

it.each([false, true])('accepts a closer walk around the walls that misses the old corner targets (reverse: %s)', reverse => {
  const level = loadMint(), circuit = new ReconCircuit();
  const outdoor = level.walkGuard.map((walk, cell) => walk && !level.indoor[cell] ? 1 : 0);
  const nearest = (x: number, y: number) => {
    let best = -1, distance = Infinity;
    outdoor.forEach((walk, cell) => {
      if (!walk) return;
      const d = Math.hypot(cell % level.w - x, Math.floor(cell / level.w) - y);
      if (d < distance) { distance = d; best = cell; }
    });
    return best;
  };
  const stops = [[48,73], [84,68], [84,44], [84,20], [48,20], [12,20], [12,44], [12,68], [48,73]]
    .map(([x,y]) => nearest(x,y));
  if (reverse) stops.reverse();
  const scratch = makeScratch(level.cellCount), cells: number[] = [];
  for (let i = 1; i < stops.length; i++) {
    const leg = staticAStar(outdoor, level.w, level.h, stops[i-1], stops[i], scratch);
    expect(leg).not.toBeNull(); cells.push(...leg!);
  }
  const oldCorner = reconRoute(level).cells[reconRoute(level).checkpoints[0]];
  expect(Math.min(...cells.map(cell => Math.hypot(cell % level.w - oldCorner % level.w,
    Math.floor(cell / level.w) - Math.floor(oldCorner / level.w))))).toBeGreaterThan(5);
  for (const cell of cells) circuit.update(level, { x: cell % level.w + .5, y: Math.floor(cell / level.w) + .5 });
  expect(circuit.complete).toBe(true);
});

it('does not credit unvisited sections when someone jumps between corners', () => {
  const level = loadMint(), circuit = new ReconCircuit(), route = reconRoute(level);
  for (const index of [0, ...route.checkpoints]) {
    const cell = route.cells[index];
    circuit.update(level, { x: cell % level.w + .5, y: Math.floor(cell / level.w) + .5 });
  }
  expect(circuit.complete).toBe(false);
});

it('places quiet arrows flat on walkable ground and removes the traveled part of the trail', () => {
  const level = loadMint(), route = reconRoute(level), arrows = new ReconFloorRoute();
  arrows.set(level, { cells: route.cells, from: 0 });
  const count = arrows.mesh.count;
  expect(count).toBeGreaterThan(30);
  const matrix = new Matrix4(), position = new Vector3(), up = new Vector3();
  for (let i = 0; i < count; i++) {
    arrows.mesh.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.y).toBeCloseTo(.035);
    expect(level.walkGuard[worldToFine(level, position.x, position.z)]).toBe(1);
    up.set(0, 1, 0).transformDirection(matrix);
    expect(up.y).toBeCloseTo(1);
  }
  arrows.set(level, { cells: route.cells, from: route.checkpoints[2] });
  expect(arrows.mesh.count).toBeLessThan(count);
  arrows.set(level, null);
  expect(arrows.mesh.visible).toBe(false);
  arrows.set(level, { cells: route.cells, from: 0 });
  expect(arrows.mesh.count).toBe(count);
  arrows.dispose();
});
