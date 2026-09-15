import { Box3, Camera, Frustum, Matrix4, Vector3 } from 'three';
import { READABILITY } from './readability';

const frustum = new Frustum();
const matrix = new Matrix4();
const bounds = new Box3();

/** Include the full rotating arrow and its outline, even when only an edge is visible. */
export function guideArrowInView(position: Vector3, camera: Camera): boolean {
  const scale = READABILITY.indicator;
  bounds.min.set(position.x - .6 * scale, position.y - .04 * scale, position.z - .6 * scale);
  bounds.max.set(position.x + .6 * scale, position.y + 1.45 * scale, position.z + .6 * scale);
  matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return frustum.setFromProjectionMatrix(matrix).intersectsBox(bounds);
}
