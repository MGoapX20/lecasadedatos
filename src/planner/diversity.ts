import type { Level } from '../level/loader';
import type { Plan, PlanNode } from './types';

/**
 * A route's identity for the visitor-facing "ways in" count: which door it used,
 * whether it fetched the manager's card, which locks it picked, and the coarse
 * shape of the path. Start delay is deliberately excluded, so 40 agents pouring
 * through the same vent at different times count as one way in, not forty.
 */
export function signatureOf(level: Level, entryId: string, keyKind: string, nodes: PlanNode[]): string {
  const doors: string[] = [];
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'lockpick' && n.ref !== undefined) {
      const d = level.doors[Number(n.ref)];
      if (d) doors.push(`pick:${d.id}`);
    }
    if (n.kind === 'portal' && n.ref) doors.push(`via:${n.ref}`);
    const di = level.pdoorAt[n.cell];
    if (di >= 0) {
      const id = `door:${level.doors[di].id}`;
      if (doors[doors.length - 1] !== id) doors.push(id);
    }
    if (i % 4 === 0) {
      const bx = (n.cell % level.pw) >> 1;
      const by = ((n.cell / level.pw) | 0) >> 1;
      hash ^= bx * 73856093 + by * 19349663;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  const uniqueDoors = [...new Set(doors)].sort();
  return `${entryId}|${keyKind}|${uniqueDoors.join('+')}|${hash.toString(36)}`;
}

/** The same route ignoring its exact shape: what a person would call "a way in". */
export function coarseSignature(sig: string): string {
  return sig.split('|').slice(0, 3).join('|');
}

export class DiversityTracker {
  private seen = new Set<string>();
  private coarse = new Set<string>();

  constructor(
    private readonly heat: Float64Array,
    private readonly level: Level,
  ) {}

  get distinct(): number {
    return this.coarse.size;
  }

  isNew(sig: string): boolean {
    return !this.seen.has(sig);
  }

  /** Record an accepted plan and make its ground more expensive for later agents. */
  accept(plan: Plan): void {
    this.seen.add(plan.signature);
    this.coarse.add(coarseSignature(plan.signature));
    for (const n of plan.nodes) {
      this.heat[n.cell] += 1;
      const x = n.cell % this.level.pw;
      const y = (n.cell / this.level.pw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= this.level.ph) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= this.level.pw) continue;
          this.heat[ny * this.level.pw + nx] += 0.25;
        }
      }
    }
  }

  reset(): void {
    this.seen.clear();
    this.coarse.clear();
    this.heat.fill(0);
  }
}
