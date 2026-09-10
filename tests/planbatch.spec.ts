import { describe, expect, it } from 'vitest';
import { PlanBatcher } from '../src/planner/batch';
import type { Plan } from '../src/planner/types';

const plan = (i: number) => ({ signature: `p${i}` }) as unknown as Plan;

describe('handing planned routes back to the main thread', () => {
  function collect(chunk = 12) {
    const sent: Plan[] = [];
    const b = new PlanBatcher((plans) => sent.push(...plans), chunk);
    return { b, sent };
  }

  it('sends a chunk as soon as one is full, so routes draw as they arrive', () => {
    const { b, sent } = collect(3);
    for (let i = 0; i < 3; i++) b.add(plan(i));
    b.flushIfFull();
    expect(sent).toHaveLength(3);
  });

  it('holds a part-full chunk back until asked', () => {
    const { b, sent } = collect(3);
    b.add(plan(0));
    b.flushIfFull();
    expect(sent).toHaveLength(0);
    expect(b.pending).toBe(1);
  });

  it('loses nothing when the search stops early on its budget', () => {
    // The bug: the worker only flushed on a full chunk or the last request, so
    // a budget break threw away everything found since the previous flush --
    // and still reported it as found. The AI arrived with no ways in.
    for (const found of [0, 1, 11, 12, 13, 25]) {
      const { b, sent } = collect(12);
      for (let i = 0; i < found; i++) {
        b.add(plan(i));
        b.flushIfFull();
      }
      b.flush(); // what the worker must do before reporting the job done
      expect(sent, `${found} found`).toHaveLength(found);
      expect(b.pending).toBe(0);
    }
  });

  it('is safe to flush twice', () => {
    const { b, sent } = collect(12);
    b.add(plan(0));
    b.flush();
    b.flush();
    expect(sent).toHaveLength(1);
  });
});
