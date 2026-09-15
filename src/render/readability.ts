/** Presentation scale only. Camera fitting, the level grid and simulation distances stay fixed. */
export const READABILITY = {
  character: 1.6,
  propHeight: 1.15,
  pickup: 1.3,
  indicator: 1.25,
} as const;

/** The loaded figures are normalized to one unit before their pose scale is applied. */
export function characterHeight(poseScale: number): number {
  return 1.72 * poseScale / 1.28;
}

export const GUARD_POSE_SCALE = 1.4 * READABILITY.character;
export const PLAYER_POSE_SCALE = 1.5 * READABILITY.character;
export const THIEF_POSE_SCALE = 1.28 * READABILITY.character;
export const GUARD_BADGE_HEIGHT = characterHeight(GUARD_POSE_SCALE) + .65;
