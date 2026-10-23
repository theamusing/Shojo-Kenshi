import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { Duel } from '../src/duel.js';
import { GhostBrain } from '../src/ghost.js';
import { GHOST_ATTACKS, GHOST_COMBOS } from '../src/ghost-rules.js';
import { getBodyBox } from '../src/physics.js';
import { getAttackBox, getHurtbox, resolveAttackHits } from '../src/combat.js';
import { ANIMATIONS } from '../src/animations.js';
import { drawGhostMist } from '../src/ghost-effects.js';
import { GameAudio } from '../src/audio.js';

function setup(random = () => .99) {
  const player = new Actor('player', 260, 428);
  const boss = new Actor('boss', 704, 428, -1, 'ghost');
  const duel = new Duel(player, boss, { brainClass: GhostBrain, random });
  return { player, boss, duel, brain: duel.brain, effects: duel.effects };
}
function playerStrike(s) {
  s.player.machine.change('attack', true);
  resolveAttackHits(s.player, [s.boss], 5, s.effects);
  s.duel.applyEvents();
}

test('ghost idles at 8fps then shifts exactly at the three-second opening boundary', () => {
  const { boss, duel } = setup();
  duel.update(3-1e-6); assert.equal(boss.x, 704); assert.equal(boss.machine.current, 'idle');
  assert.equal(boss.animator.fps, 8);
  duel.update(1e-6);assert.equal(boss.machine.current,'shift');assert.equal(boss.animator.frame,0);
  assert.equal(duel.introRemaining,0);
  assert.equal(ANIMATIONS.ghost.attack_3.frames,24);
});

test('ghost hurtbox is wider while its body collision remains unchanged', () => {
  const s=setup();
  for(const facing of [-1,1]) {
    s.boss.facing=facing;const hurt=getHurtbox(s.boss),body=getBodyBox(s.boss);
    assert.equal(hurt.width,56);assert.equal(body.width,48);
    assert.equal(hurt.x,body.x-4);assert.equal(hurt.height,body.height);
  }
});

test('active attack windows match the simplified move set', () => {
  const s = setup();
  const expected = { 1:[15],2:[11],3:[8],5:[18],7:[15,25],9:[4,5,6,7,8,9,10],10:[15,24] };
  assert.deepEqual(Object.keys(GHOST_ATTACKS), Object.keys(expected).map(n=>`attack_${n}`));
  for (const [n, frames] of Object.entries(expected)) {
    s.brain.startAttack(`attack_${n}`);
    for (let f = 0; f < s.boss.animator.clip.frames; f++) assert.equal(!!getAttackBox(s.boss, f), frames.includes(f+1), `${n}/${f+1}`);
  }
  for(const n of [4,6]) {
    assert.throws(()=>s.brain.startAttack(`attack_${n}`));
    s.boss.machine.change(`attack_${n}`,true);
    assert.equal(getAttackBox(s.boss),null);
  }
});

test('each strike hits once, including the two independent hits of 7 and 10', () => {
  for (const [name, spec] of Object.entries(GHOST_ATTACKS)) {
    const s = setup(); s.boss.x = 400; s.player.x = name==='attack_9'?342:300; s.brain.startAttack(name);
    let hits = 0; s.effects.damage = () => hits++;
    for (const f of Object.keys(spec.hits).map(Number)) {
      s.boss.animator.frame = f;
      for (let i=0;i<8;i++) resolveAttackHits(s.boss,[s.player],f,s.effects);
    }
    assert.equal(hits,new Set(Object.values(spec.hits)).size,name);
  }
});

test('normal melee selects standalone 1, 5 or 10 with their full ranges', () => {
  const expected=[['attack_1'],['attack_5'],['attack_10']];
  const ranges=[[[0,19]],[[0,23]],[[0,26]]];
  assert.deepEqual(GHOST_COMBOS,expected);
  for(let n=0;n<expected.length;n++) {
    const s=setup(()=>(n+.1)/3);s.brain.startCombo();
    assert.deepEqual(s.brain.combo,expected[n]);
    for(let i=0;i<expected[n].length;i++) {
      assert.equal(s.boss.machine.current,expected[n][i]);
      assert.equal(s.brain.comboIndex,i);
      const [start,end]=ranges[n][i];
      assert.equal(s.boss.animator.frame,start);
      assert.equal(s.boss.animator.startFrame,start);
      assert.equal(s.boss.animator.endFrame,end);
      const duration=(end-start+1)/12;
      s.brain.update(duration-1e-6,s.effects);
      assert.equal(s.boss.machine.current,expected[n][i]);
      assert.equal(s.boss.animator.frame,end);
      s.brain.update(1e-6,s.effects);
    }
    assert.ok(s.boss.canMove);assert.equal(s.brain.combo.length,0);
    assert.ok(s.brain.decisionRemaining>=.5 && s.brain.decisionRemaining<=.9);
  }
});

test('attack 1 never repeats across normal decisions, recovery, shift arrivals or a combo ending', () => {
  for(const origin of ['ordinary','shift','combo']) for(const roll of [0,.34,.5,.99]) {
    const s=setup();
    if(origin==='combo') {
      s.brain.startAttack('attack_7',false,{fromShift:true});
      for(let i=0;i<3;i++)s.brain.finishAction();
    } else s.brain.startAttack('attack_1',false,{fromShift:origin==='shift'});
    assert.equal(s.brain.lastAttack,'attack_1');
    s.brain.rest();s.brain.random=()=>roll;s.brain.startCombo();
    assert.ok(['attack_5','attack_10'].includes(s.boss.machine.current));
    s.brain.startAttack('attack_1');s.brain.rest();
    s.brain.startShift({attackOnArrival:true});s.brain.teleport(s.effects);
    assert.ok(['attack_7','attack_9'].includes(s.boss.machine.current));
    // Another attack restores eligibility; idle, walking and mist do not.
    s.brain.startAttack('attack_5');s.brain.rest();s.brain.random=()=>0;s.brain.startCombo();
    assert.equal(s.boss.machine.current,'attack_1');
    s.duel.reset();assert.equal(s.brain.lastAttack,null);
    s.brain.startCombo();assert.equal(s.boss.machine.current,'attack_1');
  }
});

