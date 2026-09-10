import { expect, it } from 'vitest';
import { Group, Mesh, Raycaster, Vector3 } from 'three';
import { OutlineGlow } from '../src/render/fx';

it.each([true, false])('keeps the entire flat entrance border visible through camera orbits (round=%s)', (circular) => {
  const source = new Group();
  source.userData.highlightFootprint = { circular, radius: 0.75, y: 0.17 };
  const glow = new OutlineGlow();
  glow.set([source]);
  source.updateMatrixWorld(true);
  const border = source.children[0] as Mesh;
  const ray = new Raycaster();
  for (const pitch of [6, 30, 60, 86]) {
    for (let azimuth = 0; azimuth < 360; azimuth += 30) {
      const a = azimuth * Math.PI / 180;
      const p = pitch * Math.PI / 180;
      const camera = new Vector3(10 * Math.cos(a) * Math.cos(p), 10 * Math.sin(p), 10 * Math.sin(a) * Math.cos(p));
      for (let edge = 0; edge < 360; edge += 15) {
        // Sample inside faces rather than exactly on shared triangle seams.
        const e = (edge + 0.37) * Math.PI / 180;
        const radius = circular ? 0.8 : 0.8 / Math.max(Math.abs(Math.cos(e)), Math.abs(Math.sin(e)));
        const target = new Vector3(radius * Math.cos(e), border.position.y, radius * Math.sin(e));
        ray.set(camera, target.clone().sub(camera).normalize());
        const hit = ray.intersectObject(border)[0];
        expect(hit, `pitch=${pitch}, azimuth=${azimuth}, edge=${edge}`).toBeDefined();
        expect(hit.point.y).toBeGreaterThan(0.15);
      }
    }
  }
  glow.update(1);
  expect((border.material as { opacity: number }).opacity).toBe(1);
  glow.clear();
  expect(source.children.every((mesh) => !mesh.visible)).toBe(true);
  glow.dispose();
});
