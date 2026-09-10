import { describe, expect, it } from 'vitest';
import { DEFAULT_DRILL, DrillGame } from '../src/sim/drill';
import { VAN_ARRIVE_TICKS, vanPoseAt, type ExfilDef } from '../src/sim/exfil';
import { SimWorld, type Thief } from '../src/sim/world';
import { MissionTracker } from '../src/game/missions';
import { loadMint } from './helpers';

const level = loadMint();
const def = level.json.exfil as ExfilDef;

/**
 * A player standing in the vault with the money already printed. The guards are
 * sent home unless a test wants them: what is under test here is the drill and
 * the run to the van, not whether the vault hall is patrolled.
 */
function inTheVault(guards = false): { world: SimWorld; player: Thief } {
  const world = new SimWorld(level, 5);
  if (!guards) world.guards = [];
  const player = world.spawnPlayer('front', 'Tokyo');
  player.graceTicks = 0;
  player.breached = true;
  player.x = level.json.vault.cell[0] + 0.5;
  player.y = level.json.vault.cell[1] + 0.5;
  return { world, player };
}

function standAt(player: Thief, cell: readonly number[]): void {
  player.x = cell[0] + 0.5;
  player.y = cell[1] + 0.5;
}

/** Work the drill the way a competent player would: burst, cool, burst. */
function drillThrough(world: SimWorld, limit = 2000): number {
  let ticks = 0;
  while (!world.holeOpen && ticks++ < limit) {
    const g = world.activeDrill;
    world.setDrilling(!g || g.heat < 0.8);
    world.step();
  }
  return ticks;
}

describe('the drill', () => {
  it('gets through only with the trigger actually held', () => {
    const g = new DrillGame();
    for (let i = 0; i < 400; i++) g.step(false);
    expect(g.progress).toBe(0);
    expect(g.complete).toBe(false);
  });

  it('overheats and jams if it is never let go of', () => {
    const g = new DrillGame();
    let jam = false;
    for (let i = 0; i < 200 && !jam; i++) jam = g.step(true) === 'jam';
    expect(jam, 'holding the trigger down forever has to cost something').toBe(true);
    expect(g.jammed).toBe(true);
    expect(g.complete, 'and it must not have got through in the meantime').toBe(false);
  });

  it('rewards short bursts: patience beats brute force', () => {
    const patient = new DrillGame();
    let patientTicks = 0;
    while (!patient.complete && patientTicks++ < 4000) {
      patient.step(patient.heat < 0.8);
    }
    const greedy = new DrillGame();
    let greedyTicks = 0;
    while (!greedy.complete && greedyTicks++ < 4000) greedy.step(true);
    expect(patient.complete && greedy.complete).toBe(true);
    expect(patientTicks, 'the careful way has to be the faster way').toBeLessThan(greedyTicks);
  });

  it('finishes in a length of time the round can afford', () => {
    const g = new DrillGame();
    let ticks = 0;
    while (!g.complete && ticks++ < 4000) g.step(g.heat < 0.8);
    const seconds = ticks / level.json.rules.tickHz;
    expect(seconds).toBeGreaterThan(6);
    expect(seconds, 'a minute of drilling would eat the round').toBeLessThan(30);
  });

  it('cools while it is jammed, so the wait is never wasted', () => {
    const g = new DrillGame(DEFAULT_DRILL);
    while (!g.jammed) g.step(true);
    const hot = g.heat;
    for (let i = 0; i < 10; i++) g.step(true);
    expect(g.heat).toBeLessThan(hot);
  });
});

describe('the van', () => {
  it('is authored on the level, outside the wall it is waiting at', () => {
    expect(def, 'the level needs an exfil route').toBeTruthy();
    const [, hy] = def.hole;
    expect(def.van[1], 'the van parks on the far side of the wall').toBeLessThan(hy);
    expect(def.stand[1], 'and the thief works it from inside').toBeGreaterThan(hy);
  });

  it('drives up rather than appearing, and stops where it was sent', () => {
    const start = vanPoseAt(def, 0);
    const half = vanPoseAt(def, VAN_ARRIVE_TICKS / 2);
    const end = vanPoseAt(def, VAN_ARRIVE_TICKS);
    expect(start.parked).toBe(false);
    expect(half.parked).toBe(false);
    expect(Math.hypot(half.x - start.x, half.y - start.y)).toBeGreaterThan(1);
    expect(end.parked).toBe(true);
    expect(Math.hypot(end.x - (def.van[0] + 0.5), end.y - (def.van[1] + 0.5))).toBeLessThan
      (0.01);
  });
});

