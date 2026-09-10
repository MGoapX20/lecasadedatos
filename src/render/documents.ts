import { CanvasTexture, Group, Mesh, MeshStandardMaterial, PlaneGeometry, BoxGeometry, SRGBColorSpace } from 'three';

let cover: CanvasTexture | undefined;
/** Shared stamped paper artwork for carried files and the loose-page flourish. */
export function secretDocumentTexture(): CanvasTexture {
  if (cover) return cover;
  const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f0df'; ctx.fillRect(0, 0, 384, 512);
  ctx.fillStyle = '#44505b'; ctx.font = 'bold 25px sans-serif'; ctx.fillText('CLASSIFIED', 32, 52);
  ctx.fillStyle = '#8d989a';
  for (let i = 0; i < 10; i++) ctx.fillRect(32, 100 + i * 32, i % 3 === 0 ? 250 : 310, 8);
  ctx.save(); ctx.translate(192, 265); ctx.rotate(-.16);
  ctx.strokeStyle = '#c92626'; ctx.lineWidth = 8; ctx.strokeRect(-176, -39, 352, 78);
  ctx.fillStyle = '#c92626'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('TOP SECRET', 0, 15);
  ctx.restore();
  cover = new CanvasTexture(canvas); cover.colorSpace = SRGBColorSpace;
  return cover;
}

/** Oversized white document stack: readable from the gameplay camera. */
export function makeSecretDocuments(scale = 1): Group {
  const group = new Group();
  const paper = new MeshStandardMaterial({ color: 0xf4f0df, roughness: .92 });
  const edge = new MeshStandardMaterial({ color: 0xaeb4b5, roughness: .9 });
  for (let i = 0; i < 4; i++) {
    const page = new Mesh(new BoxGeometry(.65, .06, .88), i % 2 ? paper : edge);
    page.position.set(i % 2 * .012, i * .065, 0); group.add(page);
  }
  const face = new Mesh(new PlaneGeometry(.65, .88), new MeshStandardMaterial({ map: secretDocumentTexture(), roughness: .95 }));
  face.rotation.x = -Math.PI / 2; face.position.y = .23; group.add(face);
  // A second visible stamp faces forward while the stack is carried.
  const front = new Mesh(new PlaneGeometry(.65, .24), face.material);
  front.position.set(0, .1, .441); group.add(front);
  group.scale.setScalar(scale); return group;
}
