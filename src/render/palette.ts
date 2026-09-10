import { Color } from 'three';

/** La Casa de Papel: deep red, black, warm white, brass. */
export const PALETTE: Record<string, number> = {
  red: 0xb3121b,
  redDark: 0x6e0a11,
  redBright: 0xe0313a,
  gold: 0xc9a227,
  goldDim: 0x8a6f1c,
  brass: 0xb98c3a,
  marble: 0xb3ada1,
  marbleDark: 0x8d877c,
  wood: 0x5a3d26,
  woodDark: 0x4a3220,
  concrete: 0x6f6a63,
  asphalt: 0x1d1d21,
  night: 0x0b0b10,
  police: 0x1c3f6e,
  policeDark: 0x122a4a,
  steel: 0x9aa0a6,
  steelDark: 0x585d63,
  ink: 0x141418,
  paper: 0xd9d2c2,
  green: 0x2f6b45,
  glass: 0x9fc6d8,
  /** The mission glow. Bright enough to hold up against near-white marble. */
  highlight: 0x5cff9e,
};

export function col(hex: number): Color {
  return new Color(hex);
}

export const FLOOR_COLORS: Record<string, number> = {
  marble: PALETTE.marble,
  concrete: PALETTE.concrete,
  wood: PALETTE.wood,
  asphalt: PALETTE.asphalt,
  grate: PALETTE.steelDark,
};

/** Distinct jumpsuit tints so a crowd of thieves still reads as individuals. */
export const THIEF_TINTS = [0xb3121b, 0xc41f26, 0xa00f18, 0xd0292f, 0x8f0d14, 0xbe1a22];

/** One colour per entrance, so a route on the map and a row in the list read as the same way in. */
export const WAY_COLORS: Record<string, number> = {
  front: 0xf2323f,
  side: 0xff8c1a,
  dock: 0xe0b83a,
  vent: 0x3ec6ff,
  sewer: 0x5fd66b,
};
export function wayColor(entryId: string): number {
  return WAY_COLORS[entryId] ?? 0xf2323f;
}
