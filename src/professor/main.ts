import './style.css';
import en from '../../strings/en.json';
import { DISCOVERY, PROTOCOL, SnapshotInbox, channelName } from '../companion/protocol';
import { advice, adviceKey } from './advice';
import { fitBoard } from '../companion/fit';
import { mountAgentBoard } from '../agent-views/board';
import { defenseStage } from '../agent-views/state';

const display=document.querySelector<HTMLElement>('#display')!;
const connection=document.querySelector<HTMLOutputElement>('#connection')!;
const select=document.querySelector<HTMLSelectElement>('#sessions')!;
const mapLink=document.querySelector<HTMLAnchorElement>('#map-link')!;
const agentHost=document.createElement('section');
agentHost.id='agent-board';agentHost.hidden=true;display.after(agentHost);
const agentBoard=mountAgentBoard(agentHost);
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const text=(key:string)=>(en as Record<string,string>)[key]??key;
let inbox:SnapshotInbox|null=null,bus:BroadcastChannel|null=null,offline=false,last='';
const discovery=new BroadcastChannel(DISCOVERY);
const sources=new Map<string,HTMLOptionElement>();
const paired=new URL(location.href).searchParams.get('game');

function connect(id:string){
  bus?.close();inbox=new SnapshotInbox(id);offline=false;last='';
  agentBoard.setSource(id);
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
  const defense=defenseStage(s?.state??'');
  agentBoard.setStage(s?.state??'');
  document.querySelector('#professor-shell')!.classList.toggle('defense',defense);
  document.querySelector('h1')!.textContent=defense?'AGENT VIEWS':'THE PROFESSOR';
  display.hidden=defense;
  connection.textContent=stale?'Waiting for game':s?.paused?'Paused':s?.suspended?'Game in background':s?.state==='round1'||defense?'Live':'Standby';
  connection.dataset.live=String(!stale&&(s?.state==='round1'||defense)&&!s?.paused&&!s?.suspended);
  if(defense)return;
  let html='';
  if(!s||s.state!=='round1'){
    html=`<section class="standby"><h2>Ready when you are.</h2><p>${s?'Start the attacker round to see your next move.':'Open the game and select its session above.'}</p></section>`;
  }else{
    const key=adviceKey(s),[title,,control]=advice[key]??advice.entry;
    const phases=s.professor?.phases??[];
    const active=phases.find(p=>p.active);
    const names={recon:'Recon',foothold:'Access',lateral:'Vault',exfil:'Extract'};
    const objectives=active?.objectives.filter(o=>o.state==='open')??[];
    html=`${stale?'<div class="notice">Connection lost · Reopen the game to reconnect.</div>':''}
      <ol class="progress" aria-label="Mission progress">${phases.map((phase,i)=>`<li class="${phase.active?'active':''} ${phase.done?'complete':''}" ${phase.active?'aria-current="step"':''}><span>${phase.done?'✓':`0${i+1}`}</span>${names[phase.id]}${phase.done?'<span class="sr-only"> complete</span>':''}</li>`).join('')}</ol>
      <section class="briefing"><article class="next"><p class="eyebrow">NEXT MOVE</p><h2>${esc(title)}</h2><p class="control">${esc(control)}</p>${s.security.alarm?'<p class="alarm">Alarm active · Keep clear of guards.</p>':''}</article>
      ${active?`<aside class="checklist"><div class="checklist-heading"><h2>This phase</h2><span>${active.objectives.filter(o=>o.state==='done').length} / ${active.objectives.length}</span></div><ul>${objectives.map(o=>`<li><span class="check" aria-hidden="true">○</span><span>${esc(text(o.labelKey))}</span>${o.note?`<strong>${esc(o.note)}</strong>`:''}</li>`).join('')}</ul>${!objectives.length?`<p class="empty">${active.objectives.some(o=>o.state==='hidden')?'Explore to discover an entrance.':'Objectives complete.'}</p>`:''}</aside>`:''}</section>`;
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
window.addEventListener('pagehide',e=>{if(!e.persisted){agentBoard.dispose();stopFitting();clearTimeout(chooseTimer);clearInterval(timer);bus?.close();discovery.close();}});
render();
const stopFitting=fitBoard(document.querySelector<HTMLElement>('#professor-viewport')!,document.querySelector<HTMLElement>('#professor-shell')!);
