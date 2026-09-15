import { expect, it } from 'vitest';
import { entrancePressure, type EntranceAttack } from '../src/game/entranceBoard';

it('counts attackers rather than route identifiers and keeps each entrance in place', () => {
  const attacks: EntranceAttack[] = [
    { entryId: 'side', state: 'incoming' }, { entryId: 'side', state: 'incoming' },
    { entryId: 'front', state: 'incoming' },
  ];
  const rows = entrancePressure(['front', 'side', 'dock'], attacks);
  expect(rows.map(r => r.entryId)).toEqual(['front', 'side', 'dock']);
  expect(rows.map(r => r.incoming)).toEqual([1, 2, 0]);
  expect(rows.map(r => r.tone)).toEqual(['ready', 'ready', 'quiet']);
});

it('shows simultaneous attacking, stopped and breached agents without hiding an ongoing threat', () => {
  const attacks: EntranceAttack[] = [
    { entryId: 'side', state: 'stopped' }, { entryId: 'side', state: 'active' },
    { entryId: 'side', state: 'breached' }, { entryId: 'side', state: 'incoming' },
  ];
  expect(entrancePressure(['side'], attacks)[0]).toMatchObject({
    active: 1, stopped: 1, breached: 1, incoming: 1, tone: 'breached',
  });
  expect(entrancePressure(['side'], attacks.slice(0, 2))[0].tone).toBe('active');
});

it('never presents expired or unfinished attempts as a successful defense', () => {
  const rows = entrancePressure(['front', 'side'], [
    { entryId: 'front', state: 'unfinished' }, { entryId: 'front', state: 'stopped' },
    { entryId: 'side', state: 'stopped' },
  ]);
  expect(rows[0]).toMatchObject({ unfinished: 1, stopped: 1, tone: 'quiet' });
  expect(rows[1]).toMatchObject({ stopped: 1, tone: 'stopped' });
});

it('moves a replanned attacker to its current entrance without counting it twice', () => {
  const actors: EntranceAttack[] = [{ entryId: 'front', state: 'active' }];
  expect(entrancePressure(['front', 'side'], actors).map(r => r.active)).toEqual([1, 0]);
  actors[0].entryId = 'side';
  expect(entrancePressure(['front', 'side'], actors).map(r => r.active)).toEqual([0, 1]);
});

it('clears live pressure when a wave ends, preserving breaches and stopped attackers', () => {
  const attacks: EntranceAttack[] = [
    { entryId: 'dock', state: 'active' }, { entryId: 'dock', state: 'incoming' },
    { entryId: 'dock', state: 'breached' }, { entryId: 'dock', state: 'stopped' },
  ];
  expect(entrancePressure(['dock'], attacks, true)[0]).toMatchObject({
    active: 0, incoming: 0, unfinished: 2, breached: 1, stopped: 1,
  });
});