describe('getting the money out', () => {
  it('will not let anyone drill from outside before entering the vault', () => {
    const world = new SimWorld(level, 5);
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0;
    standAt(player, [def.stand[0], 8]);
    expect(world.atWall(player), 'the vault has not been entered').toBe(false);
    world.step();
    expect(world.activeDrill).toBeNull();
  });

  it('opens the panel by standing at the wall, and closes it by walking off', () => {
    const { world, player } = inTheVault();
    standAt(player, def.stand);
    world.step();
    expect(world.activeDrill, 'the wall opens its own panel').not.toBeNull();
    standAt(player, level.json.vault.cell);
    world.step();
    expect(world.activeDrill).toBeNull();
  });

  it('makes a noise the guards come to when the bit jams', () => {
    const { world, player } = inTheVault();
    // Guards are away; the event itself is what is under test.
    standAt(player, def.stand);
    let heard = false;
    for (let i = 0; i < 400 && !heard; i++) {
      world.setDrilling(true);
      world.step();
      heard = world.drainEvents().some((e) => e.kind === 'drillJam');
    }
    expect(heard, 'a screaming bit has to be a mistake with a consequence').toBe(true);
  });

  it('opens a way through the wall that was not on the map', () => {
    const { world, player } = inTheVault();
    standAt(player, def.stand);
    const [hx, hy] = def.hole;
    const gap = hy * level.w + hx;
    expect(level.walk[gap], 'the wall is solid to begin with').toBeFalsy();
    expect(world.passable(gap, player)).toBe(false);
    drillThrough(world);
    expect(world.holeOpen).toBe(true);
    expect(world.passable(gap, player), 'and open afterwards').toBe(true);
    expect(level.walk[gap], 'without editing the level itself').toBeFalsy();
  });

  it('will not let the money into a van that has not arrived', () => {
    const { world, player } = inTheVault();
    standAt(player, def.stand);
    drillThrough(world);
    standAt(player, def.presses[0]);
    expect(world.takeLoad()).toBe(true);
    standAt(player, def.van);
    expect(world.van.parked, 'it is still driving').toBe(false);
    expect(world.dropLoad()).toBe(false);
    for (let i = 0; i < VAN_ARRIVE_TICKS + 2; i++) world.step();
    expect(world.van.parked).toBe(true);
    expect(world.dropLoad()).toBe(true);
    expect(world.loadsOut).toBe(1);
  });

  it('can be picked up from somewhere a player can actually stand', () => {
    // The presses block a two-metre radius — four cells — so nobody ever gets
    // near their centre. Measuring "at the press" from the centre with a tight
    // reach made the money impossible to lift, and every test that teleported
    // the player onto the press cell missed it.
    const { world, player } = inTheVault();
    for (const c of def.presses) {
      let best = Infinity;
      let bestCell = -1;
      for (let i = 0; i < level.cellCount; i++) {
        if (!world.passable(i, player)) continue;
        const d = Math.hypot((i % level.w) + 0.5 - (c[0] + 0.5), ((i / level.w) | 0) + 0.5 - (c[1] + 0.5));
        if (d < best) {
          best = d;
          bestCell = i;
        }
      }
      player.carrying = false;
      player.x = (bestCell % level.w) + 0.5;
      player.y = ((bestCell / level.w) | 0) + 0.5;
      expect(world.pressInReach(player), `press ${c} is out of reach from ${best.toFixed(1)} cells`).toBeTruthy();
      expect(world.takeLoad(), `press ${c} gives up nothing`).toBe(true);
    }
  });

  it('is not in reach from the wall or the van, which have their own key', () => {
    const { world, player } = inTheVault();
    standAt(player, def.stand);
    expect(world.pressInReach(player), 'SPACE at the wall is for the drill').toBeNull();
    standAt(player, def.van);
    expect(world.pressInReach(player), 'and at the van it is for unloading').toBeNull();
  });

  it('carries one load at a time', () => {
    const { world, player } = inTheVault();
    standAt(player, def.presses[0]);
    expect(world.takeLoad()).toBe(true);
    expect(world.takeLoad(), 'both arms are full').toBe(false);
  });

  it('is not finished until every load is in the van', () => {
    const { world, player } = inTheVault();
    standAt(player, def.stand);
    drillThrough(world);
    for (let i = 0; i < VAN_ARRIVE_TICKS + 2; i++) world.step();
    for (let n = 0; n < def.loads; n++) {
      standAt(player, def.presses[n % def.presses.length]);
      expect(world.takeLoad(), `load ${n}`).toBe(true);
      standAt(player, def.van);
      expect(world.dropLoad(), `drop ${n}`).toBe(true);
      expect(world.exfilDone).toBe(n === def.loads - 1);
    }
    expect(world.loadsOut).toBe(def.loads);
  });

  it('leaves the thief catchable while he is carrying it', () => {
    // Reaching the vault retires a plan follower. It must not retire the
    // player, or the walk to the van would be a cutscene.
    const { player } = inTheVault();
    expect(player.breached).toBe(true);
    expect(player.retired, 'the round is not over for him').toBe(false);
  });

  it('keeps the hole he has already made when a guard chases him off', () => {
    const { world, player } = inTheVault();
    standAt(player, def.stand);
    for (let i = 0; i < 40; i++) {
      world.setDrilling(true);
      world.step();
    }
    const made = world.activeDrill!.progress;
    expect(made).toBeGreaterThan(0);
    standAt(player, level.json.vault.cell);
    world.step();
    expect(world.activeDrill, 'the panel closes when he walks off').toBeNull();
    standAt(player, def.stand);
    world.step();
    expect(world.activeDrill!.progress, 'but the hole is still there').toBeGreaterThanOrEqual(made);
  });

  it('puts the money on the floor when he is caught with it', () => {
    const { world, player } = inTheVault(true);
    standAt(player, def.presses[0]);
    world.takeLoad();
    expect(player.carrying).toBe(true);
    const guard = world.guards[0];
    guard.present = true;
    guard.x = player.x;
    guard.y = player.y;
    guard.state = 'chase';
    for (let i = 0; i < 60 && player.carrying; i++) {
      guard.x = player.x;
      guard.y = player.y;
      guard.facing = player.facing;
      world.step();
    }
    expect(player.carrying, 'he drops it').toBe(false);
    expect(world.loadsOut, 'but keeps what already reached the van').toBe(0);
  });

  it('puts the wall back for the next visitor', () => {
    const { world, player } = inTheVault();
    standAt(player, def.stand);
    drillThrough(world);
    const [hx, hy] = def.hole;
    world.resetExfil();
    expect(world.holeOpen).toBe(false);
    expect(world.loadsOut).toBe(0);
    expect(world.passable(hy * level.w + hx, player)).toBe(false);
  });
});