test('normal attack 5 hits once and completes before recovery or queued shift', () => {
  for(const queueShift of [false,true]) {
    const rolls=[.5];
    const s=setup(()=>rolls.length?rolls.shift():.2);
    s.boss.x=400;s.player.x=300;s.brain.startCombo();
    const moves=['attack_5'];
    const ranges=[[0,23]];
    assert.deepEqual(s.brain.combo,moves);
    const hits=[],swings=[];
    s.effects.damage=()=>hits.push([s.boss.machine.current,s.brain.comboIndex]);
    s.effects.swing=()=>swings.push([s.boss.machine.current,s.brain.comboIndex]);
    for(let i=0;i<moves.length;i++) {
      const [start,end]=ranges[i];
      assert.equal(s.boss.machine.current,moves[i]);
      assert.equal(s.boss.animator.frame,start);assert.equal(s.boss.animator.endFrame,end);
      assert.equal(s.brain.rootOffset,s.boss.animator.clip.rootXs[start]);
      assert.equal(s.brain.heavyAttack,false);assert.equal(s.brain.recovering,false);
      if(queueShift)s.brain.reactToHit();
      assert.equal(s.brain.shiftPending,queueShift);
      assert.deepEqual(s.brain.combo,moves);
      const hitFrame=moves[i]==='attack_5'?17:14;
      s.brain.update((hitFrame-start)/12-1e-6,s.effects);assert.equal(hits.length,i);
      s.brain.update(1e-6,s.effects);assert.equal(hits.length,i+1);
      s.brain.update((end-hitFrame+1)/12-1e-6,s.effects);
      assert.equal(s.boss.machine.current,moves[i]);assert.equal(s.boss.animator.frame,end);
      assert.equal(hits.length,i+1);assert.equal(swings.length,i+1);
      s.brain.update(1e-6,s.effects);
    }
    assert.deepEqual(hits,moves.map((name,i)=>[name,i]));
    assert.deepEqual(swings,moves.map((name,i)=>[name,i]));
    if(queueShift)assert.equal(s.boss.machine.current,'shift');
    else {assert.ok(s.boss.canMove);assert.equal(s.brain.recovering,true);}
  }
});

test('attack 7 chains two fast attack 2 segments then attack 1, including after shift', () => {
  for(const fromShift of [false,true]) {
    const s=setup();s.brain.startAttack('attack_7',false,{fromShift});
    const moves=['attack_7','attack_2','attack_2','attack_1'];
    const ranges=[[fromShift?4:0,27],[5,11],[7,11],[7,19]];
    assert.deepEqual(s.brain.combo,moves);
    for(let i=0;i<moves.length;i++) {
      assert.equal(s.boss.machine.current,moves[i]);
      assert.equal(s.brain.heavyAttack,i===3);
      const [start,end]=ranges[i];
      assert.equal(s.boss.animator.frame,start);assert.equal(s.boss.animator.endFrame,end);
      s.brain.update((end-start+1)/12-1e-6,s.effects);
      assert.equal(s.boss.machine.current,moves[i]);assert.equal(s.boss.animator.frame,end);
      s.brain.update(1e-6,s.effects);
    }
    assert.ok(s.boss.canMove);assert.equal(s.brain.combo.length,0);
    assert.equal(s.brain.comboFromShift,false);assert.equal(s.brain.heavyAttack,false);
  }
});

test('attack 7 followups each hit on frame 11 and reset hit and swing deduplication', () => {
  for(const fromShift of [false,true]) {
    const s=setup();s.boss.x=400;s.player.x=300;
    s.brain.startAttack('attack_7',false,{fromShift});
    const hits=[],swings=[];
    s.effects.damage=()=>hits.push([s.boss.machine.current,s.brain.comboIndex]);
    s.effects.swing=()=>swings.push([s.boss.machine.current,s.brain.comboIndex]);
    s.brain.update((fromShift?24:28)/12,s.effects);
    for(const index of [1,2]) {
      assert.equal(s.boss.machine.current,'attack_2');assert.equal(s.brain.comboIndex,index);
      const start=index===1?5:7;
      assert.equal(s.boss.animator.frame,start);assert.equal(s.boss.animator.endFrame,11);
      for(let frame=start;frame<=11;frame++)assert.equal(!!getAttackBox(s.boss,frame),frame===10);
      const before=hits.length;
      s.brain.update((10-start)/12-1e-6,s.effects);assert.equal(hits.length,before);
      s.brain.update(1e-6,s.effects);assert.equal(hits.length,before+1);
      s.brain.update(2/12,s.effects);assert.equal(hits.length,before+1);
    }
    s.brain.update(13/12,s.effects);
    const expected=[['attack_7',0],['attack_7',0],['attack_2',1],['attack_2',2],['attack_1',3]];
    assert.deepEqual(hits,expected);assert.deepEqual(swings,expected);
  }
});

test('both fast attack 2 segments stay in place throughout their playback', () => {
  for(const facing of [-1,1]) for(const step of [1/120,1/12]) {
    const s=setup();s.boss.x=480;s.player.x=facing===1?880:80;
    s.brain.startAttack('attack_7');s.brain.finishAction();
    const start=s.boss.x;
    s.brain.update(2/12,s.effects);assert.equal(s.boss.x,start);
    for(let segment=0;segment<2;segment++) {
      assert.equal(s.boss.machine.current,'attack_2');assert.equal(s.boss.animator.frame,7);
      const before=s.boss.x;
      s.boss.animator.paused=true;s.brain.update(.5,s.effects);assert.equal(s.boss.x,before);
      s.boss.animator.paused=false;
      for(let i=0;i<Math.round((4/12)/step);i++)s.brain.update(step,s.effects);
      assert.equal(s.boss.x,before);
      s.brain.update(1/12,s.effects);assert.equal(s.boss.x,before);
    }
    assert.equal(s.boss.machine.current,'attack_1');
  }
  const s=setup();s.boss.x=840;s.player.x=896;
  s.brain.startAttack('attack_2');s.brain.update(12/12,s.effects);
  const bossBox=getBodyBox(s.boss),playerBox=getBodyBox(s.player);
  assert.ok(s.player.x<=896);assert.ok(bossBox.x+bossBox.width<=playerBox.x+1e-8);
});

