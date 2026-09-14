import { expect, it } from 'vitest';
import { InstancedMesh, Matrix4 } from 'three';
import { agentInfo, defenseStage, gridShape, wayViews } from '../src/agent-views/state';
import { makeThiefBatch, blankCharacterPose } from '../src/render/characters';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

it('enables the grid only in the single and swarm defense rounds', () => {
  for (const stage of ['attract','brief1','round1','r1result','brief2','aiThink','results','presenter']) expect(defenseStage(stage)).toBe(false);
  expect(defenseStage('round2a')).toBe(true); expect(defenseStage('round2b')).toBe(true);
});

it('reports actual agent activity and terminal outcomes without mutating agents', () => {
  const world = new SimWorld(loadMint(), 9), t = world.spawnPlayer('front', 'Camera test');
  t.hidden = false;
  expect(agentInfo(t)).toMatchObject({ name: 'Camera test', action: 'Moving', live: true });
  t.lockpickDoor = 0; expect(agentInfo(t).action).toBe('Picking lock');
  t.hidden = true; expect(agentInfo(t).hidden).toBe(true);
  t.caught = true; expect(agentInfo(t)).toMatchObject({ action: 'Caught', live: false });
  t.caught = false; t.breached = true; expect(agentInfo(t)).toMatchObject({ action: 'Vault reached', live: false });
  t.breached = false; t.active = false; expect(agentInfo(t)).toMatchObject({ action: 'Held', live: false });
  expect(world.tick).toBe(0);
});

it('fits every agent from one to a full swarm into wide and narrow screens', () => {
  for (const [width,height] of [[1600,800],[600,500],[340,500],[5500,800]]) {
    for (const count of [1,2,5,12,45,80]) {
      const { columns, rows } = gridShape(count,width,height);
      expect(columns*rows).toBeGreaterThanOrEqual(count);
      expect(columns).toBeLessThanOrEqual(count);
      expect((width-(columns-1)*10)/columns).toBeGreaterThan(0);
      expect((height-(rows-1)*10)/rows).toBeGreaterThan(0);
    }
  }
});

it('shows exactly the HUD way rows even when eighty agents share twenty ways', () => {
  const world = new SimWorld(loadMint(), 9);
  const thieves = Array.from({ length: 80 }, (_, id) => ({ ...world.spawnPlayer('front', `Agent ${id}`), id }));
  const ways = Array.from({ length: 20 }, (_, id) => ({ id, name: `Way ${id + 1}`, agentIds: [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3] }));
  const views = wayViews(ways, thieves, new Map());
  expect(views).toHaveLength(20);
  expect(views.every(v => v.total === 4 && v.active === 4)).toBe(true);
  expect(views.map(v => v.id)).toEqual(ways.map(w => w.id));
});

it('keeps a stable live camera and switches to a surviving agent without adding a way', () => {
  const world = new SimWorld(loadMint(), 9);
  const a = world.spawnPlayer('front', 'First'), b = world.spawnPlayer('front', 'Second');
  a.hidden = b.hidden = false;
  const ways = [{ id: 0, name: 'Front', agentIds: [a.id, b.id] }], selected = new Map<number, number>();
  expect(wayViews(ways, [a, b], selected)[0].agentId).toBe(a.id);
  expect(wayViews(ways, [b, a], selected)[0].agentId).toBe(a.id);
  a.caught = true;
  expect(wayViews(ways, [a, b], selected)).toMatchObject([{ id: 0, agentId: b.id, active: 1, total: 2 }]);
  // Replanning can leave an old HUD way with no agents; retain its row to keep counts identical.
  expect(wayViews([{ ...ways[0], agentIds: [] }], [a, b], selected)).toMatchObject([{ id: 0, live: false, total: 0 }]);
});

it('restores the camera wearer and leaves other agents intact even after a render failure', () => {
  const batch = makeThiefBatch(2);
  const pose = { ...blankCharacterPose(), visible: true, x: 3, z: 2 };
  batch.setPose(0, pose); batch.setPose(1, { ...pose, x: 8 }); batch.flush();
  const mesh = batch.root.children.find(x => x instanceof InstancedMesh) as InstancedMesh;
  const first = new Matrix4(), second = new Matrix4(), current = new Matrix4();
  mesh.getMatrixAt(0, first); mesh.getMatrixAt(1, second);
  expect(() => batch.withHidden(0, () => {
    mesh.getMatrixAt(0, current); expect(current.determinant()).toBe(0);
    mesh.getMatrixAt(1, current); expect(current.equals(second)).toBe(true);
    throw new Error('render failed');
  })).toThrow('render failed');
  mesh.getMatrixAt(0, current); expect(current.equals(first)).toBe(true);
  batch.dispose();
});
