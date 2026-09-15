import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { DoorPicker } from '../src/render/picking';

function scene() {
  const root = new Group();
  const hinge = new Group();
  hinge.position.x = -0.6;
  const leaf = new Mesh(new BoxGeometry(1.2, 2.3, 0.16), new MeshBasicMaterial());
  leaf.position.set(0.6, 1.15, 0);
  hinge.add(leaf);
  root.add(hinge);
  const doors = new Map([[0, hinge]]);
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 6, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const picker = new DoorPicker({ root, doors }, () => true);
  const at = (point: Vector3) => {
    const ndc = point.clone().project(camera);
    return picker.pick(camera, (ndc.x + 1) * 500, (1 - ndc.y) * 500, 1000, 1000);
  };
  return { root, hinge, leaf, doors, camera, at };
}

describe('precise door picking', () => {
  it('hits the visible door and leaves nearby ground and space beside it alone', () => {
    const { at } = scene();
    expect(at(new Vector3(0, 1.15, 0.08))).toBe(0);
    expect(at(new Vector3(0.7, 1.15, 0.08))).toBe(-1);
    expect(at(new Vector3(1, 0, 0))).toBe(-1);
    expect(at(new Vector3(0, 0, 0.5))).toBe(-1);
  });

  it('follows the swinging leaf instead of keeping the empty doorway clickable', () => {
    const { hinge, leaf, at } = scene();
    hinge.rotation.y = Math.PI / 2;
    hinge.updateWorldMatrix(true, true);
    expect(at(leaf.localToWorld(new Vector3(0, 0, 0.08)))).toBe(0);
    expect(at(new Vector3(0.4, 1.15, 0))).toBe(-1);
  });

  it('stays precise after rotating the camera', () => {
    const { camera, at } = scene();
    for (const x of [-6, 6]) {
      camera.position.set(x, 4, 8);
      camera.lookAt(0, 1, 0);
      camera.updateMatrixWorld(true);
      expect(at(new Vector3(0, 1.15, 0.08))).toBe(0);
      expect(at(new Vector3(1.5, 0, 0))).toBe(-1);
    }
  });

  it('ignores invisible placeholders and hidden door groups', () => {
    const { leaf, hinge, at } = scene();
    leaf.visible = false;
    expect(at(new Vector3(0, 1.15, 0.08))).toBe(-1);
    leaf.visible = true;
    hinge.visible = false;
    expect(at(new Vector3(0, 1.15, 0.08))).toBe(-1);
  });

  it('does not let a glow expand the clickable door or obscure its surface', () => {
    const { hinge, at } = scene();
    const glow = new Mesh(new BoxGeometry(3, 4, 0.5), new MeshBasicMaterial({ depthWrite: false }));
    glow.position.set(0.6, 1.15, 0);
    hinge.add(glow);
    expect(at(new Vector3(1, 1.15, 0.25))).toBe(-1);
    expect(at(new Vector3(0, 1.15, 0.08))).toBe(0);
  });

  it('rejects a door hidden behind scenery, but respects the visible cutaway', () => {
    const { root, at } = scene();
    const wall = new Mesh(new BoxGeometry(4, 5, 0.2), new MeshBasicMaterial());
    wall.position.set(0, 2.5, 1);
    root.add(wall);
    expect(at(new Vector3(0, 1.15, 0.08))).toBe(-1);
    wall.visible = false;
    expect(at(new Vector3(0, 1.15, 0.08))).toBe(0);
  });

  it('only picks doors the chief can lock', () => {
    const { root, doors, camera } = scene();
    const picker = new DoorPicker({ root, doors }, () => false);
    const ndc = new Vector3(0, 1.15, 0.08).project(camera);
    expect(picker.pick(camera, (ndc.x + 1) * 500, (1 - ndc.y) * 500, 1000, 1000)).toBe(-1);
  });
});
