import { describe, expect, it } from 'vitest';
import { MissionTracker } from '../src/game/missions';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

const level = loadMint();

function start(): { m: MissionTracker; world: SimWorld; player: ReturnType<SimWorld['spawnPlayer']> } {
  const world = new SimWorld(level, 9);
  const player = world.spawnPlayer('front', 'Tokyo');
  player.graceTicks = 0;
  const m = new MissionTracker();
  m.reset();
  return { m, world, player };
}

function stand(m: MissionTracker, world: SimWorld, player: { x: number; y: number }, x: number, y: number): void {
  player.x = x + 0.5;
  player.y = y + 0.5;
  m.update(world, level, player as never);
}

const phase = (m: MissionTracker, id: string) => m.phases.find((p) => p.id === id)!;
const obj = (m: MissionTracker, phaseId: string, objId: string) =>
  phase(m, phaseId).objectives.find((o) => o.id === objId)!;

describe('the mission board', () => {
  it('opens on recon with the ways in still to be found', () => {
    const { m, world, player } = start();
    m.update(world, level, player);
    expect(phase(m, 'recon').active).toBe(true);
    expect(phase(m, 'foothold').active).toBe(false);
    // The one you spawn at is the only one you can see from here.
    const hidden = phase(m, 'foothold').objectives.filter((o) => o.state === 'hidden');
    expect(hidden.length, 'most ways in must be earned by looking').toBeGreaterThanOrEqual(3);
  });

  it('puts a way in on the board when the thief gets near it', () => {
    const { m, world, player } = start();
    expect(obj(m, 'foothold', 'foothold.sewer').state).toBe('hidden');
    const sewer = level.json.entries.find((e) => e.id === 'sewer')!;
    stand(m, world, player, sewer.spawn[0] + 3, sewer.spawn[1]);
    expect(obj(m, 'foothold', 'foothold.sewer').state).toBe('open');
  });

  it('reports each discovery exactly once, so it can be announced', () => {
    const { m, world, player } = start();
    const vent = level.json.entries.find((e) => e.id === 'vent')!;
    player.x = vent.spawn[0] + 2.5;
    player.y = vent.spawn[1] + 0.5;
    const first = m.update(world, level, player).map((o) => o.id);
    const second = m.update(world, level, player).map((o) => o.id);
    expect(first).toContain('foothold.vent');
    expect(second, 'a discovery is news only once').not.toContain('foothold.vent');
  });

  it('finishes recon once the thief has walked round and found two ways', () => {
    const { m, world, player } = start();
    expect(phase(m, 'recon').done).toBe(false);
    const at = (id: string) => level.json.entries.find((e) => e.id === id)!.spawn;
    stand(m, world, player, at('vent')[0] + 3, at('vent')[1]);
    stand(m, world, player, at('sewer')[0] + 3, at('sewer')[1]);
    stand(m, world, player, at('front')[0], at('front')[1]);
    stand(m, world, player, at('side')[0] - 3, at('side')[1]);
    expect(phase(m, 'recon').done, 'four sides and four ways is plenty').toBe(true);
    expect(phase(m, 'foothold').active).toBe(true);
  });

  it('credits the way in that was actually used', () => {
    const { m, world, player } = start();
    m.note({ kind: 'portalExit', thief: player.id, portal: 'p_sewer' });
    // In the corridor, which is indoors without being the vault: standing in
    // the vault itself hands the board to the exfiltration section.
    stand(m, world, player, 48, 32);
    expect(obj(m, 'foothold', 'foothold.sewer').state).toBe('done');
    expect(phase(m, 'foothold').done).toBe(true);
    expect(phase(m, 'lateral').active, 'being inside is where lateral movement starts').toBe(true);
  });

  it('falls back to the front door when nothing else explains being inside', () => {
    const { m, world, player } = start();
    stand(m, world, player, 48, 32);
    expect(obj(m, 'foothold', 'foothold.front').state).toBe('done');
  });

  it('ticks the lateral moves off as they happen', () => {
    const { m, world, player } = start();
    stand(m, world, player, 48, 32);
    expect(obj(m, 'lateral', 'lateral.power').state).toBe('open');

    world.camerasDownUntil = world.tick + 200;
    const card = level.json.keycards.find((k) => (k.kind ?? 'card') === 'card')!;
    const uniform = level.json.keycards.find((k) => k.kind === 'uniform')!;
    player.keys.add(card.id);
    player.keys.add(uniform.id);
    player.breached = true;
    m.update(world, level, player);

    expect(obj(m, 'lateral', 'lateral.power').state).toBe('done');
    expect(obj(m, 'lateral', 'lateral.card').state).toBe('done');
    expect(obj(m, 'lateral', 'lateral.uniform').state).toBe('done');
    expect(obj(m, 'lateral', 'lateral.vault').state).toBe('done');
  });

  it('lists all four sections from the first frame', () => {
    // The shape of an intrusion is the argument the exhibit is making. Half of
    // it hidden makes no argument, so only the ways in are ever secret.
    const { m, world, player } = start();
    m.update(world, level, player);
    expect(m.phases.map((p) => p.id)).toEqual(['recon', 'foothold', 'lateral', 'exfil']);
  });

  it('hands the board to exfiltration the moment the thief is in the vault', () => {
    const { m, world, player } = start();
    stand(m, world, player, 48, 32);
    expect(phase(m, 'lateral').active).toBe(true);
    stand(m, world, player, level.json.vault.cell[0], level.json.vault.cell[1]);
    expect(phase(m, 'exfil').active, 'the vault is where getting it out begins').toBe(true);
    expect(phase(m, 'lateral').active).toBe(false);
  });

  it('outlines nothing that has not been found yet', () => {
    // The glow follows the board. A way in that is still hidden must not be
    // outlined, or walking the perimeter — the whole of the recon phase — is
    // over before it starts.
    const { m, world, player } = start();
    stand(m, world, player, 70, 60);
    expect(m.activeMarks, 'nothing found, nothing lit').toHaveLength(0);
    const sewer = level.json.entries.find((e) => e.id === 'sewer')!;
    stand(m, world, player, sewer.spawn[0] + 3, sewer.spawn[1]);
    expect(m.activeMarks, 'the way he just found is lit').toContainEqual({
      kind: 'portal',
      id: 'p_sewer',
    });
  });

  it('outlines only the objectives still to do', () => {
    const { m, world, player } = start();
    stand(m, world, player, 48, 32);
    expect(phase(m, 'lateral').active).toBe(true);
    const before = m.activeMarks.length;
    expect(before, 'the items and the vault door').toBeGreaterThan(1);
    expect(m.activeMarks).toContainEqual({ kind: 'door', id: 'd_vault' });
    // Taking every item leaves only the vault to outline.
    for (let i = 0; i < level.json.keycards.length; i++) world.keyTaken[i] = 1;
    m.update(world, level, player);
    expect(m.activeMarks, 'what is done stops glowing').toEqual([{ kind: 'door', id: 'd_vault' }]);
  });

  it('names every phase and objective in both languages', async () => {
    const en = (await import('../strings/en.json')).default as Record<string, string>;
    const he = (await import('../strings/he.json')).default as Record<string, string>;
    const { m, world, player } = start();
    m.update(world, level, player);
    for (const p of m.phases) {
      for (const key of [p.labelKey, p.cyberKey]) {
        expect(en[key], `${key} missing from English`).toBeTruthy();
        expect(he[key], `${key} missing from Hebrew`).toBeTruthy();
      }
      for (const o of p.objectives) {
        for (const key of [o.labelKey, o.cyberKey]) {
          expect(en[key], `${key} missing from English`).toBeTruthy();
          expect(he[key], `${key} missing from Hebrew`).toBeTruthy();
        }
      }
    }
  });

  it('forgets everything between visits', () => {
    const { m, world, player } = start();
    const sewer = level.json.entries.find((e) => e.id === 'sewer')!;
    stand(m, world, player, sewer.spawn[0] + 3, sewer.spawn[1]);
    expect(obj(m, 'foothold', 'foothold.sewer').state).toBe('open');
    m.reset();
    // Somewhere out on the south plaza, well clear of every way in.
    stand(m, world, player, 70, 60);
    expect(obj(m, 'foothold', 'foothold.sewer').state).toBe('hidden');
  });
});