describe('the exfiltration section of the mission board', () => {
  it('is on the board from the start, and takes over in the vault', () => {
    const world = new SimWorld(level, 5);
    const player = world.spawnPlayer('front', 'Tokyo');
    player.graceTicks = 0;
    const m = new MissionTracker();
    m.reset();
    m.update(world, level, player);
    const exfil = () => m.phases.find((p) => p.id === 'exfil')!;
    expect(exfil(), 'the visitor should see the whole arc from the first frame').toBeTruthy();
    expect(exfil().active, 'but it is not what he is doing yet').toBe(false);

    player.x = level.json.vault.cell[0] + 0.5;
    player.y = level.json.vault.cell[1] + 0.5;
    m.update(world, level, player);
    expect(exfil().active, 'standing in the vault is what starts it').toBe(true);
    expect(exfil().done).toBe(false);
  });

  it('outlines the step the thief is actually on', () => {
    const { world, player } = inTheVault();
    const m = new MissionTracker();
    m.reset();
    player.x = level.json.vault.cell[0] + 0.5;
    player.y = level.json.vault.cell[1] + 0.5;
    m.update(world, level, player);
    const kinds = () => m.activeMarks.map((mk) => mk.kind);
    expect(kinds(), 'the wall, first').toContain('breachWall');

    standAt(player, def.stand);
    drillThrough(world);
    for (let i = 0; i < VAN_ARRIVE_TICKS + 2; i++) world.step();
    m.update(world, level, player);
    expect(kinds(), 'the wall is down').not.toContain('breachWall');
    expect(kinds(), 'empty-handed, the money').toContain('press');

    standAt(player, def.presses[0]);
    world.takeLoad();
    m.update(world, level, player);
    expect(kinds(), 'carrying, the van').toContain('van');
    expect(kinds(), 'and not a press he has no hands for').not.toContain('press');
  });

  it('ticks its lines off as the money moves', () => {
    const { world, player } = inTheVault();
    const m = new MissionTracker();
    m.reset();
    m.update(world, level, player);
    const line = (id: string) =>
      m.phases.find((p) => p.id === 'exfil')!.objectives.find((o) => o.id === id)!;
    expect(line('exfil.hole').state).toBe('open');

    standAt(player, def.stand);
    drillThrough(world);
    for (let i = 0; i < VAN_ARRIVE_TICKS + 2; i++) world.step();
    player.x = level.json.vault.cell[0] + 0.5;
    player.y = level.json.vault.cell[1] + 0.5;
    m.update(world, level, player);
    expect(line('exfil.hole').state).toBe('done');
    expect(line('exfil.van').state).toBe('done');
    expect(line('exfil.load').note).toBe(`0/${def.loads}`);

    for (let n = 0; n < def.loads; n++) {
      standAt(player, def.presses[0]);
      world.takeLoad();
      standAt(player, def.van);
      world.dropLoad();
    }
    player.x = level.json.vault.cell[0] + 0.5;
    player.y = level.json.vault.cell[1] + 0.5;
    m.update(world, level, player);
    expect(line('exfil.load').state).toBe('done');
    expect(m.phases.find((p) => p.id === 'exfil')!.done).toBe(true);
  });
});

