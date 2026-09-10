import { Box3, Camera, Frustum, Matrix4, Vector3 } from 'three';

const frustum = new Frustum();
const matrix = new Matrix4();
const bounds = new Box3();

/** Include the full rotating arrow and its outline, even when only an edge is visible. */
export function guideArrowInView(position: Vector3, camera: Camera): boolean {
  bounds.min.set(position.x - .6, position.y - .04, position.z - .6);
  bounds.max.set(position.x + .6, position.y + 1.45, position.z + .6);
  matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return frustum.setFromProjectionMatrix(matrix).intersectsBox(bounds);
}
