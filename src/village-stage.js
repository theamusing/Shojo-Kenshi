import { GROUND_Y } from './stage.js';

// Painted at sprite resolution: one backdrop pixel is one source sprite pixel.
export function createVillageStage() {
  const canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 270;
  const c = canvas.getContext('2d');
  let seed = 812;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const rect = (x, y, w, h, color) => {
    c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const poly = (points, color) => {
    c.fillStyle = color; c.beginPath();
    points.forEach(([x, y], i) => i ? c.lineTo(Math.round(x), Math.round(y)) : c.moveTo(Math.round(x), Math.round(y)));
    c.closePath(); c.fill();
  };
  const sky = c.createLinearGradient(0, 0, 0, 210);
  sky.addColorStop(0, '#12232b'); sky.addColorStop(.55, '#3c5558'); sky.addColorStop(1, '#73817b');
  c.fillStyle = sky; c.fillRect(0, 0, 480, 270);
  // An obscured moon, behind the valley's fog rather than a bright night sky.
  c.fillStyle = '#a5b9ad0b'; c.beginPath(); c.arc(123, 48, 35, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#bec9b66b'; c.beginPath(); c.arc(123, 48, 17, 0, Math.PI * 2); c.fill();
  rect(102, 39, 42, 3, '#5f74736b'); rect(115, 51, 38, 4, '#5f747366');
  poly([[0,72],[27,55],[52,68],[83,27],[104,53],[126,80],[155,63],[189,93],[232,86],[268,58],[288,69],[322,32],[348,51],[390,25],[418,55],[453,37],[480,62],[480,180],[0,180]], '#2b4249');
  poly([[0,104],[38,80],[68,99],[103,87],[133,113],[175,103],[212,124],[257,113],[298,90],[330,108],[375,78],[414,99],[446,75],[480,101],[480,183],[0,183]], '#354e51');
  // Far cedar silhouettes disappear into the mist.
  for (let i = 0; i < 62; i++) {
    const x = i * 8, base = 142 + random() * 14, height = 20 + random() * 43;
    rect(x, base - height, 1, height, '#294449');
    for (let tier = 0; tier < 5; tier++) {
      const y = base - height + tier * height * .16, spread = 3 + tier * 1.3;
      poly([[x,y-4],[x-spread,y+9],[x+spread,y+9]], '#2e484c');
    }
  }
  for (let i = 0; i < 22; i++) rect(random()*480, 88+random()*63, 45+random()*110, 1+random()*3, '#92a9a00b');
  // Flooded village: low thatched roofs, warped posts and shuttered windows.
  const house = (x, y, w, h, light = false) => {
    rect(x, y, w, h, '#283d3e');
    for (let px = x + 3; px < x + w; px += 5) {
      rect(px, y, 2, h, '#344746'); rect(px + 2, y, 1, h, '#203637');
    }
    const ridge = y - w * .29;
    poly([[x-9,y+2],[x+w*.4,ridge],[x+w*.75,ridge+2],[x+w+10,y+5],[x+w+5,y+8],[x-7,y+6]], '#1f3439');
    poly([[x-6,y],[x+w*.4,ridge+3],[x+w*.75,ridge+5],[x+w+6,y+3]], '#44534c');
    for (let i = 0; i < w * .6; i++) {
      const px = x + random()*w, py = y - random()*w*.13;
      rect(px, py, 2+random()*4, 1, random() < .5 ? '#68705a55' : '#1b303455');
    }
    rect(x-8,y+5,w+16,2,'#182f34');
    rect(x+w*.58,y+12,w*.2,h-12,'#152b30');
    rect(x+7,y+11,10,12,light?'#8e7750':'#172d31');
    if (light) { rect(x+9,y+13,6,8,'#b49b62'); rect(x+11,y+11,1,12,'#293c38'); }
    rect(x+7,y+16,10,1,'#243b3b');
    rect(x-2,y+h,3,13,'#213739');rect(x+w-2,y+h,3,15,'#213739');
    poly([[x+w*.3,y+h-6],[x+w*.38,y+h-8],[x+w*.47,y+h+6],[x+w*.31,y+h+3]], '#182f34');
  };
  house(49,131,49,32); house(120,139,38,26); house(285,126,55,39,true); house(375,137,43,31);
  // Still water separates the abandoned houses from the playable causeway.
  rect(0,176,480,32,'#344d4d');
  for (let i = 0; i < 120; i++) {
    const x=random()*480,y=177+random()*30;
    rect(x,y,3+random()*21,1,random()<.5?'#82968a18':'#18353838');
  }
  for (let i=0;i<14;i++) rect(292+random()*20,178+i*2,2+random()*7,1,'#b59e6238');
  // A half-submerged boat and broken mooring stakes.
  poly([[174,186],[184,194],[226,194],[236,184],[222,188],[190,189]],'#1b3337');
  rect(189,187,34,2,'#5b6555');
  for (const x of [36,104,247,369,432]) {
    rect(x,175,3,29,'#233b3c');rect(x,175,1,29,'#5c6e60');
    rect(x-3,198,10,1,'#81978a36');
  }
  // A broken footbridge beyond the causeway.
  for (let x=213;x<278;x+=11) rect(x,165,2,22,'#20383b');
  rect(210,178,71,3,'#20383b'); rect(211,177,65,1,'#718073');
  poly([[212,162],[243,167],[244,168],[212,164]],'#3d5350');
  poly([[258,169],[280,163],[280,165],[259,171]],'#3d5350');
  // Low stone graves and weather-worn devotional tablets on the far bank.
  for (const [x,h] of [[15,18],[26,14],[263,21],[274,16],[454,22]]) {
    rect(x-3,207-h,7,h,'#465853');rect(x-4,207-h,9,2,'#647268');
    rect(x,211-h,1,h-7,'#293f40');rect(x-5,205,11,4,'#263f40');
  }
  // Two modest lanterns keep the combat space readable without warming the whole scene.
  for (const x of [75,407]) {
    rect(x-5,206,11,4,'#455750');rect(x-2,187,4,19,'#384f4b');
    rect(x-5,179,11,9,'#233b3c');rect(x-3,181,6,6,'#9a8354');rect(x-1,182,2,4,'#d5bd83');
    poly([[x,172],[x-9,180],[x+10,180]],'#59685a');rect(x-8,180,17,2,'#1e3739');
  }
  // The path starts at world y=420; actors stand on its surface at GROUND_Y=428.
  rect(0,208,480,3,'#374c48');rect(0,210,480,1,'#a0aaa08c');
  rect(0,211,480,20,'#52625b');rect(0,231,480,5,'#263f3e');
  for (let row=0;row<2;row++) for(let x=-25;x<480;x+=29) {
    const px=x+(row%2)*15, y=211+row*9;
    rect(px,y,27,8,'#647168');rect(px+1,y+1,25,1,'#8b96816b');
    rect(px+3,y+5,18,2,'#384f4c66');rect(px+25,y+1,1,6,'#2e4744');
  }
  for(let i=0;i<64;i++) {
    const x=random()*480,y=212+random()*16;
    rect(x,y,4+random()*15,1,'#b6c4b33a');
    if(i%3===0)rect(x,y+1,3+random()*10,1,'#24434170');
  }
  for(let i=0;i<45;i++)rect(random()*480,228+random()*8,1+random()*3,2+random()*5,'#536b4b');
  // The foreground channel falls away below the path, leaving room for the HUD.
  rect(0,237,480,33,'#162f35');
  for(let i=0;i<70;i++)rect(random()*480,239+random()*31,6+random()*26,1,'#688c8218');
  // Framing willow trunks and thin hanging twigs, outside the central silhouettes.
  poly([[0,0],[20,0],[23,54],[17,109],[22,163],[18,211],[7,211],[12,160],[8,109],[14,50]],'#10282e');
  poly([[14,69],[39,41],[77,24],[97,17],[72,34],[44,49],[17,83]],'#10282e');
  poly([[480,0],[465,0],[459,55],[466,107],[454,168],[458,212],[472,212],[468,164],[478,106],[469,54]],'#112a30');
  poly([[466,65],[436,44],[404,36],[382,13],[409,30],[440,35],[469,51]],'#112a30');
  for(let i=0;i<28;i++) {
    const right=i%2, x=right?396+random()*75:22+random()*71;
    const y=12+random()*36, length=25+random()*73;
    for(let step=0;step<length;step+=3) {
      const px=x+Math.sin(step*.025+i)*5;
      rect(px,y+step,1,3,'#1b3639');
      if(step%9===0)rect(px+(right?-2:1),y+step,2,4,'#294540');
    }
  }
  return canvas;
}

export function drawVillageStage(ctx, background, time, actors) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(background, 0, 0, 960, 540);
  ctx.save(); ctx.scale(2, 2);
  // Slow, broken horizontal reflections and elongated bands of low fog.
  for(let i=0;i<24;i++) {
    const x=(i*47+Math.sin(time*.17+i)*8)%480,y=179+(i*7)%26;
    ctx.fillStyle=i%3?'#9ab9ac18':'#b1c7b52b';
    ctx.fillRect(Math.round(x),y,5+(i%4)*6,1);
  }
  for(let i=0;i<9;i++) {
    const x=(i*83+time*(1.4+i%3))%660-130, y=129+(i*17)%72;
    ctx.fillStyle='#bcccb412';ctx.fillRect(Math.round(x),y,75+i%4*17,2);
    ctx.fillStyle='#bcccb408';ctx.fillRect(Math.round(x-14),y+2,108+i%4*17,4);
  }
  for(let i=0;i<7;i++) {
    const x=50+i*61+Math.sin(time*.21+i)*12, y=145+Math.sin(time*.3+i*2)*16;
    ctx.fillStyle=`rgba(171,206,177,${.15+.16*(1+Math.sin(time*.8+i))/2})`;
    ctx.fillRect(Math.round(x),Math.round(y),1,1);
  }
  ctx.restore();
  for(const actor of actors) {
    ctx.fillStyle='#0c242b66';ctx.beginPath();
    ctx.ellipse(Math.round(actor.x),GROUND_Y,actor.appearance==='ghost'?24:23,3,0,0,Math.PI*2);ctx.fill();
  }
}

export function drawVillageForeground(ctx, time) {
  ctx.save();ctx.scale(2,2);
  for(let i=0;i<5;i++) {
    const x=(i*137+time*3)%680-160;
    ctx.fillStyle='#b4c8b409';ctx.fillRect(Math.round(x),211+i%2*5,110,2);
  }
  for(const x of [6,15,30,447,462,475]) {
    ctx.fillStyle='#0f2a30';
    ctx.fillRect(x,231,1,23);ctx.fillRect(x+2,223,1,31);
    ctx.fillRect(x+1,237,5,1);ctx.fillRect(x-3,231,4,1);
  }
  ctx.restore();
}
