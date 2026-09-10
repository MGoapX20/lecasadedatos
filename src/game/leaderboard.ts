import { Rng } from '../core/rng';

export interface Entry {
  codename: string;
  heldMs: number;
  breaches: number;
  caught: number;
  at: number;
}

const KEY = 'lcdd.leaderboard.v1';
const MAX = 12;

/** City codenames, in the spirit of the show. */
export const CODENAMES = [
  'Tokyo',
  'Berlin',
  'Nairobi',
  'Denver',
  'Rio',
  'Moscow',
  'Helsinki',
  'Oslo',
  'Lisbon',
  'Stockholm',
  'Palermo',
  'Bogotá',
  'Marseille',
  'Manila',
  'Cairo',
  'Athens',
  'Haifa',
  'Tel Aviv',
  'Odessa',
  'Naples',
];

export function pickCodename(seed: number): string {
  return new Rng(seed).pick(CODENAMES);
}

export function loadBoard(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Entry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Returns the saved board and the new entry's rank, or -1 if it did not place. */
export function submit(entry: Entry): { board: Entry[]; rank: number } {
  const board = loadBoard();
  board.push(entry);
  board.sort((a, b) => b.heldMs - a.heldMs || a.breaches - b.breaches);
  const trimmed = board.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* private mode; the board just will not persist */
  }
  return { board: trimmed, rank: trimmed.indexOf(entry) };
}

export function clearBoard(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
