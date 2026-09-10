import { describe, expect, it } from 'vitest';
import { GuidedWalkthrough } from '../src/game/walkthrough';
import { MissionTracker } from '../src/game/missions';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

function setup() {
  const level = loadMint();
  const world = new SimWorld(level, 9);
  const p = world.spawnPlayer('front', 'Tokyo');
  const guide = new GuidedWalkthrough(), missions = new MissionTracker();
  const read = () => { missions.update(world, level, p); return guide.update(world, level, missions); };
  const enter = (kind: 'vent' | 'sewer' | 'side' | 'dock' | 'front') => {
    if (kind === 'vent' || kind === 'sewer') missions.note({ kind:'portalExit', thief:p.id, portal:`p_${kind}` });
    if (kind === 'side') missions.note({ kind:'lockpickEnd', thief:p.id, door:level.doors.findIndex(d => d.id === 'd_side') });
    if (kind === 'dock') missions.note({ kind:'truckLeave', thief:p.id, inside:true });
    p.x = kind === 'dock' ? 73.5 : 48.5; p.y = kind === 'dock' ? 26.5 : 62.5;
  };
  return { level, world, p, guide, read, enter };
}

describe('advisory walkthrough', () => {
  it('switches to the wall immediately after walking through the vault door without Space', () => {
    const { level, world, p, read } = setup();
    world.guards = []; world.catchesEnabled = false;
    p.keys.add('k_manager'); world.setPlayerUniform(true); world.setPowerEnabled(false);
    p.x = 48.5; p.y = 42.5;
    expect(read()?.id).toBe('vault');
    world.setPlayerMove(0, -1);
    let entered = false;
    const events = [];
    for (let tick = 0; tick < 100; tick++) {
      world.step(); events.push(...world.drainEvents());
      if (p.y < 40) { entered = true; break; }
      expect(p.breached).toBe(false);
    }
    expect(entered).toBe(true);
    expect(p.breached).toBe(true);
    expect(p.retired).toBe(false);
    expect(p.printTicks).toBe(0);
    expect(events.some(event => event.kind === 'printStart')).toBe(false);
    expect(events.filter(event => event.kind === 'breach')).toHaveLength(1);
    expect(read()?.id).toBe('wall');
    expect(read()?.targets[0].mark).toEqual({ kind: 'breachWall' });
    expect(read()?.targets[0].cell).toEqual(level.json.exfil!.stand);
    world.setPlayerMove(0, 0); world.step();
    expect(world.drainEvents().some(event => event.kind === 'breach')).toBe(false);
  });
  it('starts with accessible right and left waypoints, then offers every entrance', () => {
    const { level, p, read, guide } = setup();
    for (const id of ['right','left']) {
      const step = read()!; expect(step.id).toBe(id);
      const [x,y] = step.targets[0].cell;
      expect(level.walk[y * level.w + x]).toBe(1);
      p.x=x+.5; p.y=y+.5;
    }
    expect(read()?.targets).toHaveLength(5);
    guide.reset(); p.x=48.5; p.y=73.5;
    expect(read()?.id).toBe('right');
  });
  it('allows entering early and chooses power first for the vent', () => {
    const { enter, read, world } = setup(); enter('vent');
    expect(read()?.id).toBe('fuse');
    world.setPowerEnabled(false);
    expect(read()?.id).toBe('uniform');
  });
  it('guides supplier arrivals through the inner garage door', () => {
    const { enter, read, world, level } = setup(); enter('dock');
    expect(read()?.id).toBe('garage');
    world.doorPickedOpen[level.doors.findIndex(d => d.id === 'd_dock_in')] = 1;
    expect(read()?.id).toBe('prepare');
    expect(read()?.targets).toHaveLength(2);
  });
  it.each(['front', 'side', 'dock'] as const)('offers both preparation targets through %s, completing either first', entry => {
    for (const first of ['uniform', 'fuse']) {
      const { enter, read, world, level } = setup(); enter(entry);
      world.doorPickedOpen[level.doors.findIndex(d => d.id === 'd_dock_in')] = 1;
      const targets = read()!.targets;
      expect(targets.map(target => target.mark?.kind === 'key' ? level.json.keycards[target.mark.index].kind : null))
        .toEqual(['uniform', 'fuse']);
      if (first === 'uniform') world.setPlayerUniform(true); else world.setPowerEnabled(false);
      expect(read()?.id).toBe(first === 'uniform' ? 'fuse' : 'uniform');
      expect(read()?.targets).toHaveLength(1);
      world.setPlayerUniform(true); world.setPowerEnabled(false);
      expect(read()?.id).toBe('card');
    }
  });
  it('keeps the sewer sequence uniform then power', () => {
    const { enter, read, world } = setup(); enter('sewer');
    expect(read()?.id).toBe('uniform'); expect(read()?.targets).toHaveLength(1);
    world.setPlayerUniform(true); expect(read()?.id).toBe('fuse');
  });
  it('skips out-of-order preparation and already-held cards', () => {
    const { enter, read, world, p } = setup(); enter('front');
    world.setPowerEnabled(false); p.keys.add('k_manager');
    expect(read()?.id).toBe('uniform');
    world.setPlayerUniform(true);
    expect(read()?.id).toBe('vault');
  });
  it('skips optional preparation on reaching the vault and repeats delivery until complete', () => {
    const { p, world, read } = setup(); p.breached=true;
    expect(read()?.id).toBe('wall'); world.holeOpen=true;
    for (let i=0;i<world.loadsNeeded;i++) {
      expect(read()?.id).toBe('load'); p.carrying=true;
      expect(read()?.id).toBe('van'); p.carrying=false; world.loadsOut++;
    }
    world.exfilDone=true; expect(read()).toBeNull();
  });
});
