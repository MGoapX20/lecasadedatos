import { expect, it } from 'vitest';
import { AnimationClip, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { withCameraClearance } from '../src/render/cameraClearance';
import { BakedCharacterBatch } from '../src/render/bakedCharacters';
import { blankCharacterPose, makeThiefBatch } from '../src/render/characters';
import { THIEF_POSE_SCALE } from '../src/render/readability';

it.each(['fallback', 'baked'] as const)('keeps overlapping masks out of %s feeds and restores every actor after a failed render', kind => {
  const scene = new Group();
  const body = new Mesh(new BoxGeometry(.3, .8, .2), new MeshBasicMaterial());
  const mask = new Mesh(new BoxGeometry(.2, .2, .1), new MeshBasicMaterial());
  mask.position.set(0, .9, .2); scene.add(body, mask);
  const idle = new AnimationClip('idle', 1, []);
  const batch = kind === 'fallback' ? makeThiefBatch(3)
    : new BakedCharacterBatch(3, { scene, clips: { idle, walk: idle, run: idle } });
  const actors = [0, .2, 2].map((x, slot) => ({ slot, pose: {
    ...blankCharacterPose(), visible: true, scale: THIEF_POSE_SCALE, x: x + 10, z: 4,
  } }));
  for (const actor of actors) batch.setPose(actor.slot, actor.pose);
  batch.flush();
  const meshes = batch.root.children.filter(object => object instanceof InstancedMesh && object.visible && object.count > 0) as InstancedMesh[];
  const matrices = () => meshes.map(mesh => Array.from({ length: 3 }, (_, i) => {
    const matrix = new Matrix4(); mesh.getMatrixAt(i, matrix); return matrix;
  }));
  const before = matrices();
  expect(() => withCameraClearance(batch, actors[0], actors, () => {
    for (const [i, row] of matrices().entries()) {
      expect(row[0].determinant(), 'camera wearer').toBe(0);
      expect(row[1].determinant(), 'overlapping peer and mask').toBe(0);
      expect(row[2].equals(before[i][2]), 'other agents remain visible').toBe(true);
    }
    throw new Error('capture failed');
  })).toThrow('capture failed');
  expect(matrices()).toEqual(before);
  // Switching to another feed must show the original camera wearer again.
  withCameraClearance(batch, actors[2], actors, () => {
    for (const [i, row] of matrices().entries()) {
      expect(row[0].equals(before[i][0])).toBe(true);
      expect(row[1].equals(before[i][1])).toBe(true);
      expect(row[2].determinant()).toBe(0);
    }
  });
  expect(matrices()).toEqual(before);
  batch.dispose(); body.geometry.dispose(); mask.geometry.dispose();
  (body.material as MeshBasicMaterial).dispose(); (mask.material as MeshBasicMaterial).dispose();
});
