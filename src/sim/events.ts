export type SimEvent =
  | { kind: 'guardOrdered'; guard: string }
  | { kind: 'spotted'; thief: number; guard: string }
  | { kind: 'powerCut'; thief: number; untilTick: number }
  | { kind: 'disguised'; thief: number }
  | { kind: 'caught'; thief: number; guard: string; x: number; y: number }
  | { kind: 'breach'; thief: number; x: number; y: number; tick: number }
  | { kind: 'printStart'; thief: number }
  | { kind: 'alarm'; source: 'camera' | 'chief'; x: number; y: number }
  | { kind: 'pickup'; thief: number; key: string }
  | { kind: 'lockpickStart'; thief: number; door: number }
  | { kind: 'lockpickEnd'; thief: number; door: number }
  | { kind: 'pickHit'; door: number; pin: number; of: number }
  | { kind: 'pickMiss'; door: number }
  | { kind: 'wireStart'; thief: number }
  | { kind: 'wireCut'; thief: number; left: number }
  | { kind: 'wireShort'; thief: number }
  | { kind: 'truckBoard'; thief: number }
  | { kind: 'truckLeave'; thief: number; inside: boolean }
  | { kind: 'noise'; x: number; y: number }
  | { kind: 'doorLocked'; door: number; locked: boolean }
  | { kind: 'badged'; thief: number; door: number }
  | { kind: 'portalEnter'; thief: number; portal: string }
  | { kind: 'portalExit'; thief: number; portal: string }
  | { kind: 'respawn'; thief: number }
  | { kind: 'drillStart'; thief: number }
  | { kind: 'drillJam'; thief: number }
  | { kind: 'holeOpen'; thief: number; tick: number }
  | { kind: 'vanArrived'; tick: number }
  | { kind: 'loadTaken'; thief: number; out: number }
  | { kind: 'loadDelivered'; thief: number; out: number; of: number }
  | { kind: 'exfilDone'; thief: number; tick: number }
  | { kind: 'thiefDone'; thief: number; reason: 'caught' | 'breach' | 'expired' | 'blocked' };
