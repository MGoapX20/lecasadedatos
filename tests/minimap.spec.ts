import { describe, expect, it } from 'vitest';
import { mapSnapshot } from '../src/minimap/snapshot';
import { SimWorld } from '../src/sim/world';
import { loadMint } from './helpers';

describe('live minimap snapshots', () => {
  it('uses the complete current walk grid and omits decorative props and truck portal grates', () => {
    const level=loadMint(), world=new SimWorld(level,9), map=mapSnapshot(world);
    expect(map.cells.length).toBe(level.w*level.h);
    for(let i=0;i<map.cells.length;i++) expect(map.cells[i]<2).toBe(!!world.walkNow[i]);
    expect(map.portals).toHaveLength(2);
    expect(map.shops).toHaveLength(level.json.props.filter(p=>p.kind==='store').length);
    expect(map).not.toHaveProperty('lamps');
    expect(map).not.toHaveProperty('decorations');
  });
  it('follows pickups, power, doors, characters and truck positions', () => {
    const world=new SimWorld(loadMint(),9), p=world.spawnPlayer('front','Map test');
    const before=mapSnapshot(world);
    world.setPlayerUniform(true);world.setPowerEnabled(false);world.doorPickedOpen[0]=1;
    p.x+=2;world.truck.x+=3;
    const after=mapSnapshot(world);
    expect(before.keys.find(k=>k.kind==='uniform')?.used).toBe(false);
    expect(after.keys.find(k=>k.kind==='uniform')?.used).toBe(true);
    expect(after.keys.find(k=>k.kind==='fuse')?.used).toBe(true);
    world.setPlayerUniform(false);world.setPowerEnabled(true);
    expect(mapSnapshot(world).keys.filter(k=>k.kind!=='card').every(k=>!k.used)).toBe(true);
    expect(after.power).toBe(false);expect(after.doors[0].open).toBe(true);
    expect(after.thieves[0].x).toBe(before.thieves[0].x+2);
    expect(after.truck!.x).toBe(before.truck!.x+3);
    world.playerInTruck=true;p.hidden=true;
    expect(mapSnapshot(world).thieves).toHaveLength(0);
    expect(mapSnapshot(world).riding).toBe(true);
  });
  it('shows the real drilled opening and arriving van', () => {
    const level=loadMint(),world=new SimWorld(level,9),p=world.spawnPlayer('front','Map test');
    world.catchesEnabled=false;world.guards=[];
    const def=world.exfil!;
    p.x=def.stand[0]+.5;p.y=def.stand[1]+.5;
    expect(mapSnapshot(world).van).toBeNull();
    for(let i=0;i<2000&&!world.holeOpen;i++){
      world.setDrilling(!world.activeDrill||world.activeDrill.heat<.8);world.step();
    }
    const map=mapSnapshot(world);
    expect(map.hole?.open).toBe(true);expect(map.van).not.toBeNull();
    const [x,y,w,h]=def.hole;
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)expect(map.cells[yy*level.w+xx]).toBeLessThan(2);
  });
});
