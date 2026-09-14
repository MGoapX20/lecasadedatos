import './style.css';
import en from '../../strings/en.json';
import { DISCOVERY, PROTOCOL, SnapshotInbox, channelName } from '../companion/protocol';
import { advice, adviceKey } from './advice';

const display=document.querySelector<HTMLElement>('#display')!;
const connection=document.querySelector<HTMLOutputElement>('#connection')!;
const select=document.querySelector<HTMLSelectElement>('#sessions')!;
const mapLink=document.querySelector<HTMLAnchorElement>('#map-link')!;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const text=(key:string)=>(en as Record<string,string>)[key]??key;
let inbox:SnapshotInbox|null=null,bus:BroadcastChannel|null=null,offline=false,last='';
const discovery=new BroadcastChannel(DISCOVERY);
const sources=new Map<string,HTMLOptionElement>();
const paired=new URL(location.href).searchParams.get('game');

function connect(id:string){
  bus?.close();inbox=new SnapshotInbox(id);offline=false;last='';
  const url=new URL(location.href);url.searchParams.set('game',id);history.replaceState(null,'',url);
  mapLink.href=`minimap.html?game=${encodeURIComponent(id)}`;
  bus=new BroadcastChannel(channelName(id));
  bus.onmessage=({data})=>{
    if(data?.type==='offline'&&data.source===id)offline=true;
    if(data?.type==='snapshot'&&inbox?.accept(data.snapshot,performance.now()))offline=false;
    render();
  };
  bus.postMessage({type:'hello',v:PROTOCOL});render();
}
function render(){
  const s=inbox?.latest,stale=!inbox||inbox.stale(performance.now())||offline;
  connection.textContent=stale?'Waiting for game':s?.paused?'Game paused':s?.suspended?'Game in background':s?.state==='round1'?'Live · Attacker round':'Ready · Attacker round only';
  connection.dataset.live=String(!stale&&s?.state==='round1'&&!s.paused&&!s.suspended);
  let html='';
  if(!s||s.state!=='round1'){
    html=`<section class="standby"><div class="seal">P</div><p class="eyebrow">BRIEFING ROOM</p><h2>${s?'Waiting for the next mission.':'Your next move starts here.'}</h2><p>Start the first attacker round in the game. I’ll follow your progress, track your objectives, and suggest what to do next.</p><div class="standby-steps"><span>01 &nbsp; Reconnaissance</span><span>02 &nbsp; Initial access</span><span>03 &nbsp; Lateral movement</span><span>04 &nbsp; Data extraction</span></div><small>${s?'The Professor is on standby outside the attacker round.':'Open or reload the game in another tab, then select its session above.'}</small></section>`;
  }else{
    const key=adviceKey(s),[title,detail,control]=advice[key]??advice.entry;
    const phases=s.professor?.phases??[];
    const active=phases.find(p=>p.active);
    const completed=phases.filter(p=>p.done).length;
    const status=[['Uniform',s.player?.disguised?'Equipped':'Not equipped'],['Cameras',s.security.camerasDown?'Offline':'Online'],['Access card',s.player?.card?'Collected':'Not collected'],['Documents',`${s.exfil.loads} / ${s.exfil.needed} delivered`]];
    html=`${stale?'<div class="notice">Connection lost — showing the last received mission. Reopen the game to resume live advice.</div>':s.paused||s.suspended?'<div class="notice">The game is paused or in the background. Advice reflects its last reported state.</div>':''}
      <section class="briefing"><article class="next"><div class="eyebrow">NEXT MOVE <span>→</span></div><h2>${esc(title)}</h2><p>${esc(detail)}</p><div class="control">${esc(control)}</div><div class="signature">— The Professor</div></article>
      <aside class="situation"><p class="eyebrow">CURRENT OPERATION</p><h2>${esc(active?text(active.cyberKey):'Extraction')}</h2><p class="operator">OPERATIVE <b>${esc(s.operator)}</b></p><dl>${status.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${s.security.alarm?'<p class="alarm">Alarm active — your disguise will not protect you.</p>':''}</aside></section>
      <section class="missions"><div class="section-heading"><div><p class="eyebrow">THE PLAN</p><h2>Mission progress</h2></div><span>${completed} / 4 phases complete</span></div><div class="phase-grid">${phases.map((phase,i)=>`<article class="phase ${phase.active?'active':''} ${phase.done?'complete':''}"><div class="phase-top"><span>0${i+1}</span><b>${phase.done?'COMPLETE':phase.active?'IN PROGRESS':'UP NEXT'}</b></div><h3>${esc(text(phase.cyberKey))}</h3><p>${esc(text(phase.labelKey))}</p><ul>${phase.objectives.map(o=>`<li class="${o.state}"><span class="check">${o.state==='done'?'✓':o.state==='hidden'?'?':'○'}</span><div>${esc(o.state==='hidden'?'Undiscovered entrance':text(o.labelKey))}${o.note?` <strong>${esc(o.note)}</strong>`:''}${o.state!=='hidden'?`<small>${esc(text(o.cyberKey))}</small>`:''}</div></li>`).join('')}</ul></article>`).join('')}</div>${!phases.length?'<p>Reload the game to enable the detailed mission feed.</p>':''}</section>`;
  }
  if(html!==last){display.innerHTML=html;last=html;}
}
discovery.onmessage=({data})=>{
  if(data?.type!=='source'||typeof data.source!=='string'||typeof data.operator!=='string')return;
  let option=sources.get(data.source);
  if(!option){option=document.createElement('option');option.value=data.source;select.append(option);sources.set(data.source,option);}
  option.textContent=`${data.operator} · ${data.state} · ${data.source.slice(0,8)}`;
  if(inbox)select.value=inbox.source;
};
select.onchange=()=>{if(select.value)connect(select.value);};
if(paired){const option=document.createElement('option');option.value=paired;option.textContent=`Selected game · ${paired.slice(0,8)}`;select.append(option);sources.set(paired,option);select.value=paired;connect(paired);}
discovery.postMessage({type:'discover'});
// Allow all games to respond before automatically choosing a sole source.
const chooseTimer=window.setTimeout(()=>{if(!inbox&&sources.size===1){const id=sources.keys().next().value!;select.value=id;connect(id);}else if(!inbox&&sources.size>1){select.options[0].textContent='Choose a game session';}},800);
const timer=window.setInterval(()=>{discovery.postMessage({type:'discover'});if(!inbox&&sources.size===1){const id=sources.keys().next().value!;select.value=id;connect(id);}if(inbox?.stale(performance.now()))bus?.postMessage({type:'hello',v:PROTOCOL});render();},1000);
document.querySelector('#fullscreen')!.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{connection.textContent='Use your browser’s fullscreen control.';}});
window.addEventListener('pagehide',e=>{if(!e.persisted){clearTimeout(chooseTimer);clearInterval(timer);bus?.close();discovery.close();}});
render();
