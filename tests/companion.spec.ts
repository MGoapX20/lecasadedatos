import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameFlow } from '../src/game/flow';
import { MissionTracker } from '../src/game/missions';
import { Session } from '../src/game/session';
import { Emitter } from '../src/core/events';
import { SimWorld } from '../src/sim/world';
import type { SimEvent } from '../src/sim/events';
import { WireCutGame } from '../src/sim/wirecut';
import { LockpickGame, DEFAULT_PICK } from '../src/sim/lockpick';
import {
  SnapshotProjector,
  type ProjectionSource,
} from '../src/companion/snapshot';
import {
  PROTOCOL,
  SnapshotInbox,
  channelName,
  type EntryId,
  type GameState,
  type Snapshot,
} from '../src/companion/protocol';
import { targetDeck, TARGETS } from '../src/companion/targets';
import { sceneId, frameKey, renderSnapshot } from '../src/companion/scenes';
import { mountCompanion } from '../src/companion/publisher';
import { loadMint } from './helpers';

function fixture() {
  const level = loadMint();
  const world = new SimWorld(level, 9);
  const player = world.spawnPlayer('front', 'Tokyo');
  const missions = new MissionTracker();
  const session = new Session();
  session.reset('Tokyo');
  const flow: ProjectionSource & { signals: Emitter<{ sim: SimEvent }> } = {
    world,
    missions,
    session,
    state: 'round1',
    paused: false,
    displayState: {
      elapsedMs: 2500,
      ways: [],
      replanning: false,
      replanCount: 0,
    },
    signals: new Emitter<{ sim: SimEvent }>(),
  };
  const project = new SnapshotProjector(
    'test-game',
    targetDeck(0),
    'test-boot',
  );
  const stand = (x: number, y: number) => {
    player.x = x + 0.5;
    player.y = y + 0.5;
    missions.update(world, level, player);
  };
  const note = (event: SimEvent) => {
    missions.note(event);
    project.note(flow, event);
  };
  const capture = () => {
    const snapshot = project.capture(flow, Date.now(), 'en');
    if (snapshot.state !== 'round1')
      throw new Error('Expected the thief round');
    return snapshot;
  };
  stand(48, 61);
  return {
    flow,
    world,
    player,
    missions,
    session,
    project,
    level,
    stand,
    note,
    capture,
  };
}

