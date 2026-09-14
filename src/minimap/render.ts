import type { MapSnapshot } from './snapshot';
import { drawMapIcon } from './icons';

/** Shared renderer for the standalone map and the in-game HUD. */
export function createMapRenderer(canvas: HTMLCanvasElement, { hud = false } = {}) {
  const ctx = canvas.getContext('2d')!;
  const ground = document.createElement('canvas');
  const groundContext = ground.getContext('2d')!;
function draw(m: MapSnapshot | null) {
  const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(rect.width*ratio); canvas.height = Math.round(rect.height*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,rect.width,rect.height);
  if (!m) return;
  const padding = hud ? 4 : 16;
  const scale = Math.min((rect.width-padding)/m.w,(rect.height-padding)/m.h);
  if (scale <= 0) return;
  ctx.translate((rect.width-m.w*scale)/2,(rect.height-m.h*scale)/2);ctx.scale(scale,scale);
  const colors = hud ? [[22,28,36],[54,64,74],[220,227,235],[13,18,24]]
    : [[52,70,80],[105,123,128],[212,221,224],[26,37,45]];
  ground.width=m.w;ground.height=m.h;
  const pixels=groundContext.createImageData(m.w,m.h);
  for(let i=0;i<m.cells.length;i++)pixels.data.set([...colors[m.cells[i]===3 ? (m.indoor[i] ? 1 : 0) : m.cells[i]],255],i*4);
  groundContext.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(ground,0,0);
  // Draw one simple footprint per prop. Keep structural walls and doorways visible.
  ctx.save();ctx.beginPath();
  for(let y=0;y<m.h;y++)for(let x=0;x<m.w;x++)if(m.cells[y*m.w+x]!==2)ctx.rect(x,y,1,1);
  ctx.clip();ctx.fillStyle='#1a252d';ctx.beginPath();
  for(const obstacle of m.obstacles){
    ctx.save();ctx.translate(obstacle.x,obstacle.y);ctx.rotate(-obstacle.rotation*Math.PI/180);
    ctx.rect(-obstacle.width/2,-obstacle.height/2,obstacle.width,obstacle.height);ctx.restore();
  }
  ctx.fill();ctx.restore();
  ctx.lineWidth=.3;
  const box=(r:readonly number[],fill:string)=>{ctx.fillStyle=fill;ctx.fillRect(r[0],r[1],r[2],r[3]);};
  const symbol=(x:number,y:number,text:string,color:string)=>{
    ctx.fillStyle='#101820';ctx.beginPath();ctx.arc(x,y,1.35,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=color;ctx.font='bold 2px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+.05);
  };
  if(!hud){ctx.strokeStyle='#c6a667';ctx.strokeRect(...m.vault);}
  for(const d of m.doors)box(d.rect,d.open?'#69c796':'#ed7280');
  if(m.hole)box(m.hole.rect,m.hole.open?'#69c796':'#e3ba4e');
  for(const p of m.portals)for(const cell of [p.from,p.to]){
    const x=cell[0]+.5,y=cell[1]+.5;ctx.fillStyle='#152531';ctx.strokeStyle='#79a5d3';ctx.lineWidth=.4;
    ctx.beginPath();if(p.kind==='sewer')ctx.arc(x,y,1.25,0,Math.PI*2);else ctx.rect(x-1.25,y-1.25,2.5,2.5);ctx.fill();ctx.stroke();
  }
  for(const shop of hud ? [] : m.shops){
    ctx.save();ctx.translate(shop.cell[0]+.5,shop.cell[1]+.5);ctx.rotate(-shop.rotation*Math.PI/180);
    ctx.fillStyle='#c6a667';ctx.strokeStyle='#101820';ctx.lineWidth=.35;
    ctx.fillRect(-shop.width/2,-shop.depth/2,shop.width,shop.depth);
    ctx.strokeRect(-shop.width/2,-shop.depth/2,shop.width,shop.depth);
    ctx.restore();
  }
  const icon: typeof drawMapIcon = (context,x,y,...args) => {
    context.save();context.translate(x,y);
    const size=hud ? Math.max(1.35,3.5/scale) : 1;
    context.scale(size,size);drawMapIcon(context,0,0,...args);context.restore();
  };
  for(const cell of !hud || m.hole?.open ? m.presses : [])icon(ctx,cell[0]+.5,cell[1]+.5,'document','#e7edcf');
  for(const k of m.keys.filter(k=>!hud||!k.used))icon(ctx,k.cell[0]+.5,k.cell[1]+.5,
    k.kind==='fuse'?'power':k.kind==='uniform'?'uniform':'key',k.used?'#667078':k.kind==='fuse'?'#59ced1':'#bb97ee');
  const actor=(x:number,y:number,angle:number,color:string,size=1,player=false)=>{
    if(hud)size*=player?1.5:1.2;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle*Math.PI/180);ctx.fillStyle=color;ctx.strokeStyle=player?'#ffffff':'#101820';ctx.lineWidth=player ? .4 : .25;
    ctx.beginPath();ctx.moveTo(size*1.6,0);ctx.lineTo(-size,size);ctx.lineTo(-size*.5,0);ctx.lineTo(-size,-size);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  };
  const vehicle=(v:{x:number;y:number;facing:number},length:number,color:string,label:string)=>{
    ctx.save();ctx.translate(v.x,v.y);ctx.rotate(v.facing*Math.PI/180);ctx.fillStyle=color;ctx.strokeStyle='#111820';ctx.lineWidth=.4;
    ctx.fillRect(-length/2,-2.3,length,4.6);ctx.strokeRect(-length/2,-2.3,length,4.6);ctx.fillStyle='#14232d';ctx.fillRect(length/2-2,-1.8,1.2,3.6);ctx.restore();if(!hud)symbol(v.x,v.y,label,'#fff');
  };
  if(m.truck)vehicle(m.truck,14,m.riding?'#f04452':'#79a5d3',m.riding?'P':'T');
  if(m.van)vehicle(m.van,11.2,'#d4dde0','V');
  for(const c of hud && !m.power ? [] : m.cameras) {
    icon(ctx,c.cell[0]+.5,c.cell[1]+.5,'camera',m.power?'#62aaff':'#667078',c.facing,!m.power);
  }
  for(const g of m.guards)actor(g.x,g.y,g.facing,'#62aaff');
  // Draw the larger, white-edged player last so nearby actors cannot cover it.
  for(const p of [...m.thieves].sort((a,b)=>Number(a.player)-Number(b.player)))
    actor(p.x,p.y,p.facing,p.player?'#f04452':'#ef6e78',p.player?1.2:.7,p.player);
}
  return draw;
}
