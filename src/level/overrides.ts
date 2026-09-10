export interface LevelOverride {
  version: 1;
  levelId: string;
  /** Door id to locked state. */
  doors: Record<string, boolean>;
  /** Guard id to the fine cell the presenter parked them at. */
  guardPosts: Record<string, number>;
}

const KEY = 'lcdd.levelOverride.v1';

export function loadOverride(levelId: string): LevelOverride | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LevelOverride;
    if (parsed.version !== 1 || parsed.levelId !== levelId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOverride(o: LevelOverride): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* private mode */
  }
}

export function clearOverride(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