describe('the companion follows the existing mission board', () => {
  it('tracks recon, discovered footholds, actual entry, lateral movement, and the vault transition', () => {
    const f = fixture();
    expect(f.capture().phase).toBe('recon');
    expect(
      f
        .capture()
        .objectives.filter(
          (o) => o.id.startsWith('foothold.') && o.state === 'hidden',
        ).length,
    ).toBeGreaterThanOrEqual(3);
    for (const id of ['vent', 'sewer', 'front', 'side']) {
      const e = f.level.json.entries.find((e) => e.id === id)!;
      f.stand(...e.spawn);
    }
    expect(f.capture().phase).toBe('foothold');
    expect(sceneId(f.capture())).toBe('access-side');
    f.note({ kind: 'portalExit', thief: f.player.id, portal: 'p_sewer' });
    f.stand(48, 32);
    expect(f.capture().phase).toBe('lateral');
    expect(f.capture().focusEntry).toBe('sewer');
    f.stand(48, 18);
    expect(f.capture().phase).toBe('exfil');
    expect(sceneId(f.capture())).toBe('exfil');
    expect(f.capture().player?.breached).toBe(false);
    expect(f.capture().exfil.loads).toBe(0);
  });

  it('follows actual lock and wire mini-games without changing the mission phase', () => {
    const f = fixture();
    f.world.activePick = new LockpickGame(
      1,
      DEFAULT_PICK,
      f.world.rng,
      20,
      900,
    );
    f.world.activePick.pinsSet = 1;
    expect(f.capture().phase).toBe('recon');
    expect(sceneId(f.capture())).toBe('access-side');
    expect(f.capture().interaction?.progress).toBe(0.5);
    f.world.activePick = null;
    f.world.activeWire = new WireCutGame(2, f.world.rng, 20, 900);
    const s = f.capture();
    expect(sceneId(s)).toBe('lateral-power');
    expect(s.security.camerasDown).toBe(false);
    expect(s.interaction?.progress).toBe(0);
  });

  it('uses distinct scenes for credentials, disguise, and monitoring loss, with truthful inventory', () => {
    const f = fixture();
    f.stand(48, 32);
    const card = f.level.json.keycards.find(
      (k) => (k.kind ?? 'card') === 'card',
    )!;
    const uniform = f.level.json.keycards.find((k) => k.kind === 'uniform')!;
    f.player.keys.add(card.id);
    f.note({ kind: 'pickup', key: card.id, thief: f.player.id });
    expect(sceneId(f.capture())).toBe('lateral-card');
    expect(f.capture().player?.card).toBe(true);
    expect(f.capture().player?.disguised).toBe(false);
    f.player.keys.add(uniform.id);
    f.note({ kind: 'disguised', thief: f.player.id });
    expect(sceneId(f.capture())).toBe('lateral-uniform');
    f.world.camerasDownUntil = 1200;
    f.note({ kind: 'powerCut', thief: f.player.id, untilTick: 1200 });
    expect(sceneId(f.capture())).toBe('lateral-power');
    f.world.tick = 181;
    expect(sceneId(f.capture())).toBe('lateral');
    expect(f.capture().security.camerasDown).toBe(true);
  });

  it('retains drilled channel progress when the player is chased away and never fabricates delivered loads', () => {
    const f = fixture();
    f.player.breached = true;
    f.player.graceTicks = 5000;
    f.stand(...f.level.json.exfil!.stand);
    f.world.step();
    f.world.setDrilling(true);
    for (let i = 0; i < 20; i++) f.world.step();
    const progress = f.capture().exfil.channelProgress;
    expect(progress).toBeGreaterThan(0);
    f.stand(48, 18);
    f.world.step();
    expect(f.world.activeDrill).toBeNull();
    expect(f.capture().exfil.channelProgress).toBe(progress);
    expect(f.capture().exfil.loads).toBe(0);
    f.world.loadsOut = 2;
    f.player.carrying = true;
    const s = f.capture();
    expect(s.exfil.loads).toBe(2);
    expect(s.exfil.complete).toBe(false);
    expect(s.player?.carrying).toBe(true);
  });

  it('takes detached snapshots and leaves the simulation untouched', () => {
    const f = fixture();
    f.note({ kind: 'alarm', source: 'chief', x: 0, y: 0 });
    const oldTick = f.world.tick,
      locks = f.world.doorLocked[0];
    const a = f.capture();
    a.security.doors[0].locked = !a.security.doors[0].locked;
    a.security.guards[0].x = -900;
    a.events[0].tick = -999;
    const b = f.capture();
    expect(f.world.tick).toBe(oldTick);
    expect(f.world.doorLocked[0]).toBe(locks);
    expect(b.security.guards[0].x).toBeGreaterThanOrEqual(0);
    expect(b.events[0].tick).toBe(oldTick);
  });

  it('bounds the event journal, resets it on restart, and keeps a target stable for one visit', () => {
    const f = fixture();
    const first = f.capture();
    for (let i = 0; i < 100; i++) f.note({ kind: 'guardOrdered', guard: 'g1' });
    const a = f.capture();
    expect(a.events).toHaveLength(48);
    expect(a.events[0].id).toBe(53);
    expect(a.target).toBe(first.target);
    f.session.reset('Berlin');
    f.flow.state = 'attract';
    f.note({ kind: 'breach', thief: 4, x: 0, y: 0, tick: 0 });
    const b = f.project.capture(f.flow, Date.now(), 'en');
    expect(b.run).not.toBe(a.run);
    expect(b).not.toHaveProperty('events');
    f.flow.state = 'round1';
    expect(f.capture().events).toHaveLength(0);
    expect(b.target).not.toBe(a.target);
    f.flow.paused = true;
    expect(f.capture().paused).toBe(true);
  });
});

