import { BoxGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, RingGeometry, type BufferGeometry } from 'three';
import { mergeStatic } from './models';
import { makeSecretDocuments } from './documents';

const steel = new MeshStandardMaterial({ color: 0x77878a, roughness: .52, metalness: .65 });
const olive = new MeshStandardMaterial({ color: 0x596547, roughness: .7, metalness: .3 });
const dark = new MeshStandardMaterial({ color: 0x172124, roughness: .75 });
const yellow = new MeshStandardMaterial({ color: 0xe4d54f, roughness: .65 });
const uranium = new MeshStandardMaterial({ color: 0xa6be56, emissive: 0x688a23, emissiveIntensity: .18, roughness: .65, metalness: .3 });

function part(root: Group, geometry: BufferGeometry, material: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

/** A physical radiation warning disc, legible without text or external textures. */
function warning(radius: number): Group {
  const root = new Group();
  part(root, new CircleGeometry(radius, 24), yellow);
  part(root, new CircleGeometry(radius * .15, 16), dark, 0, 0, .004);
  for (let i = 0; i < 3; i++) {
    part(root, new RingGeometry(radius * .28, radius * .78, 12, 1, i * Math.PI * 2 / 3, Math.PI / 3), dark, 0, 0, .004);
  }
  return root;
}

/** Merge within a prop so mission outlines still target the entire assembly. */
function finish(root: Group): Group {
  root.updateMatrixWorld(true);
  const pieces = [...root.children];
  const merged = new Group();
  mergeStatic(pieces, merged);
  return merged;
}

/** Sealed uranium storage rack, replacing the old gold printing machine. */
export function uraniumStorage(): Group {
  const root = new Group();
  part(root, new BoxGeometry(3.2, .22, 2.2), dark, 0, .11);
  for (const x of [-.85, .85]) {
    part(root, new CylinderGeometry(.62, .62, 1.8, 12), olive, x, 1.13);
    for (const y of [.3, 1.9]) part(root, new CylinderGeometry(.68, .68, .14, 12), steel, x, y);
    part(root, new CylinderGeometry(.5, .5, .12, 12), uranium, x, 2.04);
    const top = warning(.4);
    top.rotation.x = -Math.PI / 2;
    top.position.set(x, 2.105, 0);
    root.add(top);
    for (const side of [-1, 1]) {
      const badge = warning(.34);
      badge.position.set(x, 1.15, side * .625);
      badge.rotation.y = side < 0 ? Math.PI : 0;
      root.add(badge);
    }
  }
  // The files sit on a small shelf in front of the drums: this remains the
  // existing pickup target, while the material stock itself stays in place.
  part(root, new BoxGeometry(1.0, .12, .9), steel, 0, .42, .64);
  const files = makeSecretDocuments();
  files.position.set(0, .51, .64);
  root.add(files);
  return finish(root);
}

/** Decorative inert missile nose display on the existing plant footprint. */
export function missileHead(): Group {
  const root = new Group();
  part(root, new CylinderGeometry(.58, .62, .22, 10), dark, 0, .11);
  part(root, new CylinderGeometry(.43, .48, 1.05, 12), olive, 0, .74);
  part(root, new CylinderGeometry(.45, .45, .12, 12), yellow, 0, 1.2);
  part(root, new ConeGeometry(.43, 1.0, 12), steel, 0, 1.76);
  for (const side of [-1, 1]) {
    const badge = warning(.22);
    badge.position.set(0, .76, side * .46);
    badge.rotation.y = side < 0 ? Math.PI : 0;
    root.add(badge);
  }
  return finish(root);
}