describe('the swarm getting it out', () => {
  it('has a way out to walk, from the vault to the van', () => {
    const world = new SimWorld(level, 5);
    const route = world.exfilRoute;
    expect(route, 'the wall is shut, but the route out is planned through it').toBeTruthy();
    const last = route![route!.length - 1];
    expect(Math.abs((last % level.w) - def.van[0])).toBeLessThan(2);
    expect(Math.abs(((last / level.w) | 0) - def.van[1])).toBeLessThan(2);
  });

  it('walks a breached agent out through the wall and into the van', () => {
    const world = new SimWorld(level, 5);
    world.guards = [];
    // Stand an agent in the vault as if his plan had just finished there.
    const t = world.spawnPlayer('front', 'Nairobi');
    t.kind = 'plan';
    t.graceTicks = 0;
    t.breached = true;
    t.retired = true;
    t.carrying = true;
    t.exfilIdx = 0;
    t.x = level.json.vault.cell[0] + 0.5;
    t.y = level.json.vault.cell[1] + 0.5;
    let delivered = false;
    for (let i = 0; i < 600 && !delivered; i++) {
      world.step();
      delivered = world.drainEvents().some((e) => e.kind === 'loadDelivered');
    }
    expect(world.holeOpen, 'he opens the wall on the way past it').toBe(true);
    expect(delivered, 'and the money reaches the van').toBe(true);
    expect(world.loadsOut).toBe(1);
    expect(t.active, 'then he is gone').toBe(false);
    expect(t.carrying).toBe(false);
  });

  it('leaves the guards to the agents still trying to get in', () => {
    // A breached agent is already on the board. Leaving him catchable pulls
    // guards off the contest the round is actually about, and cost five
    // breaches when it was tried.
    const world = new SimWorld(level, 5);
    const t = world.spawnPlayer('front', 'Berlin');
    t.kind = 'plan';
    t.breached = true;
    t.retired = true;
    t.carrying = true;
    t.exfilIdx = 0;
    t.graceTicks = 0;
    const g = world.guards[0];
    g.present = true;
    for (let i = 0; i < 30; i++) {
      g.x = t.x;
      g.y = t.y;
      g.facing = t.facing;
      world.step();
    }
    expect(t.caught, 'a guard cannot take a man who has already breached').toBe(false);
  });
});