describe('pairing and reconnects', () => {
  it('rejects another game, old packets, and retired visits but accepts a fresh snapshot after a reload', () => {
    const f = fixture(),
      s = { ...f.capture(), sentAt: 1000 };
    const inbox = new SnapshotInbox('test-game');
    expect(inbox.accept({ ...s, source: 'another-game' }, 1)).toBe(false);
    expect(inbox.accept({ ...s, v: 99 }, 1)).toBe(false);
    expect(inbox.accept(s, 20)).toBe(true);
    expect(inbox.accept({ ...s, seq: s.seq - 1 }, 25)).toBe(false);
    expect(inbox.stale(3020)).toBe(false);
    expect(inbox.stale(4020)).toBe(true);
    expect(
      inbox.accept({ ...s, run: 'reloaded:1', seq: 1, sentAt: 5000 }, 4030),
    ).toBe(true);
    expect(inbox.accept({ ...s, seq: 999, sentAt: 4000 }, 4040)).toBe(false);
    expect(inbox.latest?.run).toBe('reloaded:1');
  });

  it('answers a late subscriber with current state over an actual BroadcastChannel and accepts no game commands', async () => {
    const f = fixture();
    const session = new Map<string, string>();
    const local = new Map<string, string>();
    const storage = (map: Map<string, string>) => ({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
    });
    const win = new EventTarget();
    const fakePopup = { closed: false, focus: vi.fn() };
    Object.assign(win, {
      setInterval: globalThis.setInterval,
      open: vi.fn(() => fakePopup),
    });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { hidden: false, getElementById: () => null });
    vi.stubGlobal(
      'location',
      new URL('http://localhost:5173/subdir/index.html?game-parameter=1'),
    );
    vi.stubGlobal('sessionStorage', storage(session));
    vi.stubGlobal('localStorage', storage(local));
    const mounted = mountCompanion(f.flow as unknown as GameFlow, vi.fn());
    mounted.update(0, true);
    const receiver = new BroadcastChannel(channelName(mounted.source));
    try {
      const response = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('No hello response')),
          1500,
        );
        receiver.onmessage = (e) => {
          if (e.data.type === 'snapshot') {
            clearTimeout(timeout);
            resolve(e.data.snapshot);
          }
        };
      });
      receiver.postMessage({ type: 'hello', v: PROTOCOL });
      const s = await response;
      expect(s.source).toBe(mounted.source);
      expect(s.phase).toBe('recon');
      expect(new URL(mounted.url).pathname).toBe('/subdir/red-team.html');
      expect(new URL(mounted.url).searchParams.has('game-parameter')).toBe(
        false,
      );
      receiver.postMessage({ type: 'advance-game' });
      expect(f.flow.state).toBe('round1');
      const packets: Snapshot[] = [];
      receiver.onmessage = (e) => {
        if (e.data.type === 'snapshot') packets.push(e.data.snapshot);
      };
      const now = performance.now() + 100000;
      mounted.update(now, true);
      f.flow.state = 'round2a';
      mounted.update(now + 1);
      await vi.waitFor(() => expect(packets.at(-1)?.state).toBe('round2a'));
      expect(packets.at(-1)).not.toHaveProperty('events');
      const captureSpy = vi.spyOn(SnapshotProjector.prototype, 'capture');
      try {
        for (let i = 2; i < 1000; i += 16) mounted.update(now + i);
        expect(captureSpy).not.toHaveBeenCalled();
        mounted.update(now + 1001);
        expect(captureSpy).toHaveBeenCalledOnce();
        // A new visitor starts immediately, even inside the idle interval.
        f.session.reset('Berlin');
        f.flow.state = 'round1';
        mounted.update(now + 1002);
        await vi.waitFor(() => expect(packets.at(-1)?.state).toBe('round1'));
        expect(packets.at(-1)?.operator).toBe('Berlin');
        expect(packets.at(-1)?.run).not.toBe(s.run);
      } finally {
        captureSpy.mockRestore();
      }
      mounted.open();
      mounted.open();
      expect(
        (win as unknown as { open: ReturnType<typeof vi.fn> }).open,
      ).toHaveBeenCalledTimes(1);
      expect(fakePopup.focus).toHaveBeenCalledOnce();
      // A duplicated main tab inherits the storage ID. It must not take over
      // the original spectator screen or interleave its snapshots.
      const duplicate = mountCompanion(
        fixture().flow as unknown as GameFlow,
        vi.fn(),
      );
      try {
        await vi.waitFor(() =>
          expect(duplicate.source).not.toBe(mounted.source),
        );
        expect(new URL(duplicate.url).searchParams.get('game')).toBe(
          duplicate.source,
        );
      } finally {
        duplicate.dispose();
        duplicate.dispose();
      }
    } finally {
      receiver.close();
      mounted.dispose();
      expect(() => mounted.update(10000, true)).not.toThrow();
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('different phases have different evidence surfaces', () => {
  it('cycles through all organizations before reusing one', () => {
    const next = targetDeck(3),
      picks = Array.from({ length: TARGETS.length }, () => next());
    expect(new Set(picks).size).toBe(TARGETS.length);
    expect(next()).toBe(picks[0]);
    expect(new Set(TARGETS.map((t) => t.style)).size).toBe(TARGETS.length);
  });

  it('renders every thief phase and entrance, and only standby in all other game states', () => {
    const f = fixture(),
      base = f.capture();
    const states: Exclude<GameState, 'round1'>[] = [
      'attract',
      'brief1',
      'r1result',
      'brief2',
      'round2a',
      'aiThink',
      'round2b',
      'results',
      'presenter',
    ];
    const entryScenes = new Set<string>();
    for (let target = 0; target < TARGETS.length; target++) {
      for (const state of states) {
        const html = renderSnapshot({ ...base, target, state });
        expect(html).toContain('data-scene="standby"');
        expect(html).not.toContain(TARGETS[target].domain);
        expect(html).not.toContain('class="operation');
        expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
      }
      for (const entry of [
        'front',
        'side',
        'dock',
        'vent',
        'sewer',
      ] as EntryId[]) {
        const snapshot = {
          ...base,
          target,
          phase: 'foothold' as const,
          focusEntry: entry,
        };
        entryScenes.add(sceneId(snapshot));
        expect(renderSnapshot(snapshot)).toContain(
          `data-scene="access-${entry}"`,
        );
      }
      for (const phase of ['recon', 'foothold', 'lateral', 'exfil'] as const) {
        for (const language of ['en', 'he'] as const) {
          const html = renderSnapshot({ ...base, target, phase, language });
          expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
          expect(html).toContain(TARGETS[target].domain);
        }
      }
    }
    expect(entryScenes.size).toBe(5);
    const recon = renderSnapshot(base);
    expect(recon).toContain('SURFACE / DISCOVERY');
    expect(recon).not.toContain('KNOWN VULNERABILITY');
  });

  it('escapes operator text in the live thief scene', () => {
    const f = fixture();
    const html = renderSnapshot({
      ...f.capture(),
      operator: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;IMG');
  });

  it('keeps standby static, starts on round one, and clears the old scene when it ends', () => {
    const f = fixture(),
      inbox = new SnapshotInbox('test-game');
    const accept = (state: GameState) => {
      f.flow.state = state;
      const s = f.project.capture(f.flow, Date.now(), 'en');
      expect(inbox.accept(s, performance.now())).toBe(true);
      return s;
    };
    const waiting = accept('brief1');
    const live = accept('round1');
    expect(frameKey(live)).not.toBe(frameKey(waiting));
    expect(sceneId(inbox.latest!)).toBe('recon');
    for (const state of [
      'r1result',
      'brief2',
      'round2a',
      'aiThink',
      'round2b',
      'results',
      'presenter',
      'attract',
    ] as const) {
      const s = accept(state);
      expect(frameKey(s)).toBe(frameKey(waiting));
      expect(sceneId(inbox.latest!)).toBe('standby');
      expect(renderSnapshot(s)).not.toContain('data-scene="recon"');
    }
    f.session.reset('Berlin');
    const restarted = accept('round1');
    expect(restarted.run).not.toBe(live.run);
    expect(sceneId(inbox.latest!)).toBe('recon');
    expect(frameKey(restarted)).not.toBe(frameKey(live));
  });

  it('does not inspect the simulation or planner, or record events, outside the thief round', () => {
    const f = fixture();
    f.note({ kind: 'alarm', source: 'chief', x: 0, y: 0 });
    const idleFlow = { ...f.flow };
    for (const property of ['world', 'missions', 'displayState']) {
      Object.defineProperty(idleFlow, property, {
        get: () => {
          throw new Error(`Unexpected ${property} read`);
        },
      });
    }
    for (const state of [
      'attract',
      'brief1',
      'r1result',
      'brief2',
      'round2a',
      'aiThink',
      'round2b',
      'results',
      'presenter',
    ] as const) {
      idleFlow.state = state;
      f.project.note(idleFlow, { kind: 'guardOrdered', guard: 'g1' });
      const s = f.project.capture(idleFlow, Date.now(), 'en');
      expect(s).not.toHaveProperty('events');
      expect(s).not.toHaveProperty('agents');
      expect(s).not.toHaveProperty('security');
    }
    expect(f.capture().events.map((e) => e.event.kind)).toEqual(['alarm']);
  });
});
