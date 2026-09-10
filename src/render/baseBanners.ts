import { CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { fineXYToWorldX, fineXYToWorldZ, type Level } from '../level/loader';

export type BaseNation = 'iran' | 'israel';

/** The visitor attacks the first base, then protects the second one. */
export function baseNationForStage(stage: string): BaseNation {
  return ['brief2', 'round2a', 'aiThink', 'round2b', 'results', 'presenter'].includes(stage) ? 'israel' : 'iran';
}

function flagTexture(nation: BaseNation): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 900; canvas.height = 540;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 540);
  if (nation === 'iran') {
    ctx.fillStyle = '#239f40'; ctx.fillRect(0, 0, 900, 180);
    ctx.fillStyle = '#da0000'; ctx.fillRect(0, 360, 900, 180);
    // Four crescents surrounding the central sword. Paths keep the national
    // emblem visible offline even on systems without a Farsi-symbol font.
    ctx.save(); ctx.translate(450, 271); ctx.scale(73, 73);
    for (const mirror of [-1, 1]) {
      ctx.save(); ctx.scale(mirror, 1);
      ctx.beginPath(); ctx.moveTo(-.15, -.80);
      ctx.bezierCurveTo(-1.12, -.50, -1.15, .51, -.29, .91);
      ctx.bezierCurveTo(-.79, .27, -.79, -.42, -.15, -.80);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-.20, -.70);
      ctx.bezierCurveTo(-.65, -.28, -.48, .45, -.045, .78);
      ctx.lineTo(-.045, .43);
      ctx.bezierCurveTo(-.25, .03, -.35, -.29, -.20, -.70);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(-.065, -.75); ctx.lineTo(.065, -.75);
    ctx.lineTo(.065, .75); ctx.lineTo(0, 1.02); ctx.lineTo(-.065, .75); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-.21, -.91); ctx.quadraticCurveTo(-.12, -1.13, 0, -.97);
    ctx.quadraticCurveTo(.12, -1.13, .21, -.91); ctx.lineTo(0, -.79); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '18px Arial'; ctx.fillStyle = '#fff';
    for (let i = 0; i < 11; i++) {
      ctx.fillText('الله أكبر', (i + .5) * 900 / 11, 169);
      ctx.fillText('الله أكبر', (i + .5) * 900 / 11, 371);
    }
  } else {
    ctx.fillStyle = '#0038b8'; ctx.fillRect(0, 64, 900, 68); ctx.fillRect(0, 408, 900, 68);
    ctx.strokeStyle = '#0038b8'; ctx.lineWidth = 16; ctx.lineJoin = 'miter';
    for (const angle of [-Math.PI / 2, Math.PI / 2]) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = angle + i * Math.PI * 2 / 3;
        const x = 450 + Math.cos(a) * 108, y = 270 + Math.sin(a) * 108;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class BaseBanners {
  readonly root = new Group();
  private materials: Record<BaseNation, MeshBasicMaterial>;
  private panels: Mesh[] = [];
  private geometry = new PlaneGeometry(2.8, 1.68);

  constructor(level: Level) {
    this.materials = Object.fromEntries((['iran', 'israel'] as const).map(nation => [nation,
      new MeshBasicMaterial({ map: flagTexture(nation), side: DoubleSide, toneMapped: false }),
    ])) as Record<BaseNation, MeshBasicMaterial>;
    const hall = level.json.areas.find(a => a.id === 'vault_hall');
    if (!hall) return;
    const [x, y, w] = hall.rect;
    // Inside the north wall, beyond either end of the drill opening. These wall
    // sections remain full-height in the cutaway and after the wall is breached.
    for (const cellX of [x + 4, x + w - 5]) {
      const panel = new Mesh(this.geometry, this.materials.iran);
      panel.position.set(fineXYToWorldX(level, cellX), 4.4, fineXYToWorldZ(level, y) + .025);
      this.root.add(panel); this.panels.push(panel);
    }
  }

  setStage(stage: string): void {
    const material = this.materials[baseNationForStage(stage)];
    for (const panel of this.panels) panel.material = material;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of Object.values(this.materials)) { material.map?.dispose(); material.dispose(); }
  }
}