test('attack 2 reduces ghost hit and guard recoil without changing samurai recoil', () => {
  for(const appearance of ['ghost','boss']) for(const facing of [-1,1]) for(const guarded of [false,true]) {
    const s=setup();const attacker=appearance==='ghost'?s.boss:new Actor('boss',400,428);
    attacker.x=400;attacker.facing=facing;s.player.x=400+facing*100;
    if(appearance==='ghost')s.brain.startAttack('attack_2');
    else attacker.machine.change('attack_2',true);
    if(guarded)s.player.machine.change('defend_1',true);
    resolveAttackHits(attacker,[s.player],appearance==='ghost'?10:11,s.effects);
    const speed=appearance==='ghost'?(guarded?110:220):(guarded?180:360);
    assert.equal(s.player.knockbackVelocity,facing*speed);
    assert.equal(s.player.machine.current,guarded?'defend_1':'hit');
  }
});

test('ordinary AI never selects attack 7 and can shift aggressively from middle or far range', () => {
  let seed=81;const s=setup(()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32});
  for(const distance of [120,230,500]) {
    let attacks=0,shifts=0;const patterns=new Set();
    for(let i=0;i<1000;i++) {
      s.player.x=100;s.boss.x=100+distance;s.brain.reset();s.boss.machine.change('idle');s.brain.decide();
      const state=s.boss.machine.current;
      if(state.startsWith('attack_')) {attacks++;patterns.add(s.brain.combo.join(','));}
      assert.ok(['idle','run','shift','attack_1','attack_5','attack_10'].includes(state));
      if(state==='shift') {shifts++;assert.equal(s.brain.shiftAttackOnArrival,distance>190);}
    }
    if(distance===120) { assert.ok(attacks>880 && attacks<960);assert.equal(patterns.size,3); }
    else {
      assert.equal(attacks,0);
      assert.ok(distance===230?shifts>390&&shifts<510:shifts>540&&shifts<660);
    }
  }
});

test('distance-closing shift lands nearby and attacks immediately without an idle or walk gap', () => {
  for(const distance of [230,500]) for(const attackRoll of [0,.5]) {
    const rolls=[.2,.5,attackRoll];const s=setup(()=>rolls.shift()??.99);
    s.player.x=100;s.boss.x=100+distance;s.brain.decide();
    assert.equal(s.boss.machine.current,'shift');assert.equal(s.brain.shiftAttackOnArrival,true);
    s.brain.update(10/12+1-1e-6,s.effects);assert.equal(s.brain.shiftPhase,'hidden');
    s.brain.update(1e-6,s.effects);
    assert.equal(s.boss.machine.current,attackRoll===0?'attack_7':'attack_1');
    assert.equal(s.boss.animator.frame,4);assert.equal(s.brain.reason,'shiftAttack');
    assert.ok(s.brain.distance>=140 && s.brain.distance<=220);
    assert.equal(s.brain.shiftAttackOnArrival,false);
    s.brain.finishAction();
    while(!s.boss.canMove)s.brain.finishAction();
    s.boss.x=220;s.brain.decide();
    assert.equal(s.boss.machine.current,'attack_10');assert.equal(s.brain.comboFromShift,false);
    assert.equal(s.brain.heavyAttack,false);
  }
});

test('nonattacking shift followed by idle or walk cannot defer a shift combo', () => {
  for(const restRoll of [.2,.99]) {
    const s=setup();s.brain.startShift();s.brain.update(10/12+1,s.effects);
    assert.equal(s.brain.shiftPhase,'appear');
    s.brain.random=()=>restRoll;
    s.brain.update((s.boss.animator.endFrame-10+1)/12,s.effects);
    assert.equal(s.boss.machine.current,restRoll<.35?'run':'idle');
    assert.deepEqual(s.brain.combo,[]);assert.equal(s.brain.comboFromShift,false);
    s.boss.x=s.player.x+120;s.brain.shiftCooldown=3;
    for(const roll of [.1,.5,.9]) {
      s.brain.random=()=>roll;s.brain.decide();
      assert.ok(['attack_1','attack_5','attack_10'].includes(s.boss.machine.current));
      assert.equal(s.brain.heavyAttack,s.boss.machine.current==='attack_1');assert.equal(s.brain.comboFromShift,false);
    }
  }
});

test('close range honors inter-combo recovery, then attacks or shifts again', () => {
  for(const cooldown of [0,3]) for(const roll of [0,.5,.91,.92,.99]) {
    const s=setup(()=>roll);s.boss.x=400;s.player.x=300;s.brain.shiftCooldown=cooldown;
    s.brain.decide();assert.ok(!s.boss.canMove);
    assert.ok(s.boss.machine.current==='shift' || s.boss.machine.current.startsWith('attack_'));
    s.brain.rest();assert.equal(s.boss.machine.current,roll<.35?'run':'idle');
    const duration=s.brain.decisionRemaining;
    assert.ok(duration>=.5 && duration<=.9);
    s.brain.update(duration-1e-6,s.effects);assert.ok(s.boss.canMove);assert.equal(s.brain.recovering,true);
    s.brain.update(2e-6,s.effects);assert.ok(!s.boss.canMove);
    if(cooldown)assert.ok(s.boss.machine.current.startsWith('attack_'));
  }
  const s=setup(()=>.5);s.boss.x=400;s.player.x=300;
  s.brain.decisionRemaining=1;s.brain.update(1/120,s.effects);
  assert.ok(!s.boss.canMove);
  s.boss.machine.change('run');s.boss.x=491;s.player.x=300;s.brain.decisionRemaining=1;
  s.brain.moveMode='approach';s.brain.update(.03,s.effects);
  assert.ok(!s.boss.canMove);assert.ok(s.brain.distance<=190);
});

test('standalone melee attacks retain all strikes before recovery', () => {
  for(const [roll,count,duration] of [[.1,1,20/12],[.5,1,24/12],[.82,2,27/12]]) {
    const s=setup(()=>roll);s.boss.x=400;s.player.x=300;s.brain.startCombo();
    let hits=0;s.effects.damage=()=>hits++;
    s.brain.update(duration,s.effects);
    assert.equal(hits,count);assert.ok(s.boss.canMove);assert.equal(s.brain.recovering,true);
    s.brain.startAttack('attack_2');assert.equal(s.boss.animator.startFrame,0);assert.equal(s.boss.animator.endFrame,16);
    s.brain.startAttack('attack_3');assert.equal(s.boss.animator.startFrame,0);assert.equal(s.boss.animator.endFrame,23);
    s.brain.startAttack('attack_1');assert.equal(s.boss.animator.startFrame,0);
  }
});

