import { minimapChannel, type MapSnapshot } from './snapshot';
import { createMapRenderer } from './render';

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const select = document.querySelector<HTMLSelectElement>('#sessions')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const empty = document.querySelector<HTMLElement>('#empty')!;
const bus = new BroadcastChannel(minimapChannel());
const sessions = new Map<string, HTMLOptionElement>();
let selected = new URL(location.href).searchParams.get('game') ?? '';
let latest: MapSnapshot | null = null, received = 0, description = '';

const renderMap = createMapRenderer(canvas);
const draw = () => renderMap(latest);
function watch() { if(selected)bus.postMessage({type:'watch',id:selected}); }
function choose(id:string) {
  selected=id; latest=null;received=0;empty.hidden=false;draw();
  const url=new URL(location.href);url.searchParams.set('game',id);history.replaceState(null,'',url);watch();
}
select.onchange=()=>choose(select.value);
bus.onmessage=({data})=>{
  if(!data||typeof data.id!=='string')return;
  if(data.type==='source'){
    if(!sessions.has(data.id)){
      const option=document.createElement('option');option.value=data.id;select.appendChild(option);sessions.set(data.id,option);
    }
    sessions.get(data.id)!.textContent=`${String(data.stage)} · ${data.id.slice(0,8)}`;
    if(!selected){select.querySelector('option[value=""]')?.remove();choose(data.id);}
    select.value=selected;return;
  }
  if(data.type!=='map'||data.id!==selected||!data.map)return;
  const m=data.map as MapSnapshot;
  if(!Number.isInteger(m.w)||!Number.isInteger(m.h)||m.w<=0||m.h<=0||m.w>512||m.h>512||m.cells?.length!==m.w*m.h)return;
  latest=m;received=Date.now();empty.hidden=true;
  description=`${data.suspended?'Background game':data.paused?'Paused':'Live'} · ${String(data.stage)} · Cameras ${m.power?'on':'off'}`;
  status.textContent=description;draw();
};
const timer=window.setInterval(()=>{
  bus.postMessage({type:'discover'});watch();
  status.textContent=received&&Date.now()-received<3500?description:selected?'Waiting for selected game — last view retained':'Waiting for a game…';
},1000);
bus.postMessage({type:'discover'});watch();
new ResizeObserver(draw).observe(canvas);
window.addEventListener('pagehide',event=>{if(!event.persisted){clearInterval(timer);bus.close();}});
