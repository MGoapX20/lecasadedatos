import { afterEach, expect, it, vi } from 'vitest';
import type { PlannerRequestMsg, PlannerResponseMsg } from '../src/planner/types';
import { enumerateRequests } from '../src/planner/options';
import { planningFixture } from './planning-fixture';
import { makeCtx, runJob } from '../src/planner/planner';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function workerFixture() {
  const messages: PlannerResponseMsg[] = [];
  const worker = { postMessage: (message: PlannerResponseMsg) => messages.push(message),
    onmessage: null as null | ((event: { data: PlannerRequestMsg }) => void) };
  vi.stubGlobal('self', worker);
  await import('../src/planner/worker');
  const level = planningFixture(true);
  worker.onmessage!({ data: { type: 'init', level: level.json } });
  const request = { ...enumerateRequests(level, 1, 5)[0], startPlanCell: 18, heldKeys: ['k_manager'],
    keyStrategy: { kind: 'key' as const, keyId: 'k_manager' }, startDelayQ: 0,
    personality: { heatLambda: 0, noiseEps: 0, margin: 0 as const, waitBias: 0 } };
  const job: PlannerRequestMsg = { type: 'plan', jobId: 1, budgetMs: 1, requests: [request],
    dynamic: { nowTick: 0, nowQ: 0, doorLocked: new Uint8Array([1, 1]), guardPrograms: [], alarmWindows: [], cameras: false } };
  return { messages, worker, job, level };
}

it('delivers a real route even when setup exceeds the budget and forwards power/inventory', async () => {
  const { messages, worker, job } = await workerFixture();
  let clock = 0;
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 5000));
  worker.onmessage!({ data: job });
  spy.mockRestore();
  await vi.waitFor(() => expect(messages.some(message => message.type === 'done')).toBe(true));
  const plans = messages.filter(message => message.type === 'plans').flatMap(message => message.plans);
  const done = messages.find(message => message.type === 'done')!;
  expect(plans).toHaveLength(1);
  if (done.type === 'done') expect(done.stats.searches).toBe(1);
});

it('reports a search exception to the client instead of leaving the stage waiting forever', async () => {
  const { messages, worker, job } = await workerFixture();
  if (job.type === 'plan') job.requests[0].personality = undefined as never;
  worker.onmessage!({ data: job });
  await vi.waitFor(() => expect(messages.some(message => message.type === 'error' && message.jobId === 1)).toBe(true));
  expect(messages.some(message => message.type === 'done')).toBe(false);
});


it('uses the same coverage shaping as headless planning without blocking the only corridor', async () => {
  const { messages, worker, job, level } = await workerFixture();
  if (job.type !== 'plan') throw new Error('Expected a plan job');
  job.budgetMs = 2000;
  job.requests = Array.from({ length: 6 }, (_, i) => ({ ...job.requests[0], agentId: i,
    seed: i + 20, coverage: true }));
  const expected = runJob({ level, ctx: makeCtx(level), programs: [], baseTick: 0,
    doorLocked: job.dynamic.doorLocked, alarmWindows: [], cameras: false,
    requests: job.requests, budgetMs: 2000 });
  worker.onmessage!({ data: job });
  await vi.waitFor(() => expect(messages.some(message => message.type === 'done')).toBe(true));
  const plans = messages.filter(message => message.type === 'plans').flatMap(message => message.plans);
  expect(plans).toHaveLength(6);
  expect(plans.map(p => p.nodes)).toEqual(expected.plans.map(p => p.nodes));
});