test('damage outside the shift probability does not trigger backstep or a boss parry', () => {
  const s=setup();s.duel.introRemaining=0;s.boss.x=360;s.player.x=300;
  for(const name of ['idle','attack_2','defend']) {
    s.boss.machine.change(name,true);s.boss.animator.frame=name==='defend'?12:3;
    const health=s.boss.health;playerStrike(s);
    assert.equal(s.boss.health,health-15);assert.equal(s.boss.machine.current,name);
    assert.equal(s.player.machine.current,'attack');assert.equal(s.brain.invulnerable,false);
  }
});

test('recovery has a 35% walk chance at near and far range with either walking direction', () => {
  for(const distance of [120,350]) for(const walkRoll of [.349999,.35]) for(const directionRoll of [0,.99]) {
    const rolls=[walkRoll,directionRoll,.5];const s=setup(()=>rolls.shift()??.5);
    s.player.x=100;s.boss.x=100+distance;s.brain.rest();
    const walking=walkRoll<.35,before=s.boss.x;
    assert.equal(s.boss.machine.current,walking?'run':'idle');
    s.brain.update(.2,s.effects);assert.equal(s.brain.recovering,true);
    if(walking)assert.equal(Math.sign(s.boss.x-before),directionRoll<.55?1:-1);
    else assert.equal(s.boss.x,before);
  }
});

test('float dodge retreats on the ground over six frames then counters on frame 5', () => {
  for(const facing of [-1,1]) for(const wall of [false,true]) {
    const s=setup();s.boss.x=wall?(facing===1?80:880):480;s.player.x=facing===1?800:160;
    const initial=s.boss.x;s.brain.startDodge();
    assert.equal(s.boss.elevation,0);const bodyY=getBodyBox(s.boss).y;
    s.brain.update(.25,s.effects);
    assert.equal(s.boss.elevation,0);assert.equal(getBodyBox(s.boss).y,bodyY);
    assert.ok(Math.abs(s.boss.x-Math.max(64,Math.min(896,initial-facing*90)))<1e-8);
    s.brain.update(.25,s.effects);assert.equal(s.boss.elevation,0);
    const retreat=Math.max(64,Math.min(896,initial-facing*120));
    assert.ok(Math.abs(s.boss.x-retreat)<1e-8);
    assert.equal(s.boss.machine.current,'attack_3');
    assert.equal(s.boss.animator.frame,0);assert.ok(Math.abs(s.boss.x-retreat)<1e-8);
    const start=s.boss.x;s.brain.update(4/12,s.effects);assert.equal(s.boss.x,start);
    assert.equal(s.boss.animator.frame,4);s.brain.update(2/12,s.effects);
    assert.ok(Math.abs(s.boss.x-start-facing*1000*.85*2/12)<1e-8);
    const end=s.boss.x;s.brain.update(2/12,s.effects);assert.equal(s.boss.x,end);
  }
});

test('ground dodge freezes while paused and clears on interruption or restart', () => {
  const s=setup();s.duel.introRemaining=0;s.brain.startDodge();s.duel.update(.25);
  assert.equal(s.boss.elevation,0);const x=s.boss.x;
  s.duel.setPaused(true);s.duel.update(2);assert.equal(s.boss.elevation,0);assert.equal(s.boss.x,x);
  s.duel.setPaused(false);s.duel.update(.25);assert.equal(s.boss.elevation,0);
  s.brain.startDodge();s.brain.update(.25,s.effects);assert.equal(s.boss.elevation,0);
  s.duel.events.push({type:'posture',target:s.boss,amount:60});s.duel.applyEvents();
  assert.equal(s.boss.machine.current,'down');assert.equal(s.boss.elevation,0);
  s.duel.reset();assert.equal(s.boss.elevation,0);assert.equal(s.brain.dodgeProgress,0);
});

test('dodge afterimages snapshot poses on the pixel grid, fade, pause and reset', () => {
  const s=setup();s.duel.introRemaining=0;s.brain.startDodge();s.duel.update(.15);
  assert.ok(s.effects.afterimages.length>=3 && s.effects.afterimages.length<=6);
  const trail=s.effects.afterimages[0],source={...trail.source},ages=s.effects.afterimages.map(t=>t.age);
  assert.ok(s.effects.afterimages.every(t=>t.x%2===0&&t.y%2===0));
  s.duel.setPaused(true);s.duel.update(1);assert.deepEqual(s.effects.afterimages.map(t=>t.age),ages);
  let drawn=0;
  const ctx={globalAlpha:1,save(){},restore(){},translate(){},scale(){},drawImage(){drawn++}};
  s.effects.drawAfterimages(ctx,new Map([[trail.url,{}]]));assert.equal(drawn,s.effects.afterimages.length);
  s.duel.setPaused(false);s.duel.update(.05);assert.deepEqual(trail.source,source);
  s.duel.update(.7);assert.equal(s.boss.machine.current,'attack_3');
  assert.equal(s.effects.afterimages.length,0);
  s.duel.update(.3);assert.equal(s.effects.afterimages.length,0);
  s.effects.update(1);assert.equal(s.effects.afterimages.length,0);
  s.effects.ghostAfterimage(s.boss);s.duel.reset();assert.equal(s.effects.afterimages.length,0);
});

test('dodge slows down and fades with actual distance, restoring opacity on immediate landing counter', () => {
  for(const facing of [-1,1]) {
    const s=setup();s.boss.x=480;s.player.x=facing===1?800:160;s.brain.startDodge();
    assert.equal(s.brain.opacity,.85);let previousX=s.boss.x,previousStep=Infinity,previousOpacity=.85;
    for(let i=0;i<3;i++) {
      s.brain.update(.125,s.effects);
      const step=Math.abs(s.boss.x-previousX);
      assert.ok(step<previousStep);assert.ok(s.brain.opacity<previousOpacity);
      previousX=s.boss.x;previousStep=step;previousOpacity=s.brain.opacity;
    }
    s.brain.update(.125-1e-6,s.effects);assert.ok(Math.abs(s.brain.opacity-.2)<1e-8);
    s.brain.update(1e-6,s.effects);assert.equal(s.boss.machine.current,'attack_3');assert.equal(s.brain.opacity,1);
    s.boss.x=facing===1?80:880;s.brain.startDodge();s.brain.update(.5-1e-6,s.effects);
    assert.ok(Math.abs(s.brain.opacity-(.85-.65*16/120))<1e-8);
  }
});

