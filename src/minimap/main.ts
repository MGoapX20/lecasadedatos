import { minimapChannel, type MapSnapshot } from './snapshot';
import { drawMapIcon } from './icons';

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const ctx = canvas.getContext('2d')!;
const ground = document.createElement('canvas');
const groundContext = ground.getContext('2d')!;
const select = document.querySelector<HTMLSelectElement>('#sessions')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const empty = document.querySelector<HTMLElement>('#empty')!;
const bus = new BroadcastChannel(minimapChannel());
const sessions = new Map<string, HTMLOptionElement>();
let selected = new URL(location.href).searchParams.get('game') ?? '';
let latest: MapSnapshot | null = null, received = 0, description = '';

function draw() {
  const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(rect.width*ratio); canvas.height = Math.round(rect.height*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,rect.width,rect.height);
  const m = latest; if (!m) return;
  const scale = Math.min((rect.width-16)/m.w,(rect.height-16)/m.h);
  if (scale <= 0) return;
  ctx.translate((rect.width-m.w*scale)/2,(rect.height-m.h*scale)/2);ctx.scale(scale,scale);
  const colors = [[52,70,80],[105,123,128],[212,221,224],[26,37,45]];
  ground.width=m.w;ground.height=m.h;
  const pixels=groundContext.createImageData(m.w,m.h);
  for(let i=0;i<m.cells.length;i++)pixels.data.set([...colors[m.cells[i]===3 ? (m.indoor[i] ? 1 : 0) : m.cells[i]],255],i*4);
  groundContext.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(ground,0,0);
  // Draw one simple footprint per prop. Keep structural walls and doorways visible.
  ctx.save();ctx.beginPath();
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++)if(m.cells[y*m.w+x]!==2)ctx.rect(x,y,1,1);
  ctx.clip();ctx.fillStyle='#1a252d';ctx.beginPath();
  for(const obstacle of m.obstacles)ctx.roundRect(obstacle.x,obstacle.y,obstacle.width,obstacle.height,.35);
  ctx.fill();ctx.restore();
  ctx.lineWidth=.3;
  const box=(r:readonly number[],fill:string)=>{ctx.fillStyle=fill;ctx.fillRect(r[0],r[1],r[2],r[3]);};
  const symbol=(x:number,y:number,text:string,color:string)=>{
    ctx.fillStyle='#101820';ctx.beginPath();ctx.arc(x,y,1.35,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=color;ctx.font='bold 2px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+.05);
  };
  ctx.strokeStyle='#c6a667';ctx.strokeRect(...m.vault);
  for(const d of m.doors)box(d.rect,d.open?'#69c796':'#ed7280');
  if(m.hole)box(m.hole.rect,m.hole.open?'#69c796':'#e3ba4e');
  for(const p of m.portals)for(const cell of [p.from,p.to]){
    const x=cell[0]+.5,y=cell[1]+.5;ctx.fillStyle='#152531';ctx.strokeStyle='#79a5d3';ctx.lineWidth=.4;
    ctx.beginPath();if(p.kind==='sewer')ctx.arc(x,y,1.25,0,Math.PI*2);else ctx.rect(x-1.25,y-1.25,2.5,2.5);ctx.fill();ctx.stroke();
  }
  for(const shop of m.shops){
    ctx.save();ctx.translate(shop.cell[0]+.5,shop.cell[1]+.5);ctx.rotate(-shop.rotation*Math.PI/180);
    ctx.fillStyle='#c6a667';ctx.strokeStyle='#101820';ctx.lineWidth=.35;
    ctx.fillRect(-shop.width/2,-shop.depth/2,shop.width,shop.depth);
    ctx.strokeRect(-shop.width/2,-shop.depth/2,shop.width,shop.depth);
    ctx.restore();
  }
  for(const cell of m.presses)symbol(cell[0]+.5,cell[1]+.5,'$','#c6a667');
  for(const k of m.keys)drawMapIcon(ctx,k.cell[0]+.5,k.cell[1]+.5,
    k.kind==='fuse'?'power':k.kind==='uniform'?'uniform':'key',k.used?'#667078':k.kind==='fuse'?'#59ced1':'#bb97ee');
  const actor=(x:number,y:number,angle:number,color:string,size=1,player=false)=>{
    ctx.save();ctx.translate(x,y);ctx.rotate(angle*Math.PI/180);ctx.fillStyle=color;ctx.strokeStyle=player?'#ffffff':'#101820';ctx.lineWidth=player ? .4 : .25;
    ctx.beginPath();ctx.moveTo(size*1.6,0);ctx.lineTo(-size,size);ctx.lineTo(-size*.5,0);ctx.lineTo(-size,-size);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  };
  const vehicle=(v:{x:number;y:number;facing:number},length:number,color:string,label:string)=>{
    ctx.save();ctx.translate(v.x,v.y);ctx.rotate(v.facing*Math.PI/180);ctx.fillStyle=color;ctx.strokeStyle='#111820';ctx.lineWidth=.4;
    ctx.fillRect(-length/2,-2.3,length,4.6);ctx.strokeRect(-length/2,-2.3,length,4.6);ctx.fillStyle='#14232d';ctx.fillRect(length/2-2,-1.8,1.2,3.6);ctx.restore();symbol(v.x,v.y,label,'#fff');
  };
  if(m.truck)vehicle(m.truck,14,m.riding?'#f04452':'#79a5d3',m.riding?'P':'T');
  if(m.van)vehicle(m.van,11.2,'#d4dde0','V');
  for(const c of m.cameras) {
    drawMapIcon(ctx,c.cell[0]+.5,c.cell[1]+.5,'camera',m.power?'#62aaff':'#667078',c.facing,!m.power);
  }
  for(const g of m.guards)actor(g.x,g.y,g.facing,'#62aaff');
  // Draw the larger, white-edged player last so nearby actors cannot cover it.
  for(const p of [...m.thieves].sort((a,b)=>Number(a.player)-Number(b.player)))
    actor(p.x,p.y,p.facing,p.player?'#f04452':'#ef6e78',p.player?1.5:.7,p.player);
}
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
