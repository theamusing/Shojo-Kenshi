import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { Duel, ROUND_RULES, FINISHER } from '../src/duel.js';
import { resolveAttackHits, getAttackBox } from '../src/combat.js';

function setup(options = {}) {
  const player = new Actor('player', 260, 420), boss = new Actor('boss', 340, 420, -1);
  const duel = new Duel(player, boss, { introDuration: 0, random: () => .99, ...options });
  return { duel, player, boss };
}
function bossStrike(scene, name, frame, guard = false) {
  const { duel, player, boss } = scene;
  player.x = 260; boss.x = 340; player.resume(); boss.resume();
  boss.machine.change(name, true); boss.facing = -1;
  if (guard) player.machine.change('defend_1');
  resolveAttackHits(boss, [player], frame, duel.effects);
  duel.applyEvents();
}
function playerStrike(scene, stage = 1) {
  const { duel, player, boss } = scene;
  player.x = 260; boss.x = 340; player.facing = 1;
  player.machine.change('attack', true); player.startAttackSegment(stage);
  resolveAttackHits(player, [boss], stage === 1 ? 5 : 13, duel.effects);
  duel.applyEvents();
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('round begins full, boss idles for three seconds, intro and battle clock pause together', () => {
  const { duel, player, boss } = setup({ introDuration: 3, random: () => 0 });
  assert.equal(player.health, 100); assert.equal(boss.health, 600); assert.equal(boss.posture, 0);
  duel.update(2.9, 1, ['attack']);
  assert.equal(boss.machine.current, 'idle'); assert.equal(boss.x, 340); assert.equal(player.health, 100);
  close(duel.introRemaining, .1);
  const elapsed = duel.elapsed; duel.setPaused(true); duel.update(30);
  close(duel.elapsed, elapsed); close(duel.introRemaining, .1);
  duel.setPaused(false); duel.update(.1); close(duel.introRemaining, 0);
  assert.equal(boss.machine.current, 'idle');
  duel.update(.6); assert.equal(boss.machine.current, 'attack_1');
});

test('player combo deals 15 then 20, active frames never deal duplicate damage', () => {
  const scene = setup(); const { duel, player, boss } = scene;
  playerStrike(scene, 1); assert.equal(boss.health, 585);
  resolveAttackHits(player, [boss], 5, duel.effects); duel.applyEvents(); assert.equal(boss.health, 585);
  playerStrike(scene, 2); assert.equal(boss.health, 565);
  player.startAttackRecovery(5);
  resolveAttackHits(player, [boss], 5, duel.effects); duel.applyEvents(); assert.equal(boss.health, 565);
});

test('boss takes full damage while falling, kneeling and rising', () => {
  const scene = setup(); const { boss } = scene;
  boss.machine.change('down');
  playerStrike(scene, 1); assert.equal(boss.health, 585);
  boss.animator.update(10 / 12);
  playerStrike(scene, 2); assert.equal(boss.health, 565);
  boss.machine.change('up');
  playerStrike(scene, 1); assert.equal(boss.health, 550);
  playerStrike(scene, 2); assert.equal(boss.health, 530);
});

test('half health increases close attacks at the threshold and reset restores normal behavior', () => {
  for (const [health, expected] of [[600, 'run'], [301, 'run'], [300, 'attack_3'], [299, 'attack_3']]) {
    const { duel, player, boss } = setup({ random: () => .7 });
    player.x = 600; boss.x = 704; boss.health = health;
    duel.brain.decide(); assert.equal(boss.machine.current, expected, `health ${health}`);
    duel.reset(); assert.equal(duel.brain.lowHealth, false);
  }
});

test('low-health aggression increases ranged jumps and thrust followups without allowing consecutive jumps', () => {
  for (const health of [600, 300]) {
    const { duel, boss } = setup({ random: () => .1 }); boss.x = 704; boss.health = health;
    duel.brain.decide(); assert.equal(boss.machine.current, health === 300 ? 'jump_attack' : 'run');
    boss.machine.change('idle'); duel.brain.lastAttack = 'jump_attack'; duel.brain.decide();
    assert.notEqual(boss.machine.current, 'jump_attack');
    duel.brain.random = () => .3;
    duel.brain.startAttack('attack_3'); duel.brain.update(18 / 12);
    assert.equal(boss.machine.current, health === 300 ? 'jump_attack' : 'run');
  }
});

test('each boss move deals its configured damage; the two strikes each deal ten', () => {
  for (const [name, frame, damage] of [['attack_1', 12, 15], ['attack_2', 11, 10], ['attack_2', 17, 10], ['attack_3', 10, 15], ['jump_attack', 12, 30]]) {
    const scene = setup(); bossStrike(scene, name, frame);
    assert.equal(scene.player.health, 100 - damage, name);
    assert.equal(scene.duel.damageTaken, damage); assert.equal(scene.duel.noDamage, false);
    resolveAttackHits(scene.boss, [scene.player], frame, scene.duel.effects); scene.duel.applyEvents();
    assert.equal(scene.player.health, 100 - damage);
  }
  const scene = setup(); bossStrike(scene, 'attack_2', 11);
  scene.player.x = 260; resolveAttackHits(scene.boss, [scene.player], 17, scene.duel.effects); scene.duel.applyEvents();
  assert.equal(scene.player.health, 80);
});

test('normal and heavy parries add 5 and 10 posture, never health damage', () => {
  const scene = setup(); bossStrike(scene, 'attack_1', 12, true);
  assert.equal(scene.boss.posture, 5);
  bossStrike(scene, 'jump_attack', 12, true);
  assert.equal(scene.boss.posture, 15); assert.equal(scene.player.health, 100);
  assert.equal(scene.duel.noDamage, true); assert.equal(scene.player.machine.current, 'defend_3');
});

test('twelfth normal parry breaks posture, interrupts attacks, and holds last down frame for three seconds', () => {
  const scene = setup(); const { duel, player, boss } = scene;
  for (let i = 0; i < 12; i++) bossStrike(scene, 'attack_1', 12, true);
  assert.equal(boss.posture, 60); assert.equal(boss.machine.current, 'down'); assert.equal(getAttackBox(boss, 12), null);
  player.resume();
  duel.update(10 / 12);
  assert.equal(boss.animator.frame, 9); assert.equal(boss.animator.finished, true); close(boss.posture, 60);
  duel.update(1.5); assert.equal(boss.animator.frame, 9); close(boss.posture, 30);
  const before = duel.downRemaining; duel.setPaused(true); duel.update(20); close(duel.downRemaining, before);
  duel.setPaused(false);
  playerStrike(scene, 1); assert.equal(boss.health, 585); assert.equal(boss.machine.current, 'down');
  player.resume(); duel.update(1.5);
  assert.equal(boss.posture, 0); assert.equal(boss.machine.current, 'up');
  duel.update(11 / 12); assert.equal(boss.machine.current, 'idle'); assert.equal(player.health, 100);
});

test('heavy guard clamps posture at 60 and starts down immediately at frame boundary', () => {
  const { duel, player, boss } = setup(); boss.posture = 55;
  boss.machine.change('jump_attack'); boss.animator.frame = 11; boss.animator.elapsed = 1 / 12 - 1 / 240;
  duel.update(1 / 120, 0, ['defend']);
  assert.equal(boss.posture, 60); assert.equal(boss.machine.current, 'down');
  assert.equal(boss.animator.frame, 0); assert.equal(player.machine.current, 'defend_3');
  assert.equal(player.health, 100);
});

test('defeat can interrupt knockdown; victory waits for its animation and freezes combat time', () => {
  const scene = setup(); const { duel, boss, player } = scene;
  duel.update(.4); const elapsed = duel.elapsed;
  boss.machine.change('down'); boss.health = 10;
  playerStrike(scene, 2);
  assert.equal(boss.health, 0); assert.equal(duel.phase, 'victory'); assert.equal(boss.machine.current, 'defeated');
  assert.equal(getAttackBox(boss, 12), null);
  duel.update(.5, 1, ['attack', 'defend']); assert.equal(duel.phase, 'victory'); close(duel.elapsed, elapsed);
  duel.update(1.27); assert.equal(duel.phase, 'won'); assert.equal(boss.animator.frame, 14);
  assert.equal(duel.noDamage, true); assert.equal(player.health, 100);
  duel.update(10, -1, ['attack']); assert.equal(boss.animator.frame, 14); close(duel.elapsed, elapsed);
});

test('lethal player strike stops an enemy active frame in the same simulation slice', () => {
  const { duel, player, boss } = setup(); boss.health = 15;
  player.machine.change('attack'); player.animator.frame = 5;
  boss.machine.change('attack_1'); boss.animator.frame = 12;
  duel.update(1 / 120);
  assert.equal(duel.phase, 'victory'); assert.equal(player.health, 100);
});

test('finishing blow slows both actors, pauses, restores normal time and resets cleanly', () => {
  const scene = setup(), { duel, player, boss } = scene;
  boss.health = 15; playerStrike(scene);
  assert.equal(duel.finisherActive, true); assert.equal(duel.finisherOpacity, 1);
  const elapsed = duel.elapsed;
  duel.update(.4, -1, ['defend']);
  assert.equal(boss.animator.frame, 0); // .4 real seconds advances only .08 seconds.
  assert.equal(player.machine.current, 'attack'); assert.equal(player.animator.frame, 1);
  duel.setPaused(true); duel.update(10); close(duel.endTime, .4);
  duel.setPaused(false); duel.update(.2);
  assert.ok(duel.finisherOpacity > 0 && duel.finisherOpacity < 1);
  duel.update(.05);
  assert.equal(duel.finisherActive, false); assert.equal(duel.finisherOpacity, 0);
  assert.equal(duel.phase, 'victory'); close(duel.elapsed, elapsed);
  duel.update(1.25 - FINISHER.duration * FINISHER.speed);
  assert.equal(duel.phase, 'won'); assert.equal(boss.animator.frame, 14);
  duel.reset(); assert.equal(duel.finisherActive, false); assert.equal(boss.machine.current, 'idle');
});

test('finisher timing agrees across a large update crossing its slow-motion boundary', () => {
  const a = setup(), b = setup();
  for (const scene of [a, b]) { scene.boss.health = 15; playerStrike(scene); }
  a.duel.update(.9);
  for (let i = 0; i < 90; i++) b.duel.update(.01);
  assert.equal(a.boss.animator.frame, b.boss.animator.frame);
  close(a.boss.animator.elapsed, b.boss.animator.elapsed);
  assert.equal(a.player.animator.frame, b.player.animator.frame);
  assert.equal(a.duel.finisherActive, false);
});

test('player death keeps hit locked at quarter speed and stops all new damage or input', () => {
  const scene = setup(); const { duel, player, boss } = scene;
  player.health = 10; bossStrike(scene, 'attack_1', 12);
  assert.equal(player.health, 0); assert.equal(duel.phase, 'dying'); assert.equal(duel.canRestart, false);
  const elapsed = duel.elapsed;
  duel.update(1, 1, ['attack', 'defend']);
  assert.equal(player.machine.current, 'hit'); assert.equal(player.animator.frame, 3); assert.equal(duel.phase, 'dying');
  assert.equal(boss.health, 600); close(duel.elapsed, elapsed);
  duel.setPaused(true); duel.update(30); assert.equal(player.animator.frame, 3);
  duel.setPaused(false); duel.update(8 / 12 / ROUND_RULES.deathSpeed - 1);
  assert.equal(duel.phase, 'dead'); assert.equal(player.animator.frame, 7); assert.equal(duel.canRestart, true);
  duel.effects.damage(player, 30); duel.applyEvents(); assert.equal(player.health, 0);
});

test('reset restores health, posture, positions, intro, timer, no-damage flag and input state', () => {
  const scene = setup({ introDuration: 3 }); const { duel, player, boss } = scene;
  bossStrike(scene, 'jump_attack', 12); player.x = 64; boss.x = 700;
  boss.posture = 50; duel.elapsed = 42; duel.setPaused(true); duel.reset();
  assert.equal(player.health, 100); assert.equal(boss.health, 600); assert.equal(boss.posture, 0);
  assert.equal(player.x, 260); assert.equal(boss.x, 340); assert.equal(duel.introRemaining, 3);
  assert.equal(duel.elapsed, 0); assert.equal(duel.noDamage, true); assert.equal(duel.phase, 'playing');
  assert.equal(duel.paused, false); assert.equal(player.machine.current, 'idle'); assert.equal(boss.machine.current, 'idle');
  assert.equal(duel.effects.bursts.length, 0); assert.equal(duel.events.length, 0);
});

test('uneven updates preserve the knockdown window and time', () => {
  const a = setup(), b = setup();
  for (const scene of [a, b]) {
    scene.boss.posture = 55; bossStrike(scene, 'attack_1', 12, true); scene.player.resume();
  }
  a.duel.update(4.9);
  for (let i = 0; i < 490; i++) b.duel.update(.01);
  assert.equal(a.boss.machine.current, b.boss.machine.current);
  close(a.boss.posture, b.boss.posture); close(a.duel.elapsed, b.duel.elapsed);
});