test('idle and walking hit dodge has a 45% threshold independent of shift cooldown and never interrupts attacks', () => {
  for(const state of ['idle','run','attack_1','attack_7']) for(const roll of [.449999,.45]) {
    const s=setup(()=>roll);s.brain.shiftCooldown=3;
    if(state.startsWith('attack'))s.brain.startAttack(state);
    else s.boss.machine.change(state,true);
    s.brain.reactToHit();
    assert.equal(s.boss.machine.current,['idle','run'].includes(state)&&roll<.45?'float':state);
  }
});

test('idle damage triggers a paused-safe virtual dodge then full attack 3 before queued shift', () => {
  const s=setup(()=>.2);s.duel.introRemaining=0;s.boss.x=360;s.player.x=300;s.brain.shiftCooldown=3;
  playerStrike(s);
  assert.equal(s.boss.health,585);assert.equal(s.boss.machine.current,'float');assert.equal(s.brain.shiftPhase,'dodge');
  assert.equal(s.boss.animator.frame,2);assert.equal(s.boss.animator.endFrame,7);
  assert.equal(s.brain.opacity,.85);assert.equal(s.brain.invulnerable,true);
  assert.equal(s.brain.intangible,false);assert.equal(s.boss.flashRemaining,0);
  playerStrike(s);assert.equal(s.boss.health,585);
  const x=s.boss.x;s.duel.setPaused(true);s.duel.update(2);
  assert.equal(s.boss.animator.frame,2);s.duel.setPaused(false);
  s.brain.update(6/12-1e-6,s.effects);assert.equal(s.boss.machine.current,'float');assert.equal(s.brain.shiftPhase,'dodge');
  assert.equal(s.boss.animator.frame,7);assert.ok(Math.abs(s.boss.x-x-120)<1e-8);
  s.brain.update(1e-6,s.effects);
  assert.equal(s.boss.machine.current,'attack_3');assert.equal(s.boss.animator.frame,0);
  assert.equal(s.boss.animator.endFrame,23);assert.equal(s.brain.opacity,1);
  assert.equal(s.brain.invulnerable,false);assert.equal(s.brain.reason,'dodgeCounter');
  s.brain.shiftCooldown=0;s.duel.events.push({type:'damage',target:s.boss,amount:15});s.duel.applyEvents();
  assert.equal(s.boss.health,570);assert.equal(s.brain.shiftPending,true);
  s.brain.update(7/12-1e-6,s.effects);s.duel.applyEvents();assert.equal(s.player.health,100);
  s.brain.update(1e-6,s.effects);s.duel.applyEvents();assert.equal(s.player.health,85);
  s.brain.update(17/12-1e-6,s.effects);assert.equal(s.boss.machine.current,'attack_3');
  assert.equal(s.boss.animator.frame,23);
  s.brain.update(1e-6,s.effects);assert.equal(s.boss.machine.current,'shift');
  s.duel.reset();assert.equal(s.brain.opacity,1);assert.equal(s.brain.combo.length,0);
});

test('damage queues shift at 65%, preserving the full current attack before shifting', () => {
  for(const roll of [.6499,.65]) {
    const s=setup(()=>roll);s.duel.introRemaining=0;s.boss.x=360;s.player.x=300;
    s.brain.startAttack('attack_2');playerStrike(s);
    assert.equal(s.boss.health,585);
    assert.equal(s.boss.machine.current,'attack_2');
    assert.equal(s.brain.shiftPending,roll<.65);
    s.brain.update(17/12-1e-6,s.effects);assert.equal(s.boss.machine.current,'attack_2');
    s.brain.update(1e-6,s.effects);
    if(roll<.65) {
      assert.equal(s.boss.machine.current,'shift');assert.equal(s.brain.shiftCooldown,3);
      assert.equal(s.brain.shiftPending,false);
    } else assert.ok(s.boss.canMove);
  }
  const s=setup(()=>.5);s.brain.startShift();s.brain.rest();s.brain.reactToHit();
  assert.notEqual(s.boss.machine.current,'shift');
  s.brain.decisionRemaining=4;s.brain.update(3,s.effects);s.brain.reactToHit();
  assert.equal(s.boss.machine.current,'shift');
  for(const state of ['shift','down','defeated']) {
    s.boss.machine.change(state,true);s.boss.animator.frame=2;s.brain.shiftCooldown=0;
    s.brain.reactToHit();assert.equal(s.boss.machine.current,state);assert.equal(s.boss.animator.frame,2);
  }
});

test('first opening hit triggers shift early once, including under paused intro timing', () => {
  const s=setup();s.boss.x=360;s.player.x=300;
  s.duel.setPaused(true);s.duel.update(10);assert.equal(s.boss.machine.current,'idle');
  s.duel.setPaused(false);s.duel.update(.5);playerStrike(s);
  assert.equal(s.boss.health,585);assert.equal(s.boss.machine.current,'shift');
  assert.equal(s.duel.introRemaining,0);assert.equal(s.brain.openingShiftDone,true);
  s.duel.update(2.5);assert.equal(s.brain.shiftPhase,'appear');
  s.brain.rest();s.brain.shiftCooldown=0;playerStrike(s);
  assert.notEqual(s.boss.machine.current,'shift');
  s.duel.reset();assert.equal(s.brain.openingShiftDone,false);assert.equal(s.brain.shiftPending,false);
});

