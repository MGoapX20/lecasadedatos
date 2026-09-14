import type { GameFlow } from '../game/flow';
import { lang } from '../ui/i18n';
import { createMapRenderer } from './render';
import { mapSnapshot } from './snapshot';
import { showHudMap } from './visibility';

/** Direct world view: no second game, iframe, session picker, or message delay. */
export function mountHudMinimap(flow: GameFlow, menuOpen: () => boolean) {
  const root=document.createElement('aside');
  root.id='hud-minimap';root.hidden=true;
  root.innerHTML='<div class="hud-map-heading"><span class="hud-map-title"></span><span class="hud-map-north" aria-hidden="true">N ↑</span></div><canvas></canvas><div class="hud-map-legend"><span class="map-attack"></span><span class="map-defense"></span></div>';
  document.getElementById('ui')!.append(root);
  const canvas=root.querySelector('canvas')!;
  const draw=createMapRenderer(canvas);
  let next=0,previousTick=-1,previousWorld=flow.world,previousLang='';
  const resize=new ResizeObserver(()=>{next=0;previousTick=-1;});resize.observe(canvas);
  window.addEventListener('pagehide',event=>{if(!event.persisted)resize.disconnect();});
  return { update(now:number){
    const visible=showHudMap(flow.state,menuOpen());
    if(root.hidden===visible){root.hidden=!visible;next=0;previousTick=-1;}
    if(!visible)return;
    const language=lang();
    if(language!==previousLang){
      const he=language==='he';
      root.setAttribute('aria-label',he?'מפת הבסיס':'Base minimap');
      canvas.setAttribute('aria-label',he?'מפת הבסיס בזמן אמת':'Live top-down map of the base');
      root.querySelector('.hud-map-title')!.textContent=he?'מפת הבסיס':'BASE MAP';
      root.querySelector('.map-attack')!.textContent=he?'תוקפים':'Attackers';
      root.querySelector('.map-defense')!.textContent=he?'מגינים':'Defenders';
      previousLang=language;
    }
    if(now<next)return;
    // Pausing preserves the last map; reset/admin edits still refresh periodically.
    if(flow.world.tick===previousTick&&flow.world===previousWorld&&now<next+400)return;
    next=now+100;previousTick=flow.world.tick;previousWorld=flow.world;
    draw(mapSnapshot(flow.world));
  }};
}
