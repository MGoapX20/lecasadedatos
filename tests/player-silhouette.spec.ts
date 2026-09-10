import { describe, it, expect } from 'vitest';
import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { blankCharacterPose, SkinnedCharacterBatch } from '../src/render/characters';

describe('player silhouette lifecycle', () => {
  it('follows visibility and uniform changes without revealing other actors', () => {
    const scene=new Group();scene.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial()));
    const clip=new AnimationClip('idle',1,[]);
    const model={scene,clips:{idle:clip,walk:clip,run:clip}};
    const batch=new SkinnedCharacterBatch(2,model,model);
    const pose={...blankCharacterPose(),visible:true,silhouette:true};
    batch.setPose(0,pose);
    const normal=batch.root.children[0],uniform=batch.root.children[1];
    const mesh=normal.children[0] as Mesh;
    expect(mesh.children).toHaveLength(1);
    expect((mesh.children[0] as Mesh).geometry).toBe(mesh.geometry);
    batch.setPose(0,{...pose,variant:1});
    expect(normal.visible).toBe(false);expect(uniform.visible).toBe(true);
    batch.setPose(1,{...pose,silhouette:false});
    expect(batch.root.children[2].children[0].children).toHaveLength(0);
    batch.setPose(0,{...pose,visible:false});
    expect(normal.visible).toBe(false);expect(uniform.visible).toBe(false);
    batch.setPose(0,pose);batch.setPose(0,pose);
    expect(mesh.children).toHaveLength(1);
    batch.hideAll();expect(normal.visible).toBe(false);
    batch.dispose();
  });
});