test('queued shift waits through the whole combo and is cancelled by posture break', () => {
  const s=setup(()=>.3);s.brain.startAttack('attack_7');
  s.brain.update(5/12,s.effects);s.brain.reactToHit();
  assert.equal(s.brain.shiftPending,true);assert.equal(s.boss.animator.frame,5);
  s.brain.update((23+7+5)/12,s.effects);assert.equal(s.boss.machine.current,'attack_1');
  assert.equal(s.brain.shiftPending,true);assert.equal(s.boss.animator.frame,7);
  s.brain.update(13/12-1e-6,s.effects);assert.equal(s.boss.machine.current,'attack_1');
  s.brain.update(1e-6,s.effects);assert.equal(s.boss.machine.current,'shift');
  assert.equal(s.boss.animator.frame,0);assert.equal(s.brain.combo.length,0);
  s.brain.shiftCooldown=0;s.brain.startCombo();s.brain.reactToHit();
  s.duel.events.push({type:'posture',target:s.boss,amount:60});s.duel.applyEvents();
  assert.equal(s.boss.machine.current,'down');assert.equal(s.brain.shiftPending,false);
  s.duel.reset();assert.equal(s.brain.shiftPending,false);
});

test('shift landing selects immediate attack below 80% and appearance at the boundary', () => {
  for(const roll of [.7999,.8]) {
    const s=setup(()=>roll);s.brain.startShift();s.brain.update(10/12+1,s.effects);
    assert.equal(s.boss.machine.current,roll<.8?'attack_9':'shift');
  }
});

test('damage during attack 7 preserves every followup before the queued shift', () => {
  for(const fromShift of [false,true]) {
    const s=setup(()=>.2);s.duel.introRemaining=0;
    s.brain.startAttack('attack_7',false,{fromShift});
    const moves=['attack_7','attack_2','attack_2','attack_1'];
    for(let i=0;i<moves.length;i++) {
      assert.equal(s.boss.machine.current,moves[i]);
      const frame=s.boss.animator.frame;
      s.duel.events.push({type:'damage',target:s.boss,amount:15});s.duel.applyEvents();
      assert.equal(s.boss.machine.current,moves[i]);assert.equal(s.boss.animator.frame,frame);
      assert.equal(s.brain.shiftPending,true);
      s.brain.update((s.boss.animator.endFrame-frame+1)/12,s.effects);
    }
    assert.equal(s.boss.health,540);assert.equal(s.boss.machine.current,'shift');
    assert.equal(s.brain.shiftPending,false);assert.equal(s.brain.combo.length,0);
  }
});

test('shift attack selection includes 7, 1 and distant thrust 9, never 5 or 10', () => {
  for(const [roll,name] of [[0,'attack_7'],[.3334,'attack_1'],[.6667,'attack_9'],[.999,'attack_9']]) {
    const rolls=[0,.5,roll];const s=setup(()=>rolls.shift()??.99);
    s.brain.startShift();s.brain.update(10/12+1,s.effects);
    assert.equal(s.boss.machine.current,name);
    assert.equal(s.boss.animator.frame,name==='attack_9'?0:4);
    assert.equal(s.brain.reason,'shiftAttack');assert.equal(s.brain.invulnerable,false);
    assert.equal(s.effects.mists.length,2);
  }
});

test('reduced ghost parry posture breaks exactly at the threshold for every move', () => {
  for(const name of Object.keys(GHOST_ATTACKS)) for(const heavy of (name==='attack_1'?[false,true]:[false])) {
    const gain=name==='attack_1'?6:3;
    for(const deficit of [gain,gain+1]) {
      const s=setup();s.boss.x=400;s.player.x=name==='attack_9'?342:300;
      s.brain.startAttack(name,false,{fromShift:heavy});s.boss.posture=60-deficit;
      s.player.machine.change('defend_1',true);
      const frame=Number(Object.keys(GHOST_ATTACKS[name].hits)[0]);
      const parries=[];s.effects.parry=(_target,_heavy,breaks)=>parries.push(breaks);
      resolveAttackHits(s.boss,[s.player],frame,s.effects);s.duel.applyEvents();
      assert.equal(s.boss.posture,60-deficit+gain);
      assert.equal(s.boss.machine.current,deficit===gain?'down':name);
      assert.deepEqual(parries,[deficit===gain]);
    }
  }
});

test('all attack 1 entries have heavy hit, guard, posture, particles and audio feedback', () => {
  for(const context of ['ordinary','shift','combo','shiftCombo']) for(const guarded of [false,true]) {
    const s=setup();s.boss.x=400;s.player.x=300;
    const heavy=true;
    if(context.endsWith('Combo') || context==='combo') {
      s.brain.startAttack('attack_7',false,{fromShift:context==='shiftCombo'});
      for(let i=0;i<3;i++)s.brain.finishAction();
      assert.equal(s.boss.machine.current,'attack_1');
    } else s.brain.startAttack('attack_1',false,{fromShift:context==='shift'});
    if(guarded)s.player.machine.change('defend_1',true);
    resolveAttackHits(s.boss,[s.player],14,s.effects);s.duel.applyEvents();
    assert.equal(Math.abs(s.player.knockbackVelocity),heavy?960:guarded?180:360);
    assert.equal(s.player.machine.current,guarded?(heavy?'defend_3':'defend_1'):'hit');
    assert.equal(s.player.health,guarded?100:85);assert.equal(s.boss.posture,guarded?(heavy?6:3):0);
    if(guarded)assert.equal(s.effects.bursts[0].style==='heavy',heavy);
    else assert.equal(s.effects.hits[0].heavy,heavy);
    const audio=Object.create(GameAudio.prototype),calls=[];
    audio.effect=(...args)=>calls.push(args);
    audio.swing(s.boss);audio.impact(s.boss,s.player);
    assert.ok(calls.every(args=>args[2]===heavy));
    s.brain.startAttack('attack_2');audio.swing(s.boss);assert.equal(calls.at(-1)[2],false);
  }
});

for(const n of [1,5,7,10]) for(const facing of [-1,1]) test(`attack ${n} preserves authored travel, collision position and final landing facing ${facing}`,()=>{
  const s=setup();s.boss.x=480;s.player.x=facing===1?880:80;s.brain.startAttack(`attack_${n}`);
  const clip=s.boss.animator.clip, start=s.boss.x;
  const lastFrame=s.boss.animator.endFrame;
  for(let f=0;f<=lastFrame;f++) {
    if(f)s.brain.update(1/12,s.effects);
    assert.equal(s.boss.animator.frame,f);
    assert.ok(Math.abs(s.boss.x-(start+facing*clip.rootXs[f]*2*.85))<1e-8);
    // Keep the body anchor centered while reducing authored travel by 15%.
    assert.equal(s.boss.animator.anchor.x,64+clip.rootXs[f]);
    const body=getBodyBox(s.boss);assert.equal(body.x+body.width/2,s.boss.x);
  }
  const end=s.boss.x;s.brain.update(1/12,s.effects);
  if(n===7) { assert.equal(s.boss.machine.current,'attack_2');assert.equal(s.boss.animator.frame,5); }
  else assert.ok(s.boss.canMove);
  assert.equal(s.boss.x,end);
  assert.ok(Math.abs(end-start-facing*({1:34,5:2,7:84,10:2}[n])*.85)<1e-8);
  s.brain.startAttack(`attack_${n}`);assert.equal(s.boss.x,end);
  assert.equal(s.boss.animator.frame,0);
});

