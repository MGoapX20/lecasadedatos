import {
  BufferAttribute,
  CanvasTexture,
  Color,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type BufferGeometry,
} from 'three';
import { PALETTE } from './palette';

/**
 * Procedural surfaces drawn once into canvases at startup: marble tiles, wood
 * planks, concrete, asphalt and plaster. No files, no network, and a normal map
 * derived from each surface's height so grout and plank seams catch the light.
 * Every texture repeats every `metres` world units; geometry gets world-space
 * UVs (see worldUV) so a seam never depends on where a room's rect starts.
 */

export interface Surface {
  material: MeshStandardMaterial;
  /** World units covered by one repeat of the texture. */
  metres: number;
}

const SIZE = 512;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { c, ctx };
}

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function shade(base: number, k: number): string {
  const c = new Color(base);
  c.r = Math.min(1, Math.max(0, c.r * k));
  c.g = Math.min(1, Math.max(0, c.g * k));
  c.b = Math.min(1, Math.max(0, c.b * k));
  return `#${c.getHexString()}`;
}

/** Fine grain over the whole canvas; cheap and it kills the flat-shaded look. */
function speckle(ctx: CanvasRenderingContext2D, r: () => number, amount: number, count = 22000): void {
  for (let i = 0; i < count; i++) {
    const v = (r() - 0.5) * amount;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    ctx.fillRect(r() * SIZE, r() * SIZE, 1 + r() * 2, 1 + r() * 2);
  }
}

