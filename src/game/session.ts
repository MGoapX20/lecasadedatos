export interface Round1Result {
  timeMs: number;
  breached: boolean;
  caught: number;
  entriesTried: Set<string>;
  waysFound: number;
  reachedInsideMs: number | null;
  /** The money actually left the building, which is the only full win. */
  exfiltrated: boolean;
  /** How many loads reached the van. */
  loadsOut: number;
}

export interface Round2Result {
  waveA: 'caught' | 'breached' | 'held' | 'timeout' | 'pending';
  firstBreachMs: number | null;
  breaches: number;
  caughtCount: number;
  heldMs: number;
  swarmSize: number;
}

export interface AiResult {
  distinct: number;
  found: number;
  planMs: number;
  searches: number;
  noPath: number;
}

/** Everything the results screen needs, gathered as the visitor plays. */
export class Session {
  /** Increments on each new visit, including an operator restart. */
  visit = 0;
  codename = 'Tokyo';
  round1: Round1Result = {
    timeMs: 0,
    breached: false,
    caught: 0,
    entriesTried: new Set(),
    waysFound: 0,
    reachedInsideMs: null,
    exfiltrated: false,
    loadsOut: 0,
  };
  round2: Round2Result = {
    waveA: 'pending',
    firstBreachMs: null,
    breaches: 0,
    caughtCount: 0,
    heldMs: 0,
    swarmSize: 0,
  };
  ai: AiResult = { distinct: 0, found: 0, planMs: 0, searches: 0, noPath: 0 };

  reset(codename: string): void {
    this.visit++;
    this.codename = codename;
    this.round1 = {
      timeMs: 0,
      breached: false,
      caught: 0,
      entriesTried: new Set(),
      waysFound: 0,
      reachedInsideMs: null,
      exfiltrated: false,
      loadsOut: 0,
    };
    this.round2 = {
      waveA: 'pending',
      firstBreachMs: null,
      breaches: 0,
      caughtCount: 0,
      heldMs: 0,
      swarmSize: 0,
    };
    this.ai = { distinct: 0, found: 0, planMs: 0, searches: 0, noPath: 0 };
  }

  /** Seconds survived as chief, plus credit for every agent stopped. */
  get chiefScoreMs(): number {
    return this.round2.heldMs + this.round2.caughtCount * 3000;
  }
}
