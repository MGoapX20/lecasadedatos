import { expect, it } from 'vitest';
import { showHudMap } from '../src/minimap/visibility';

it('shows the embedded map only in active gameplay with the menu closed',()=>{
  for(const stage of ['round1','round2a','round2b']){
    expect(showHudMap(stage,false)).toBe(true);
    expect(showHudMap(stage,true)).toBe(false);
  }
  for(const stage of ['attract','brief1','r1result','brief2','aiThink','results','presenter'])
    expect(showHudMap(stage,false)).toBe(false);
});