function texture(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Sobel over a greyscale height canvas; blue-up tangent-space normal map. */
function normalFromHeight(height: HTMLCanvasElement, strength: number): Texture {
  const src = height.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data;
  const { c, ctx } = canvas();
  const out = ctx.createImageData(SIZE, SIZE);
  const h = (x: number, y: number) => src[(((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)) * 4] / 255;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return texture(c, false);
}

// ------------------------------------------------------------------ marble

function marble(base: number, tiles: number, seed: number): { map: Texture; normal: Texture; rough: Texture } {
  const r = rng(seed);
  const { c, ctx } = canvas();
  const hgt = canvas();
  const rgh = canvas();
  const tile = SIZE / tiles;
  hgt.ctx.fillStyle = '#ffffff';
  hgt.ctx.fillRect(0, 0, SIZE, SIZE);
  rgh.ctx.fillStyle = '#4a4a4a';
  rgh.ctx.fillRect(0, 0, SIZE, SIZE);
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const k = 0.8 + r() * 0.1;
      ctx.fillStyle = shade(base, k);
      ctx.fillRect(tx * tile, ty * tile, tile, tile);
      // Veins: a few soft wandering strokes per tile.
      const veins = 2 + Math.floor(r() * 3);
      for (let v = 0; v < veins; v++) {
        ctx.strokeStyle = `rgba(${r() < 0.5 ? '70,66,60' : '255,255,255'},${0.08 + r() * 0.12})`;
        ctx.lineWidth = 0.6 + r() * 1.6;
        ctx.beginPath();
        let x = tx * tile + r() * tile;
        let y = ty * tile + r() * tile;
        ctx.moveTo(x, y);
        for (let s = 0; s < 6; s++) {
          x += (r() - 0.5) * tile * 0.6;
          y += (r() - 0.5) * tile * 0.6;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  // Grout lines, darker and recessed.
  ctx.strokeStyle = shade(base, 0.62);
  ctx.lineWidth = 3;
  hgt.ctx.strokeStyle = '#000000';
  hgt.ctx.lineWidth = 4;
  rgh.ctx.strokeStyle = '#d0d0d0';
  rgh.ctx.lineWidth = 4;
  for (let i = 0; i <= tiles; i++) {
    const p = Math.min(SIZE - 1, i * tile) + 0.5;
    for (const g of [ctx, hgt.ctx, rgh.ctx]) {
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, SIZE);
      g.moveTo(0, p);
      g.lineTo(SIZE, p);
      g.stroke();
    }
  }
  speckle(ctx, r, 0.05);
  return { map: texture(c), normal: normalFromHeight(hgt.c, 1.6), rough: texture(rgh.c, false) };
}

// ------------------------------------------------------------------ wood

function wood(base: number, planks: number, seed: number): { map: Texture; normal: Texture } {
  const r = rng(seed);
  const { c, ctx } = canvas();
  const hgt = canvas();
  hgt.ctx.fillStyle = '#ffffff';
  hgt.ctx.fillRect(0, 0, SIZE, SIZE);
  const ph = SIZE / planks;
  for (let p = 0; p < planks; p++) {
    const y0 = p * ph;
    const k = 0.82 + r() * 0.36;
    ctx.fillStyle = shade(base, k);
    ctx.fillRect(0, y0, SIZE, ph);
    // Grain: long low-contrast lines along the plank.
    for (let g = 0; g < 26; g++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.04 + r() * 0.1})`;
      ctx.lineWidth = 0.5 + r() * 1.2;
      ctx.beginPath();
      const y = y0 + r() * ph;
      ctx.moveTo(0, y);
      for (let x = 0; x <= SIZE; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + g) * 1.5 + (r() - 0.5));
      ctx.stroke();
    }
    // A plank end somewhere along the row.
    const ex = r() * SIZE;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(ex, y0, 2, ph);
    hgt.ctx.fillStyle = '#000000';
    hgt.ctx.fillRect(ex, y0, 3, ph);
    hgt.ctx.fillRect(0, y0, SIZE, 3);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let p = 0; p <= planks; p++) ctx.fillRect(0, p * ph - 1, SIZE, 2);
  speckle(ctx, r, 0.06);
  return { map: texture(c), normal: normalFromHeight(hgt.c, 1.2) };
}

// -------------------------------------------------------------- rough stuff

function grainy(base: number, seed: number, amount: number, stains: number): { map: Texture; normal: Texture } {
  const r = rng(seed);
  const { c, ctx } = canvas();
  const hgt = canvas();
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, SIZE, SIZE);
  hgt.ctx.fillStyle = '#808080';
  hgt.ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < stains; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    const rad = 20 + r() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(0,0,0,${0.05 + r() * 0.12})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  speckle(ctx, r, amount, 40000);
  for (let i = 0; i < 9000; i++) {
    const v = (r() - 0.5) * 0.5;
    hgt.ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    hgt.ctx.fillRect(r() * SIZE, r() * SIZE, 1 + r() * 3, 1 + r() * 3);
  }
  // Cracks.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    let x = r() * SIZE;
    let y = r() * SIZE;
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (r() - 0.5) * 60;
      y += (r() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return { map: texture(c), normal: normalFromHeight(hgt.c, 0.5) };
}

// ------------------------------------------------------------------ plaster

function plaster(base: number, seed: number): { map: Texture; normal: Texture } {
  const r = rng(seed);
  const { c, ctx } = canvas();
  const hgt = canvas();
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, SIZE, SIZE);
  hgt.ctx.fillStyle = '#909090';
  hgt.ctx.fillRect(0, 0, SIZE, SIZE);
  // Ashlar courses: a stone wall rather than a painted box.
  const course = SIZE / 6;
  for (let row = 0; row < 6; row++) {
    const off = row % 2 ? course * 0.9 : 0;
    for (let x = -course * 2 + off; x < SIZE + course; x += course * 1.8) {
      const k = 0.94 + r() * 0.1;
      ctx.fillStyle = shade(base, k);
      ctx.fillRect(x + 1, row * course + 1, course * 1.8 - 2, course - 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, row * course, SIZE, 2);
    hgt.ctx.fillStyle = '#202020';
    hgt.ctx.fillRect(0, row * course, SIZE, 3);
    for (let x = -course * 2 + off; x < SIZE + course; x += course * 1.8) {
      ctx.fillRect(x, row * course, 2, course);
      hgt.ctx.fillRect(x, row * course, 3, course);
    }
  }
  speckle(ctx, r, 0.08, 30000);
  return { map: texture(c), normal: normalFromHeight(hgt.c, 0.9) };
}

// ------------------------------------------------------------------ library

let cache: Record<string, Surface> | null = null;

export function surfaces(): Record<string, Surface> {
  if (cache) return cache;
  const m = marble(PALETTE.marble, 4, 11);
  const md = marble(PALETTE.marbleDark, 4, 12);
  const w = wood(PALETTE.wood, 8, 21);
  const cc = grainy(PALETTE.concrete, 31, 0.16, 6);
  const a = grainy(PALETTE.asphalt, 41, 0.14, 4);
  const p = plaster(0xa89f8f, 51);
  const ps = plaster(0x9d968a, 52);
  cache = {
    marble: {
      material: new MeshStandardMaterial({
        map: m.map,
        normalMap: m.normal,
        roughnessMap: m.rough,
        // Polished stone, not a mirror: the hall is lit by half a dozen point
        // lights and a glossy floor turns every one of them into a flare.
        roughness: 0.66,
        metalness: 0.04,
        envMapIntensity: 0.4,
      }),
      metres: 4,
    },
    marbleDark: {
      material: new MeshStandardMaterial({ map: md.map, normalMap: md.normal, roughness: 0.62, metalness: 0.03 }),
      metres: 4,
    },
    wood: {
      material: new MeshStandardMaterial({ map: w.map, normalMap: w.normal, roughness: 0.68, metalness: 0 }),
      metres: 2.4,
    },
    concrete: {
      material: new MeshStandardMaterial({ map: cc.map, normalMap: cc.normal, roughness: 0.92, metalness: 0 }),
      metres: 5,
    },
    asphalt: {
      material: new MeshStandardMaterial({ map: a.map, normalMap: a.normal, roughness: 0.96, metalness: 0 }),
      metres: 6,
    },
    grate: {
      material: new MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.6, metalness: 0.6 }),
      metres: 1,
    },
    plaster: {
      material: new MeshStandardMaterial({ map: p.map, normalMap: p.normal, roughness: 0.85, metalness: 0 }),
      metres: 3,
    },
    shell: {
      material: new MeshStandardMaterial({ map: ps.map, normalMap: ps.normal, roughness: 0.82, metalness: 0 }),
      metres: 3.6,
    },
  };
  return cache;
}

/**
 * World-space UVs: floors map from x/z, walls from the axis they run along and
 * y, chosen per vertex by the face normal. Scale is world units per repeat.
 */
export function worldUV(geo: BufferGeometry, metres: number): void {
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = x;
      v = z;
    } else if (nx >= nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv[i * 2] = u / metres;
    uv[i * 2 + 1] = v / metres;
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
}
