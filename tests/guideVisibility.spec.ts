import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { guideArrowInView } from '../src/render/guideVisibility';

describe('guide arrow versus offscreen indicator', () => {
  const camera = new OrthographicCamera(-10, 10, 10, -10, .1, 100);
  camera.updateMatrixWorld(true);
  it('keeps the 3D arrow in the outer viewport strip instead of adding an indicator', () => {
    expect(guideArrowInView(new Vector3(9.5, 0, -10), camera)).toBe(true);
    expect(guideArrowInView(new Vector3(0, 9, -10), camera)).toBe(true);
  });
  it('keeps the indicator hidden while any part of the arrow remains onscreen', () => {
    expect(guideArrowInView(new Vector3(10.4, 0, -10), camera)).toBe(true);
    expect(guideArrowInView(new Vector3(0, -11, -10), camera)).toBe(true);
  });
  it('allows an indicator when the entire arrow is outside or behind the camera', () => {
    expect(guideArrowInView(new Vector3(11, 0, -10), camera)).toBe(false);
    expect(guideArrowInView(new Vector3(0, 0, 10), camera)).toBe(false);
  });
});
