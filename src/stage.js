// Shared actor baseline, 8 world pixels below the path's rear edge.
export const GROUND_Y = 428;

// A low-resolution painted backdrop, enlarged with nearest-neighbor sampling.
export function createStage() {
  const canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 270;
  const c = canvas.getContext('2d');
  let seed = 441;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rect = (x, y, w, h, color) => { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), w, h); };
  const poly = (points, color) => { c.fillStyle = color; c.beginPath(); points.forEach(([x,y],i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath(); c.fill(); };
  const sky = c.createLinearGradient(0,0,0,210);
  sky.addColorStop(0,'#1b303b'); sky.addColorStop(0.6,'#425b5c'); sky.addColorStop(1,'#7b8b7b');
  c.fillStyle=sky; c.fillRect(0,0,480,270);
  for(let i=0;i<65;i++) rect(random()*480,random()*110,1,1,random()>.6?'#819994':'#526f74');
  c.fillStyle='#b4c4ad15';c.beginPath();c.arc(339,56,35,0,Math.PI*2);c.fill();
  c.fillStyle='#d2d6b6';c.beginPath();c.arc(339,56,23,0,Math.PI*2);c.fill();
  rect(329,42,9,2,'#b9c5ac');rect(344,65,12,2,'#bec8af');rect(322,54,6,3,'#c3ccb0');
  poly([[0,117],[34,81],[48,92],[79,49],[96,74],[118,95],[146,73],[171,113],[196,89],[220,116],[251,97],[281,115],[317,87],[359,111],[395,83],[423,112],[451,70],[480,102],[480,210],[0,210]],'#344e55');
  poly([[0,145],[25,128],[58,136],[94,111],[122,142],[157,108],[186,137],[216,126],[239,146],[279,132],[318,145],[353,119],[386,132],[415,119],[451,143],[480,127],[480,210],[0,210]],'#3c595c');
  // Low clouds sit between the mountain layers and the temple silhouette.
  for(let i=0;i<15;i++) rect(random()*470,99+random()*71,40+random()*120,1+Math.floor(random()*3),'#94aaa00c');
  const pine = (x,y,h,color) => {
    rect(x-1,y-h,2,h,color);
    for(let k=0;k<5;k++) { const top=y-h+k*h*.14; const width=5+k*h*.065;poly([[x,top-7],[x-width,top+13],[x+width,top+13]],color); }
  };
  for(let i=0;i<42;i++) pine(i*13-10,190,25+random()*45,'#2d484c');
  // A distant tiered temple.
  rect(263,120,35,63,'#283e43');
  for(let tier=0;tier<3;tier++) {
    const y=118+tier*20,w=27+tier*6;
    rect(280-w/2,y+2,w,17,'#354b4b');
    poly([[280,y-10],[280-w,y+6],[276-w,y+5],[280-w+4,y+10],[280+w-4,y+10],[284+w,y+5],[280+w,y+6]],'#223a42');
    rect(275,y+12,3,6,'#7e8465');rect(285,y+12,3,6,'#7e8465');
  }
  rect(279,99,2,12,'#263c40');
  poly([[0,191],[48,181],[103,188],[155,177],[219,185],[281,177],[348,187],[420,177],[480,186],[480,213],[0,213]],'#263f40');
  for(let i=0;i<17;i++) rect(random()*480,166+random()*30,55+random()*75,2,'#8caa9910');
  // Shrine gate, behind the characters. Muted vermilion against cold greens.
  const gateX=357;
  rect(gateX-36,100,9,109,'#693e35');rect(gateX+36,100,9,109,'#5c3732');
  rect(gateX-36,101,2,102,'#9c6750');rect(gateX+36,101,2,102,'#97604a');
  rect(gateX-39,199,15,11,'#303b37');rect(gateX+33,199,15,11,'#303b37');
  rect(gateX-48,120,104,7,'#7a4a3b');rect(gateX-48,120,104,2,'#a16b50');
  rect(gateX-56,98,120,9,'#764637');rect(gateX-56,98,120,2,'#a17355');
  poly([[gateX-65,90],[gateX-43,94],[gateX+49,94],[gateX+71,90],[gateX+67,98],[gateX+51,102],[gateX-45,102],[gateX-61,98]],'#222f32');
  rect(gateX-3,105,14,22,'#9c7951');rect(gateX-1,107,10,17,'#3e3f34');rect(gateX+3,111,2,9,'#ac9970');
  // Rope with paper streamers.
  c.strokeStyle='#99876a';c.lineWidth=1;c.beginPath();c.moveTo(gateX-27,132);c.quadraticCurveTo(gateX+4,144,gateX+36,132);c.stroke();
  for(let i=0;i<4;i++){const x=gateX-19+i*15,y=136+(i===1||i===2?3:0);poly([[x,y],[x+3,y+2],[x+1,y+6],[x+4,y+7],[x+1,y+11],[x-1,y+7],[x+1,y+4]],'#b8b59a');}
  // Left foreground cedar and framing boughs.
  poly([[17,0],[27,0],[30,67],[23,126],[27,210],[12,210],[17,120],[21,66]],'#152d32');
  poly([[21,82],[52,58],[85,52],[50,64],[23,93]],'#152d32');
  poly([[23,43],[0,31],[0,24],[25,36]],'#152d32');
  for(let i=0;i<18;i++){const x=random()*102,y=random()*48;poly([[x,y],[x-22,y+9],[x+24,y+9],[x+8,y+3]],'#193237');}
  pine(466,210,101,'#1a3335');pine(486,212,145,'#182f33');
  // Mossy perimeter wall.
  rect(0,192,480,18,'#344744');rect(0,191,480,3,'#51645a');
  for(let x=0;x<480;x+=22){rect(x,195,1,13,'#233a39');rect(x+2,198,17,1,'#3d514b');rect(x+9,192,8,1,'#73816a');}
  // Two stone lanterns.
  for(const x of [65,424]){
    rect(x-7,205,14,5,'#5e6959');rect(x-3,183,6,23,'#505e54');rect(x-8,178,16,6,'#6e7863');
    rect(x-6,165,12,13,'#384b45');rect(x-3,168,6,7,'#d7a15c');rect(x-1,169,2,5,'#f0c17a');
    poly([[x,155],[x-12,167],[x+12,167]],'#71806c');rect(x-12,166,24,2,'#334742');
  }
  // The top edge is exactly y=210 (420 in world coordinates).
  rect(0,210,480,5,'#8d9580');rect(0,210,480,1,'#bcc1a0');rect(0,215,480,9,'#5d6b5e');rect(0,224,480,46,'#263637');
  for(let x=0;x<480;x+=27){rect(x,211,1,12,'#3b4e47');rect(x+2,213,21,1,'#a1a58b');rect(x+4,219,17,1,'#6f7a66');}
  for(let row=0;row<3;row++)for(let x=-30;x<480;x+=42){const px=x+(row%2)*21,py=226+row*13;rect(px,py,40,11,row%2?'#354441':'#3c4a43');rect(px+2,py+2,35,1,'#536052');}
  for(let i=0;i<110;i++){const x=Math.floor(random()*480),y=215+Math.floor(random()*52);rect(x,y,2+Math.floor(random()*6),1,random()>.4?'#71806435':'#172c303f');}
  for(let i=0;i<40;i++){const x=random()*480;rect(x,208,1,2,'#8b9676');if(random()>.6)rect(x+1,206,1,3,'#6b8165');}
  return canvas;
}

export function drawStage(ctx, background, time, actors, guides) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(background,0,0,960,540);
  // Slow drifting leaves; no movement affects the simulation.
  for(let i=0;i<14;i++){
    const x=(i*107+time*(7+i%4))%1000-20;
    const y=110+(i*47+time*(4+i%3))%300;
    ctx.fillStyle=i%3?'#c1996255':'#cfaf7b88';
    ctx.fillRect(Math.round(x),Math.round(y+Math.sin(time+i)*5),i%2?4:2,2);
  }
  for(const actor of actors){
    ctx.fillStyle='#14272560';ctx.beginPath();ctx.ellipse(Math.round(actor.x),GROUND_Y,actor.kind==='boss'?35:23,4,0,0,Math.PI*2);ctx.fill();
  }
  if(guides){ctx.strokeStyle='#dfbb7890';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(0,GROUND_Y+.5);ctx.lineTo(960,GROUND_Y+.5);ctx.stroke();ctx.setLineDash([]);}
}
