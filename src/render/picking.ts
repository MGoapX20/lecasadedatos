import { Plane, Raycaster, Vector2, Vector3, type Camera, type Intersection, type Material, type Mesh, type Object3D } from 'three';
import type { BuildingView } from './building';

const GROUND = new Plane(new Vector3(0, 1, 0), 0);

export class GroundPicker {
  private ray = new Raycaster();
  private ndc = new Vector2();
  private hit = new Vector3();

  /** Where a screen position lands on the floor, in world units. */
  pick(camera: Camera, screenX: number, screenY: number, width: number, height: number): Vector3 | null {
    this.ndc.set((screenX / width) * 2 - 1, -(screenY / height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, camera);
    const p = this.ray.ray.intersectPlane(GROUND, this.hit);
    return p ? this.hit : null;
  }
}

/** Pick the rendered door, with no radius spilling onto nearby walkable ground. */
export class DoorPicker {
  private ray = new Raycaster();
  private ndc = new Vector2();
  private meshes: Mesh[] = [];
  private hits: Intersection[] = [];

  constructor(
    private building: Pick<BuildingView, 'root' | 'doors'>,
    private canPick: (index: number) => boolean,
  ) {}

  pick(camera: Camera, screenX: number, screenY: number, width: number, height: number): number {
    this.ndc.set((screenX / width) * 2 - 1, -(screenY / height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, camera);
    this.ray.far = Infinity;
    let door = -1;
    for (const [index, root] of this.building.doors) {
      if (!this.canPick(index)) continue;
      root.updateWorldMatrix(true, true);
      const distance = this.firstSurface(root);
      if (distance < this.ray.far) {
        this.ray.far = distance;
        door = index;
      }
    }
    if (door < 0) return -1;

    // Only check scenery when a door was hit. A wall or prop in front of the
    // door must not let a click toggle something the visitor cannot see.
    this.building.root.updateWorldMatrix(true, true);
    return this.firstSurface(this.building.root) + 0.001 < this.ray.far ? -1 : door;
  }

  private firstSurface(root: Object3D): number {
    this.meshes.length = 0;
    this.hits.length = 0;
    root.traverseVisible((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some(solidMaterial)) this.meshes.push(mesh);
    });
    this.ray.intersectObjects(this.meshes, false, this.hits);
    for (const hit of this.hits) {
      const material = (hit.object as Mesh).material;
      if (solidMaterial(Array.isArray(material) ? material[hit.face?.materialIndex ?? 0] : material)) {
        return hit.distance;
      }
    }
    return Infinity;
  }
}

// Beams, rings and outline hulls use depthWrite=false: their glow is not a target.
function solidMaterial(material: Material): boolean {
  return material.visible && material.opacity > 0 && material.depthWrite;
}
