import { MeshStandardMaterial, DoubleSide } from 'three';
import { PALETTE } from './palette';

export type MatKey =
  | 'marble'
  | 'marbleDark'
  | 'wood'
  | 'concrete'
  | 'asphalt'
  | 'stone'
  | 'metal'
  | 'brass'
  | 'red'
  | 'redDark'
  | 'dark'
  | 'glass'
  | 'lens'
  | 'foliage'
  | 'paper'
  | 'police'
  | 'skin'
  | 'mask'
  | 'beamGold'
  | 'beamRed'
  | 'emissiveGold'
  | 'emissiveRed';

const DEFS: Record<MatKey, ConstructorParameters<typeof MeshStandardMaterial>[0]> = {
  marble: { color: PALETTE.marble, roughness: 0.55, metalness: 0.03 },
  marbleDark: { color: PALETTE.marbleDark, roughness: 0.58, metalness: 0.03 },
  wood: { color: PALETTE.wood, roughness: 0.72, metalness: 0.0 },
  concrete: { color: PALETTE.concrete, roughness: 0.9, metalness: 0.0 },
  asphalt: { color: PALETTE.asphalt, roughness: 0.96, metalness: 0.0 },
  stone: { color: 0x9d968a, roughness: 0.72, metalness: 0.0 },
  metal: { color: PALETTE.steel, roughness: 0.46, metalness: 0.8 },
  brass: { color: PALETTE.brass, roughness: 0.38, metalness: 0.85 },
  red: { color: PALETTE.red, roughness: 0.5, metalness: 0.05 },
  redDark: { color: PALETTE.redDark, roughness: 0.6, metalness: 0.05 },
  dark: { color: PALETTE.ink, roughness: 0.8, metalness: 0.1 },
  glass: { color: PALETTE.glass, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, side: DoubleSide },
  lens: { color: 0x11141a, roughness: 0.08, metalness: 0.35 },
  foliage: { color: PALETTE.green, roughness: 0.85, metalness: 0.0 },
  paper: { color: PALETTE.paper, roughness: 0.85, metalness: 0.0 },
  police: { color: PALETTE.police, roughness: 0.6, metalness: 0.05 },
  skin: { color: 0xc9a48a, roughness: 0.75, metalness: 0.0 },
  mask: { color: 0xf2ece0, roughness: 0.35, metalness: 0.0 },
  beamGold: {
    color: PALETTE.gold,
    emissive: PALETTE.gold,
    // Kept dim on purpose: bloom multiplies this, and a hot beam swallows the
    // card it is supposed to be pointing at.
    emissiveIntensity: 0.25,
    roughness: 1,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    side: DoubleSide,
  },
  beamRed: {
    // The camera's own beam. Deliberately faint: bloom multiplies it, and a hot
    // line across the hall would read as an alarm rather than as a camera.
    color: PALETTE.redBright,
    emissive: PALETTE.redBright,
    emissiveIntensity: 0.7,
    roughness: 1,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  },
  emissiveGold: { color: PALETTE.gold, emissive: PALETTE.gold, emissiveIntensity: 1.6, roughness: 0.4 },
  emissiveRed: { color: PALETTE.redBright, emissive: PALETTE.redBright, emissiveIntensity: 1.8, roughness: 0.4 },
};

const cache = new Map<MatKey, MeshStandardMaterial>();

export function mat(key: MatKey): MeshStandardMaterial {
  let m = cache.get(key);
  if (!m) {
    m = new MeshStandardMaterial(DEFS[key]);
    cache.set(key, m);
  }
  return m;
}

export function disposeMaterials(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
