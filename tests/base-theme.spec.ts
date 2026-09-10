import { describe, expect, it } from 'vitest';
import { baseNationForStage } from '../src/render/baseBanners';

describe('base wall banners', () => {
  it('uses Iran throughout the attack and resets it for a new game', () => {
    for (const stage of ['attract', 'brief1', 'round1', 'r1result']) expect(baseNationForStage(stage)).toBe('iran');
  });
  it('switches to Israel for the defense briefing, both attack waves, and results', () => {
    for (const stage of ['brief2', 'round2a', 'aiThink', 'round2b', 'results', 'presenter']) expect(baseNationForStage(stage)).toBe('israel');
  });
});
