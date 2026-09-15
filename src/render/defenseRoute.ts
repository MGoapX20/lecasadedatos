import { BufferGeometry, Group, Line, LineDashedMaterial, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import { fineXYToWorldX, fineXYToWorldZ, type Level } from '../level/loader';

/** A lightweight, reusable preview of the selected guard's actual walking route. */
export class DefenseRoute {
  readonly root = new Group();
  private line = new Line(new BufferGeometry(), new LineDashedMaterial({
    color: 0x8edaff, dashSize: .35, gapSize: .2, transparent: true, opacity: .9,
    depthWrite: false, toneMapped: false,
  }));
  private target = new Mesh(new RingGeometry(.4, .49, 32), new MeshBasicMaterial({
    color: 0x8edaff, transparent: true, opacity: .95, depthWrite: false, toneMapped: false,
  }));

  constructor() {
    this.target.rotation.x = -Math.PI / 2;
    this.root.add(this.line, this.target);
    this.root.visible = false;
  }

  set(level: Level, points: number[][] | null): void {
    this.root.visible = !!points?.length;
    if (!points?.length) return;
    const vertices = points.map(([x, y]) => new Vector3(fineXYToWorldX(level, x), .12, fineXYToWorldZ(level, y)));
    this.line.geometry.dispose();
    this.line.geometry = new BufferGeometry().setFromPoints(vertices);
    this.line.computeLineDistances();
    this.target.position.copy(vertices[vertices.length - 1]);
  }

  dispose(): void {
    this.line.geometry.dispose(); this.line.material.dispose();
    this.target.geometry.dispose(); this.target.material.dispose();
  }
}
