import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { ANIMATIONS, Animator } from '../src/animations.js';
import { Actor, StateMachine } from '../src/actor.js';

test('12 fps timing, row-major addressing, and loop wrap',()=>{
  const a=new Animator(ANIMATIONS.player);
  a.update(1/24);assert.equal(a.frame,0);
  a.update(1/24);assert.equal(a.frame,1);
  a.update(3/12);assert.equal(a.frame,4);
  assert.deepEqual(a.source,{x:0,y:128,width:128,height:128});
  a.update(8/12);assert.equal(a.frame,0);
});
test('pause, manual stepping, restart and one-shot completion',()=>{
  const a=new Animator(ANIMATIONS.boss);
  a.play('attack_1');a.paused=true;a.update(1);assert.equal(a.frame,0);
  a.step();assert.equal(a.frame,1);
  a.paused=false;a.update(10);assert.equal(a.frame,16);assert.equal(a.finished,true);
  a.play('idle');assert.equal(a.finished,false);assert.equal(a.frame,0);
  a.update(1/12);a.play('idle');assert.equal(a.frame,1);
});
test('movement, facing, stage bounds, idle restoration and stationary boss',()=>{
  const p=new Actor('player',260,420);
  p.update(.5,1);assert.equal(p.x,340);assert.equal(p.machine.current,'run');
  p.update(.5,-1);assert.equal(p.x,260);assert.equal(p.facing,-1);
  p.update(.1,0);assert.equal(p.machine.current,'idle');
  p.update(100,-1);assert.equal(p.x,64);
  p.update(100,1);assert.equal(p.x,896);
  const b=new Actor('boss',704,420,-1);b.update(1,1);
  assert.equal(b.x,704);assert.equal(b.machine.current,'idle');
});
test('preview loops and movement cancels player preview; terminal boss state holds',()=>{
  const p=new Actor('player',260,420);p.preview('attack');p.update(2);
  assert.equal(p.machine.current,'attack');assert.equal(p.animator.loop,true);
  p.update(.1,1);assert.equal(p.previewing,false);assert.equal(p.machine.current,'run');
  p.machine.change('hit');p.update(2);assert.equal(p.machine.current,'idle');
  const b=new Actor('boss',704,420);b.machine.change('defeated');b.update(2);
  assert.equal(b.machine.current,'defeated');assert.equal(b.animator.frame,14);
});
test('enlarged boss frames preserve the lower-left 128px body origin in both directions',()=>{
  const b=new Actor('boss',704,420);
  const idle={...b.animator.anchor};
  for(const name of ['attack_1','attack_2','attack_3','jump_attack']){
    b.preview(name);assert.equal(b.animator.anchor.x,idle.x);assert.equal(b.animator.anchor.y-64,idle.y);
    for(const facing of [-1,1]){
      b.facing=facing;
      // A body-local pixel at (64,107) maps to the same world foot point.
      const x=b.x+facing*(64-b.animator.anchor.x)*b.scale;
      const y=b.groundY+(107+64-b.animator.anchor.y)*b.scale;
      assert.equal(x,b.x);assert.equal(y,420);
    }
  }
});
test('state transitions run exit and enter exactly once and reject unknown states',()=>{
  const events=[];
  const m=new StateMachine({idle:{enter:()=>events.push('idle'),exit:()=>events.push('exit')},run:{enter:()=>events.push('run')}},'idle');
  m.change('idle');m.change('run');assert.deepEqual(events,['idle','exit','run']);
  assert.throws(()=>m.change('missing'));
});

// Decode supplied RGBA PNGs to verify actual nonempty frames and ground pixels.
function decodePNG(buffer){
  let offset=8,width,height,parts=[];
  while(offset<buffer.length){
    const length=buffer.readUInt32BE(offset),type=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.equal(data[9],6);assert.equal(data[12],0);}
    if(type==='IDAT')parts.push(data);
    offset+=length+12;
  }
  const raw=inflateSync(Buffer.concat(parts)),stride=width*4,pixels=Buffer.alloc(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=4?pixels[i-4]:0,b=y?pixels[i-stride]:0,c=y&&x>=4?pixels[i-stride-4]:0;
      const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
      pixels[i]=(raw[y*(stride+1)+x+1]+predictor)&255;
    }
  }
  return {width,height,pixels};
}
test('all declared frames contain pixels, no animation omits real frames, and feet meet ground',async()=>{
  for(const [kind,clips] of Object.entries(ANIMATIONS))for(const [name,clip] of Object.entries(clips)){
    const image=decodePNG(await readFile(new URL(clip.url)));
    assert.equal(image.width,clip.width*4);
    const cells=(image.height/clip.height)*4;
    for(let frame=0;frame<cells;frame++){
      let bottom=0;
      const ox=(frame%4)*clip.width,oy=Math.floor(frame/4)*clip.height;
      for(let y=0;y<clip.height;y++)for(let x=0;x<clip.width;x++)if(image.pixels[((oy+y)*image.width+ox+x)*4+3])bottom=Math.max(bottom,y+1);
      assert.equal(bottom>0,frame<(clip.sourceFrames ?? clip.frames),`${kind}/${name} frame ${frame}`);
      if((name==='idle'||name==='run')&&frame<clip.frames)assert.equal(bottom,clip.groundY?.[frame]??clip.anchorY,`${kind}/${name} foot ${frame}`);
    }
  }
});
