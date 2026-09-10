/** Global tuning. Values here are read by sim, planner and render. */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const QUANTUM_TICKS = 5; // 0.25 s
export const TICKS_PER_SEC = TICK_HZ;

export type Quality = 'high' | 'medium' | 'low';

export interface RuntimeConfig {
  quality: Quality;
  swarmSize: number;
  lang: 'en' | 'he';
  musicVolume: number;
  sfxVolume: number;
  debugDraw: boolean;
}

const DEFAULTS: RuntimeConfig = {
  quality: 'high',
  swarmSize: 80,
  lang: 'en',
  musicVolume: 0.55,
  sfxVolume: 0.6,
  debugDraw: false,
};

const KEY = 'lcdd.config.v1';

function readStore(): Partial<RuntimeConfig> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<RuntimeConfig>) : {};
  } catch {
    return {};
  }
}

export const config: RuntimeConfig = { ...DEFAULTS, ...readStore() };

export function saveConfig(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* kiosk private mode; ignore */
  }
}

/** Screen timing, in milliseconds. */
export const TIMERS = {
  intro1: 8000,
  round1Cap: 180_000,
  round1Result: 4000,
  intro2: 7000,
  round2ACap: 46_000,
  /** How long the wave A verdict stays on screen before the AI's turn. */
  round2AResult: 2800,
  /** The beat where the AI's routes fan out across the building. */
  aiThink: 6000,
  round2BCap: 45_000,
  resultsAuto: 32_000,
  idleGameplay: 45_000,
  idleResults: 90_000,
  attractCycle: 9000,
} as const;
