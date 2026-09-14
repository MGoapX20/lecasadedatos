import { afterEach, expect, it, vi } from 'vitest';
import { mountAgentViews } from '../src/agent-views/publisher';
import type { GameFlow } from '../src/game/flow';
import type { WorldView } from '../src/render/worldView';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('publishes only compact scene state at 10 Hz while subscribed, with no image capture pipeline', () => {
  const packets: Record<string, unknown>[] = [];
  let channel: { onmessage: ((event: { data: unknown }) => void) | null };
  vi.stubGlobal('BroadcastChannel', class {
    onmessage = null;
    constructor() { channel = this; }
    postMessage(data: Record<string, unknown>) { packets.push(structuredClone(data)); }
    close() {}
  });
  vi.stubGlobal('window', { addEventListener() {} }); vi.stubGlobal('document', { hidden: false });
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const scene = { tick: 0, thieves: [], guards: [], doors: [], cameras: [], keys: [], hole: false, power: true, truck: null, van: null };
  const captureAgentScene = vi.fn(() => scene);
  const flow = { state: 'round2b', paused: false, agentViewWays: [], world: { tick: 0, thieves: [], level: { json: { id: 'test' } } } } as unknown as GameFlow;
  const publisher = mountAgentViews(flow, { captureAgentScene } as unknown as WorldView, () => 'game');
  publisher.update(1); expect(captureAgentScene).not.toHaveBeenCalled();
  channel!.onmessage!({ data: { type: 'watch', source: 'other' } });
  publisher.update(2); expect(captureAgentScene).not.toHaveBeenCalled();
  channel!.onmessage!({ data: { type: 'watch', source: 'game' } });
  for (let now = 10; now < 1010; now += 10) publisher.update(now);
  expect(captureAgentScene).toHaveBeenCalledTimes(10);
  expect(packets[0]).toHaveProperty('level'); expect(packets[1]).not.toHaveProperty('level');
  expect(packets.every(packet => !('image' in packet) && packet.scene && packet.type === 'roster')).toBe(true);
  publisher.update(4000); expect(captureAgentScene).toHaveBeenCalledTimes(10);
});
