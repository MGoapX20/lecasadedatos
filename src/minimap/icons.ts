export type MapIcon = 'camera' | 'key' | 'uniform' | 'power' | 'document';

/** Vector pictograms remain sharp and consistent without depending on emoji fonts. */
export function drawMapIcon(ctx: CanvasRenderingContext2D, x: number, y: number,
  icon: MapIcon, color: string, angle = 0, disabled = false) {
  ctx.save();ctx.translate(x,y);ctx.scale(.14,.14);
  ctx.fillStyle='#101820';ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.fill();
  if(icon==='camera')ctx.rotate(angle*Math.PI/180);
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.lineJoin='round';ctx.lineCap='round';
  if(icon==='camera') {
    ctx.beginPath();ctx.roundRect(-10,-6,13,12,2);ctx.fill();
    ctx.beginPath();ctx.moveTo(5,-3);ctx.lineTo(11,-7);ctx.lineTo(11,7);ctx.lineTo(5,3);ctx.closePath();ctx.fill();
  } else if(icon==='key') {
    ctx.beginPath();ctx.arc(-5,-4,4.5,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.moveTo(-1,-1);ctx.lineTo(8,8);ctx.lineTo(11,5);ctx.moveTo(5,5);ctx.lineTo(8,2);ctx.stroke();
  } else if(icon==='uniform') {
    ctx.fill(new Path2D('M-5-10 L-11-6 L-8 0 L-5-2 L-5 10 L5 10 L5-2 L8 0 L11-6 L5-10 L0-7 Z'));
    ctx.fillStyle='#101820';ctx.fill(new Path2D('M-3-9 L0-6 L3-9 L1-4 L2 5 L0 8 L-2 5 L-1-4 Z'));
  } else if(icon==='document') {
    ctx.beginPath();ctx.moveTo(-7,-10);ctx.lineTo(3,-10);ctx.lineTo(8,-5);ctx.lineTo(8,10);ctx.lineTo(-7,10);ctx.closePath();ctx.stroke();
    ctx.beginPath();ctx.moveTo(3,-10);ctx.lineTo(3,-5);ctx.lineTo(8,-5);ctx.moveTo(-3,0);ctx.lineTo(4,0);ctx.moveTo(-3,5);ctx.lineTo(4,5);ctx.stroke();
  } else {
    ctx.fill(new Path2D('M2-11 L-8 2 L-1 2 L-3 12 L9-3 L2-3 Z'));
  }
  if(disabled){ctx.strokeStyle='#e2e7eb';ctx.beginPath();ctx.moveTo(-10,10);ctx.lineTo(10,-10);ctx.stroke();}
  ctx.restore();
}
