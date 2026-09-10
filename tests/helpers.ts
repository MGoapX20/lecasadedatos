import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel, type Level } from '../src/level/loader';
import type { LevelJson } from '../src/level/schema';

export function loadMint(): Level {
  const raw = readFileSync(resolve(__dirname, '../public/levels/mint_v1.json'), 'utf8');
  return buildLevel(JSON.parse(raw) as LevelJson);
}