test('authored motion respects the wall and player body, and survives interruption',()=>{
  const s=setup();s.boss.x=830;s.player.x=896;s.brain.startAttack('attack_7');
  s.brain.update(25/12,s.effects);
  assert.ok(s.player.x<=896);assert.ok(s.boss.x<=842);
  const b=getBodyBox(s.boss),p=getBodyBox(s.player);assert.ok(b.x+b.width<=p.x+1e-8);
  const x=s.boss.x;s.duel.events.push({type:'posture',target:s.boss,amount:60});s.duel.applyEvents();
  assert.equal(s.boss.machine.current,'down');assert.equal(s.boss.x,x);
  s.duel.reset();assert.equal(s.boss.x,704);assert.equal(s.brain.rootOffset,0);
});

test('shift retains exact fade/wait/invulnerability and can resume its second half', () => {
  for(const px of [80,480,880]) {
    const s=setup();s.player.x=px;const old=s.boss.x;s.brain.startShift();
    s.brain.update(4/12,s.effects);assert.equal(s.brain.invulnerable,true);assert.equal(s.brain.opacity,1);
    s.brain.update(3/12,s.effects);assert.ok(Math.abs(s.brain.opacity-.5)<1e-8);
    s.brain.update(3/12,s.effects);assert.equal(s.brain.shiftPhase,'hidden');assert.equal(s.brain.opacity,0);
    assert.equal(s.boss.x,old);assert.equal(s.effects.mists.length,1);
    s.brain.update(.99,s.effects);assert.equal(s.boss.x,old);assert.equal(s.brain.invulnerable,true);
    s.brain.update(.01,s.effects);assert.equal(s.brain.shiftPhase,'appear');assert.equal(s.boss.animator.frame,10);
    assert.equal(Math.sign(s.boss.x-px),px<=480?1:-1);
    assert.ok(Math.abs(s.boss.x-px)>=320);assert.ok(Math.abs(s.boss.x-px)<=420);
    assert.ok(s.boss.x>=64&&s.boss.x<=896);assert.equal(s.effects.mists.length,2);
    s.brain.update(6/12,s.effects);assert.equal(s.brain.invulnerable,false);assert.equal(s.brain.opacity,1);
  }
});

test('shift can start attack 7 immediately at landing, with mist and no residual invulnerability',()=>{
  for(const px of [80,880]) {
    const s=setup(()=>.2);s.player.x=px;s.brain.startShift();
    s.brain.update(10/12+1,s.effects);
    assert.equal(s.boss.machine.current,'attack_7');assert.equal(s.boss.animator.frame,4);
    assert.equal(s.brain.shiftPhase,null);assert.equal(s.brain.reason,'shiftAttack');
    assert.equal(s.brain.invulnerable,false);assert.equal(s.brain.opacity,1);
    assert.equal(Math.sign(s.boss.x-px),px<480?1:-1);
    assert.equal(s.boss.facing,Math.sign(px-s.boss.x));assert.equal(s.effects.mists.length,2);
    const start=s.boss.x,offsets=s.boss.animator.clip.rootXs;
    assert.equal(s.brain.rootOffset,offsets[4]);
    s.brain.update(1/12,s.effects);
    assert.ok(Math.abs(s.boss.x-start-(offsets[5]-offsets[4])*s.boss.scale*s.boss.facing*.85)<1e-8);
  }
});

test('shift can choose attack 1 from frame 5 without replaying skipped root motion',()=>{
  for(const px of [80,880]) {
    const s=setup(()=>.6);s.player.x=px;s.brain.startShift();
    s.brain.update(10/12+1,s.effects);
    assert.equal(s.boss.machine.current,'attack_1');assert.equal(s.boss.animator.frame,4);
    assert.equal(s.brain.reason,'shiftAttack');assert.equal(s.brain.invulnerable,false);
    assert.equal(s.brain.opacity,1);assert.equal(s.effects.mists.length,2);
    const start=s.boss.x,facing=s.boss.facing;
    s.brain.update(1/120,s.effects);assert.equal(s.boss.x,start);
    s.brain.update(16/12-1/120,s.effects);
    assert.ok(s.boss.canMove);assert.equal(s.brain.heavyAttack,false);
    assert.ok(Math.abs(s.boss.x-start-facing*28*.85)<1e-8);
  }
});

test('successful player parry faces the actual source for both bosses and heavy attacks',()=>{
  for(const appearance of ['ghost','boss']) for(const facing of [-1,1]) for(const heavy of [false,true]) {
    if(appearance==='ghost' && heavy)continue;
    const s=setup();const attacker=appearance==='ghost'?s.boss:new Actor('boss',400,428);
    attacker.x=400;attacker.facing=facing;s.player.x=400+facing*100;s.player.facing=facing;
    attacker.machine.change(heavy?'jump_attack':'attack_1',true);
    s.player.machine.change('defend_1',true);
    resolveAttackHits(attacker,[s.player],appearance==='ghost'?14:12,s.effects);
    assert.equal(s.player.facing,-facing);assert.equal(s.player.health,100);
    assert.ok(s.player.isGuarding);assert.equal(s.effects.bursts.length,1);
    assert.equal(Math.sign(s.player.knockbackVelocity),facing);
  }
});

test('hidden ghost does not block the player; pause and restart reset shift and mist', () => {
  const s=setup();s.duel.introRemaining=0;s.brain.startShift();s.duel.update(10/12);
  const wait=s.brain.shiftRemaining;s.duel.setPaused(true);s.duel.update(4);
  assert.equal(s.brain.shiftRemaining,wait);assert.equal(s.brain.opacity,0);
  s.player.x=s.boss.x-70;s.player.update(.8,1,[],[s.boss]);assert.ok(s.player.x>s.boss.x);
  s.duel.reset();assert.equal(s.brain.opacity,1);assert.equal(s.brain.invulnerable,false);assert.equal(s.effects.mists.length,0);
});

