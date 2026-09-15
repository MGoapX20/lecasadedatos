import { expect, it } from 'vitest';
import { advice, adviceKey } from '../src/professor/advice';
import { SnapshotProjector } from '../src/companion/snapshot';
import { SimWorld } from '../src/sim/world';
import { MissionTracker } from '../src/game/missions';
import { GuidedWalkthrough } from '../src/game/walkthrough';
import { loadMint } from './helpers';
import type { ProjectionSource } from '../src/companion/snapshot';
import type { ThiefSnapshot } from '../src/companion/protocol';

function setup(){
  const world=new SimWorld(loadMint(),9);const player=world.spawnPlayer('front','Professor test');
  const missions=new MissionTracker();missions.update(world,world.level,player);
  const walkthrough=new GuidedWalkthrough();
  const flow={state:'round1',world,missions,paused:false,session:{visit:1,codename:'Test'},displayState:{elapsedMs:0},advisoryStep:walkthrough.update(world,world.level,missions)} as ProjectionSource;
  return {flow,project:new SnapshotProjector('test',()=>0)};
}
it('publishes the actual mission board and walkthrough advice without changing world state',()=>{
  const {flow,project}=setup();const tick=flow.world.tick;
  const snapshot=project.capture(flow,100,'en') as ThiefSnapshot;
  expect(snapshot.professor?.phases).toHaveLength(4);
  expect(adviceKey(snapshot)).toBe('circle');expect(flow.world.tick).toBe(tick);
  expect(snapshot.professor?.phases[0]).not.toBe(flow.missions.phases[0]);
});
it('prioritizes interactions, transit, and extraction over navigation advice',()=>{
  const {flow,project}=setup();const s=project.capture(flow,100,'en') as ThiefSnapshot;
  s.interaction={kind:'drill',progress:.4,heat:.7,jammed:false};expect(adviceKey(s)).toBe('drill');
  s.interaction=null;s.player!.hidden=true;expect(adviceKey(s)).toBe('transit');
  s.player!.hidden=false;s.professor!.guide='prepare';expect(adviceKey(s)).toBe('prepare');
  s.professor!.guide='garage';expect(adviceKey(s)).toBe('garage');
  s.professor!.guide='van';expect(adviceKey(s)).toBe('van');
  s.exfil.complete=true;expect(adviceKey(s)).toBe('complete');
  for(const id of ['circle','entry','prepare','uniform','fuse','card','vault','garage','ride','wall','load','van'])expect(advice[id]).toBeDefined();
});
it('does not publish mission details outside the attacker round',()=>{
  const {flow,project}=setup();
  for(const state of ['attract','brief1','r1result','brief2','round2a','aiThink','round2b','results'] as const){
    flow.state=state;const s=project.capture(flow,100,'en');expect(s).not.toHaveProperty('professor');expect(s).not.toHaveProperty('player');
  }
});
