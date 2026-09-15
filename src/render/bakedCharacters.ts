import { AnimationMixer, Group, InstancedMesh, Matrix4, Mesh, Object3D, SkinnedMesh, Vector3 } from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterModel } from './models';
import type { CharacterBatch, CharacterPose } from './characters';
import { characterHeight } from './readability';

const WALK_FRAMES = 8;
interface Frame { meshes: InstancedMesh[] }

/** Small spectator feeds reuse the same model baked into eight walking poses.
 * No per-agent skeleton traversal or skinning pass for each camera. */
export class BakedCharacterBatch implements CharacterBatch {
  readonly root = new Group();
  private variants: Frame[][];
  private poses: (CharacterPose | undefined)[] = [];
  private slots = new Map<number, { frame: Frame; index: number }>();
  private scratch = new Object3D();
  constructor(readonly capacity: number, model: CharacterModel, alternate?: CharacterModel | null) {
    this.variants = [model, ...(alternate ? [alternate] : [])].map(template => {
      const node = cloneSkeleton(template.scene);
      const mixer = new AnimationMixer(node);
      const frames: Frame[] = [];
      for (let f = 0; f <= WALK_FRAMES; f++) {
        mixer.stopAllAction();
        const clip = f === 0 ? template.clips.idle : template.clips.walk;
        mixer.clipAction(clip).reset().play();
        mixer.setTime(f === 0 ? 0 : (f - 1) / WALK_FRAMES * clip.duration);
        node.updateMatrixWorld(true);
        const meshes: InstancedMesh[] = [];
        node.traverse(object => {
          if (!(object instanceof Mesh)) return;
          const geometry = object.geometry.clone();
          const position = geometry.getAttribute('position');
          const vertex = new Vector3();
          if (object instanceof SkinnedMesh) object.skeleton.update();
          for (let i = 0; i < position.count; i++) {
            vertex.fromBufferAttribute(position, i);
            if (object instanceof SkinnedMesh) object.applyBoneTransform(i, vertex);
            vertex.applyMatrix4(object.matrixWorld);
            position.setXYZ(i, vertex.x, vertex.y, vertex.z);
          }
          geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
          geometry.computeVertexNormals();
          const mesh = new InstancedMesh(geometry, object.material, capacity);
          mesh.count = 0; mesh.frustumCulled = false;
          meshes.push(mesh); this.root.add(mesh);
        });
        frames.push({ meshes });
      }
      mixer.stopAllAction(); mixer.uncacheRoot(node);
      return frames;
    });
  }
  setPose(index: number, pose: CharacterPose) { if (index < this.capacity) this.poses[index] = pose; }
  update() {}
  hideAll() { this.poses = []; this.flush(); }
  flush() {
    for (const frames of this.variants) for (const frame of frames) for (const mesh of frame.meshes) mesh.count = 0;
    this.slots.clear();
    this.poses.forEach((pose, id) => {
      if (!pose?.visible) return;
      const frames = this.variants[pose.variant && this.variants.length > 1 ? 1 : 0];
      const f = pose.moving > .05 ? 1 + Math.floor(((pose.phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * WALK_FRAMES) : 0;
      const frame = frames[f], index = frame.meshes[0]?.count ?? 0;
      const height = characterHeight(pose.scale);
      this.scratch.position.set(pose.x, -.22 * pose.crouch, pose.z);
      this.scratch.rotation.set(0, Math.PI / 2 - pose.facingRad, 0);
      this.scratch.scale.set(height, height * (1 - .18 * pose.crouch), height);
      this.scratch.updateMatrix();
      for (const mesh of frame.meshes) { mesh.setMatrixAt(index, this.scratch.matrix); mesh.count++; }
      this.slots.set(id, { frame, index });
    });
    for (const frames of this.variants) for (const frame of frames) for (const mesh of frame.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
  withHidden(id: number, render: () => void) {
    const slot = this.slots.get(id); if (!slot) { render(); return; }
    const saved = new Matrix4(), hidden = new Matrix4().makeScale(0, 0, 0);
    slot.frame.meshes[0]?.getMatrixAt(slot.index, saved);
    try {
      for (const mesh of slot.frame.meshes) { mesh.setMatrixAt(slot.index, hidden); mesh.instanceMatrix.needsUpdate = true; }
      render();
    } finally {
      for (const mesh of slot.frame.meshes) { mesh.setMatrixAt(slot.index, saved); mesh.instanceMatrix.needsUpdate = true; }
    }
  }
  dispose() { for (const frames of this.variants) for (const frame of frames) for (const mesh of frame.meshes) { mesh.geometry.dispose(); mesh.dispose(); } this.root.clear(); }
}
