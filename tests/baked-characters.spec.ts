import { expect, it } from 'vitest';
import { AnimationClip, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, NumberKeyframeTrack } from 'three';
import { BakedCharacterBatch } from '../src/render/bakedCharacters';
import { blankCharacterPose } from '../src/render/characters';

it('draws eighty actors in shared animation batches while preserving model geometry and camera exclusion', () => {
  const scene = new Group(), geometry = new BoxGeometry(), mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.name = 'Body'; scene.add(mesh);
  const original = Array.from(geometry.getAttribute('position').array);
  const idle = new AnimationClip('idle', 1, []);
  const walk = new AnimationClip('walk', 1, [new NumberKeyframeTrack('Body.position[x]', [0, .5, 1], [0, .2, 0])]);
  const batch = new BakedCharacterBatch(80, { scene, clips: { idle, walk, run: walk } });
  for (let id = 0; id < 80; id++) batch.setPose(id, { ...blankCharacterPose(), visible: true, moving: 1, phase: Math.PI, x: id, scale: 1.28 });
  batch.flush();
  const drawn = batch.root.children.filter(m => (m as InstancedMesh).count > 0) as InstancedMesh[];
  expect(drawn).toHaveLength(1); expect(drawn[0].count).toBe(80);
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(original);
  const before = new Matrix4(), after = new Matrix4(); drawn[0].getMatrixAt(3, before);
  expect(() => batch.withHidden(3, () => { drawn[0].getMatrixAt(3, after); expect(after.determinant()).toBe(0); throw new Error('capture failed'); })).toThrow('capture failed');
  drawn[0].getMatrixAt(3, after); expect(after.equals(before)).toBe(true);
  batch.hideAll(); expect(batch.root.children.every(m => (m as InstancedMesh).count === 0)).toBe(true);
  batch.dispose();
});
