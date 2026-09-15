/** Counts people and outcomes at each entrance, never internal route IDs. */
export interface EntranceAttack {
  entryId: string;
  state: 'incoming' | 'active' | 'stopped' | 'breached' | 'unfinished';
}

export interface EntrancePressure {
  entryId: string;
  incoming: number;
  active: number;
  stopped: number;
  breached: number;
  unfinished: number;
  tone: 'ready' | 'active' | 'stopped' | 'breached' | 'quiet';
}

export function entrancePressure(entryIds: readonly string[], attacks: readonly EntranceAttack[], ended = false): EntrancePressure[] {
  const rows = new Map(entryIds.map(entryId => [entryId, {
    entryId, incoming: 0, active: 0, stopped: 0, breached: 0, unfinished: 0, tone: 'quiet' as EntrancePressure['tone'],
  }]));
  for (const attack of attacks) {
    const row = rows.get(attack.entryId);
    if (!row) continue;
    const state = ended && (attack.state === 'active' || attack.state === 'incoming') ? 'unfinished' : attack.state;
    row[state]++;
  }
  for (const row of rows.values()) {
    row.tone = row.breached ? 'breached' : row.active ? 'active' : row.incoming ? 'ready'
      : row.stopped && !row.unfinished ? 'stopped' : 'quiet';
  }
  return [...rows.values()];
}