test('pixel mist uses the same 2px grid as the sprites',()=>{
  const s=setup();s.effects.ghostMist(s.boss,false);s.effects.ghostMist(s.boss,true);
  const ctx={save(){},restore(){},fillRect(...values){for(const n of values)assert.equal(Math.abs(n%2),0)}};
  for(let i=0;i<40;i++){drawGhostMist(ctx,s.effects.mists);s.effects.update(.025)}
  assert.equal(s.effects.mists.length,0);
});

test('ghost kneels for two seconds and any nonlethal hit during rising immediately counters', () => {
  const s=setup();s.duel.introRemaining=0;
  s.duel.events.push({type:'posture',target:s.boss,amount:60});s.duel.applyEvents();
  assert.equal(s.duel.downRemaining,2);
  s.duel.update(8/12+1);assert.equal(s.boss.machine.current,'down');
  assert.ok(Math.abs(s.boss.posture-30)<1e-8);
  s.duel.events.push({type:'damage',target:s.boss,amount:15});s.duel.applyEvents();
  assert.equal(s.boss.machine.current,'down');
  s.duel.update(1-1e-6);assert.equal(s.boss.machine.current,'down');
  s.duel.update(1e-6);assert.equal(s.boss.machine.current,'up');assert.equal(s.boss.posture,0);
  s.duel.events.push({type:'damage',target:s.boss,amount:15});s.duel.applyEvents();
  assert.equal(s.boss.health,570);assert.equal(s.boss.machine.current,'float');
  assert.equal(s.boss.animator.frame,2);assert.equal(s.brain.isDodging,true);
  s.brain.update(.5,s.effects);assert.equal(s.boss.machine.current,'attack_3');
  s.duel.reset();s.duel.introRemaining=0;s.boss.health=1;s.boss.machine.change('up',true);
  s.duel.events.push({type:'damage',target:s.boss,amount:15});s.duel.applyEvents();
  assert.equal(s.boss.machine.current,'defeated');assert.equal(s.duel.phase,'victory');
});

test('shift thrust appears at the farthest arena end, aimed at the player', () => {
  for(const playerX of [80,480,880]) {
    const rolls=[0,.5,.99];const s=setup(()=>rolls.shift()??.99);s.player.x=playerX;
    s.brain.startShift();s.brain.update(10/12+1,s.effects);
    assert.equal(s.boss.machine.current,'attack_9');assert.equal(s.boss.animator.frame,0);
    assert.equal(s.boss.x,playerX<=480?896:64);
    assert.equal(s.boss.facing,playerX<=480?-1:1);assert.equal(s.effects.mists.length,2);
  }
});

test('thrust accelerates after windup with the same travel across different update sizes', () => {
  for(const step of [1/120,.1]) {
    const s=setup();s.boss.x=64;s.player.x=896;s.brain.startAttack('attack_9');
    s.brain.update(.25,s.effects);assert.equal(s.boss.x,64);
    let previous=0;
    for(let segment=0;segment<3;segment++) {
      const before=s.boss.x;
      for(let i=0;i<Math.round(.1/step);i++)s.brain.update(step,s.effects);
      const distance=s.boss.x-before;assert.ok(distance>previous);previous=distance;
    }
    assert.ok(Math.abs(s.boss.x-262)<1e-8);
    const attack=getAttackBox(s.boss),body=getBodyBox(s.boss);
    assert.equal(attack.width-body.width,20);assert.equal(attack.height,44);
  }
});

test('thrust holds frame 10 until collision, then stops and deals exactly one hit or parry', () => {
  for(const facing of [-1,1]) for(const guarded of [false,true]) {
    const s=setup();s.boss.x=facing===1?64:896;s.player.x=facing===1?896:64;
    s.brain.startAttack('attack_9');if(guarded)s.player.machine.change('defend_1',true);
    let hits=0,parries=0;s.effects.damage=()=>hits++;s.effects.parry=()=>parries++;
    s.brain.update(.9,s.effects);
    assert.equal(s.boss.animator.frame,9);assert.equal(s.brain.thrustRecovering,false);
    const x=s.boss.x;s.boss.animator.paused=true;s.brain.update(.5,s.effects);assert.equal(s.boss.x,x);
    s.boss.animator.paused=false;
    for(let i=0;i<120&&!s.brain.thrustRecovering;i++)s.brain.update(1/120,s.effects);
    assert.equal(s.brain.thrustRecovering,true);assert.equal(s.boss.animator.frame,10);
    assert.equal(hits,guarded?0:1);assert.equal(parries,guarded?1:0);
    const body=getBodyBox(s.boss),player=getBodyBox(s.player);
    assert.ok(facing===1?body.x+body.width<=player.x:player.x+player.width<=body.x);
    const stop=s.boss.x;s.brain.update(.6,s.effects);assert.equal(s.boss.x,stop);
    assert.equal(getAttackBox(s.boss),null);assert.equal(hits+parries,1);
    s.brain.update((s.boss.animator.endFrame-s.boss.animator.frame+1)/12-s.boss.animator.elapsed,s.effects);
    assert.ok(s.boss.canMove);assert.equal(hits+parries,1);
  }
});

test('ghost victory unlocks its hard mode and restart supports both difficulties',()=>{
  const s=setup();s.duel.events.push({type:'damage',target:s.boss,amount:600});s.duel.applyEvents();
  assert.equal(s.boss.machine.current,'defeated');s.duel.update(4);assert.equal(s.duel.phase,'won');assert.equal(s.duel.hardUnlocked,true);
  assert.equal(s.duel.reset('hard'),true);assert.equal(s.boss.health,800);assert.equal(s.boss.maxPosture,80);
  assert.equal(s.duel.downSeconds,2);assert.equal(s.player.health,100);
  s.duel.reset('normal');assert.equal(s.boss.maxPosture,60);
  s.duel.reset();assert.equal(s.duel.phase,'playing');assert.equal(s.boss.health,600);
  s.duel.events.push({type:'damage',target:s.player,amount:100});s.duel.applyEvents();s.duel.update(4);assert.equal(s.duel.phase,'dead');
});
