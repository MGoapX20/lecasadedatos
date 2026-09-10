import { MeshStandardMaterial, SRGBColorSpace, CanvasTexture, DoubleSide } from 'three';
import type { SignKind } from '../level/schema';

/**
 * The lit signs on the shop roofs along the service road. They are flat panels
 * with a drawn logo rather than modelled letters: at the overhead camera's
 * angle a 2D glyph reads instantly, and it keeps the shops distinguishable at
 * a glance while the truck is doing its round.
 *
 * No words, on purpose — the game runs in two languages and a picture needs
 * neither.
 */

const W = 512;
const H = 256;

interface SignStyle {
  /** The neon the logo is drawn in. */
  ink: string;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/** A monitor on a stand: the computer shop. */
function computer(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  roundRect(ctx, -95, -78, 190, 130, 14);
  ctx.stroke();
  ctx.fillStyle = 'rgba(90,220,255,0.22)';
  ctx.fill();
  // Two lines of "code" on the screen, and the stand under it.
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(-58, -34);
  ctx.lineTo(10, -34);
  ctx.moveTo(-58, 4);
  ctx.lineTo(46, 4);
  ctx.moveTo(-14, 52);
  ctx.lineTo(-14, 82);
  ctx.moveTo(-52, 86);
  ctx.lineTo(24, 86);
  ctx.stroke();
}

/** An atom: the supply stand retains its authored food sign key. */
function food(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 8;
  for (const angle of [0, Math.PI / 3, -Math.PI / 3]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 108, 37, angle, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#c8f780';
  ctx.beginPath();ctx.arc(0, 0, 15, 0, Math.PI * 2);ctx.fill();
  ctx.beginPath();ctx.arc(108, 0, 8, 0, Math.PI * 2);ctx.fill();
}

const STYLES: Record<SignKind, SignStyle> = {
  computer: { ink: '#7fe6ff', draw: computer },
  food: { ink: '#c8f780', draw: food },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paint(kind: SignKind): HTMLCanvasElement {
  const style = STYLES[kind];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  // Near-black backing: the emissive map is this same image, so only the neon
  // glows and the panel itself stays a dark board on the roof.
  ctx.fillStyle = '#0a0a0e';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, W - 20, H - 20);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.strokeStyle = style.ink;
  ctx.shadowColor = style.ink;
  ctx.shadowBlur = 26;
  style.draw(ctx);
  ctx.restore();
  return c;
}

const cache = new Map<SignKind, MeshStandardMaterial>();

/** The material for one shop's roof sign, built once and shared. */
export function signMaterial(kind: SignKind): MeshStandardMaterial {
  let m = cache.get(kind);
  if (!m) {
    const tex = new CanvasTexture(paint(kind));
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    m = new MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      // Bloom multiplies this; hot enough to be a landmark, not a floodlight.
      emissiveIntensity: 1.1,
      roughness: 0.6,
      metalness: 0,
      side: DoubleSide,
    });
    cache.set(kind, m);
  }
  return m;
}
