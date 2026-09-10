export type KeyStrategyKind = 'none' | 'key' | 'lockpick' | 'uniform' | 'power';

export interface KeyStrategy {
  kind: KeyStrategyKind;
  keyId?: string;
}

export interface Personality {
  /** Penalty for reusing ground another accepted plan already claimed. */
  heatLambda: number;
  /** Per-cell cost jitter; breaks ties differently for each agent. */
  noiseEps: number;
  /** Extra cost for standing still, so only useful waits survive. */
  waitBias: number;
  /** 1 = keep one cell of clearance from any watched ground. */
  margin: 0 | 1;
}

export interface PlanRequest {
  agentId: number;
  seed: number;
  entryId: string;
  /** Replans start from where the agent already is, not from an entry. */
  startPlanCell?: number;
  keyStrategy: KeyStrategy;
  startDelayQ: number;
  /** Quanta consumed per plan cell. 1 = machine speed, 2 = a walking human. */
  moveQuanta: number;
  /** Plan as if nobody were watching: a person who does not know the timetable. */
  naive?: boolean;
  personality: Personality;
}

export type PlanActionKind =
  | 'pickup'
  | 'lockpickStart'
  | 'lockpickEnd'
  | 'portalStart'
  | 'portalEnd'
  | 'printStart'
  | 'printEnd';

export interface PlanAction {
  q: number;
  kind: PlanActionKind;
  id: string;
}

export type PlanNodeKind = 'start' | 'move' | 'wait' | 'lockpick' | 'portal' | 'print';

export interface PlanNode {
  cell: number;
  /** Absolute quantum at which the agent finishes this leg. */
  arriveQ: number;
  kind: PlanNodeKind;
  /** Door index for a lockpick, portal id for a portal, key id for a pickup. */
  ref?: string;
}

export interface Plan {
  agentId: number;
  request: PlanRequest;
  /** Absolute quantum at which steps[0] applies. */
  startQ: number;
  endQ: number;
  /** The legs an agent actually walks; the simulation interpolates between them. */
  nodes: PlanNode[];
  /** Plan-grid cell per quantum, for verification and headless replay. */
  steps: Int32Array;
  /** 1 = the agent is inside a vent or sewer and cannot be seen. */
  hidden: Uint8Array;
  actions: PlanAction[];
  signature: string;
  cost: number;
  expansions: number;
  reachedVault: boolean;
}

export interface AlarmWindow {
  fromTick: number;
  toTick: number;
}

export interface DynamicSnapshot {
  nowTick: number;
  nowQ: number;
  doorLocked: Uint8Array;
  /** Serialised patrol programs, one per guard, in level order. */
  guardPrograms: unknown[];
  alarmWindows: AlarmWindow[];
  /** Fine cell per key id. The worker holds its own copy of the level, so the
   *  card's chosen spot has to travel with the job. */
  keycardCells?: Record<string, number>;
}

export interface PlannerStats {
  wallMs: number;
  searches: number;
  expansions: number;
  found: number;
  distinct: number;
  noPath: number;
}

export type PlannerRequestMsg =
  | { type: 'init'; level: unknown }
  | { type: 'plan'; jobId: number; dynamic: DynamicSnapshot; requests: PlanRequest[]; budgetMs: number }
  | { type: 'cancel'; jobId: number };

export type PlannerResponseMsg =
  | { type: 'ready' }
  | { type: 'progress'; jobId: number; done: number; total: number; found: number; distinct: number }
  | { type: 'plans'; jobId: number; plans: Plan[] }
  | { type: 'done'; jobId: number; stats: PlannerStats }
  | { type: 'error'; jobId: number; message: string };
