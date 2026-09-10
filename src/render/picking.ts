import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';

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
