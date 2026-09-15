import { Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, Object3D, ShaderMaterial, Shape, ShapeGeometry } from 'three';
import type { FloorRoute } from '../game/recon';
import { fineXYToWorldX, fineXYToWorldZ, type Level } from '../level/loader';

/** A soft wave of light runs forward along the pavement, in one draw call. */
export class ReconFloorRoute {
  readonly mesh: InstancedMesh;
  private material: ShaderMaterial;
  private distances = new InstancedBufferAttribute(new Float32Array(256), 1);
  private motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  private cells: readonly number[] | null = null;
  private from = -1;
  private arrows: { index: number; distance: number; matrix: Matrix4 }[] = [];

  constructor() {
    const shape = new Shape();
    shape.moveTo(-.46, -.42); shape.lineTo(0, .12); shape.lineTo(.46, -.42);
    shape.lineTo(.46, -.08); shape.lineTo(0, .48); shape.lineTo(-.46, -.08); shape.closePath();
    const geometry = new ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.setAttribute('routeDistance', this.distances);
    this.material = new ShaderMaterial({
      transparent: true, depthWrite: false,
      depthTest: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1,
      uniforms: {
        time: { value: 0 }, reveal: { value: 0 }, motion: { value: 1 },
        green: { value: new Color(0x48b979) }, mint: { value: new Color(0xafffce) },
      },
      vertexShader: `
        attribute float routeDistance;
        varying float distanceAlongRoute;
        void main() {
          // Sweep through each chevron from its tail to its tip, too.
          distanceAlongRoute = routeDistance - position.z;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float time, reveal, motion;
        uniform vec3 green, mint;
        varying float distanceAlongRoute;
        void main() {
          // Six arrows per wave; the crest moves two arrows forward each second.
          float phase = (distanceAlongRoute - time * 5.2) * 6.2831853 / 15.6;
          float wave = pow(0.5 + 0.5 * cos(phase), 3.0);
          wave = mix(0.45, wave, motion);
          vec3 color = mix(green, mint, wave * 0.7);
          float opacity = (0.14 + 0.64 * wave) * smoothstep(0.0, 1.0, reveal);
          gl_FragColor = vec4(color, opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new InstancedMesh(geometry, this.material, 256);
    this.mesh.name = 'recon-floor-arrows';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  set(level: Level, route: FloorRoute | null): void {
    if (route && (!this.mesh.visible || route.from < this.from)) {
      this.material.uniforms.reveal.value = 0;
    }
    this.mesh.visible = !!route;
    if (!route) return;
    if (this.cells !== route.cells) {
      this.cells = route.cells;
      this.from = -1;
      this.arrows = [];
      const pose = new Object3D();
      let toNext = 1.3;
      for (let i = 1; i < route.cells.length; i++) {
        const a = route.cells[i - 1], b = route.cells[i];
        const ax = a % level.w + .5, ay = Math.floor(a / level.w) + .5;
        const dx = b % level.w + .5 - ax, dy = Math.floor(b / level.w) + .5 - ay;
        const length = Math.hypot(dx, dy) * level.cellSize;
        while (toNext <= length) {
          const t = toNext / length;
          pose.position.set(fineXYToWorldX(level, ax + dx * t), .035, fineXYToWorldZ(level, ay + dy * t));
          // The flat geometry points down -Z before rotation.
          pose.rotation.y = Math.atan2(-dx, -dy);
          pose.updateMatrix();
          this.arrows.push({ index: i, distance: 1.3 + this.arrows.length * 2.6, matrix: pose.matrix.clone() });
          toNext += 2.6;
        }
        toNext -= length;
      }
    }
    if (this.from === route.from) return;
    this.from = route.from;
    let count = 0;
    for (const arrow of this.arrows) {
      if (arrow.index < route.from || count >= this.mesh.instanceMatrix.count) continue;
      this.distances.setX(count, arrow.distance);
      this.mesh.setMatrixAt(count++, arrow.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.distances.needsUpdate = true;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    const uniforms = this.material.uniforms;
    const reduced = !!this.motion?.matches;
    uniforms.motion.value = reduced ? 0 : 1;
    uniforms.time.value = (uniforms.time.value + dt) % 3;
    uniforms.reveal.value = reduced ? 1 : Math.min(1, uniforms.reveal.value + dt / .7);
  }

  dispose(): void {
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
