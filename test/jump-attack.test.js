import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { BossBrain } from '../src/boss.js';
import { getAttackBox, getHurtbox, resolveAttackHits } from '../src/combat.js';
import { getBodyBox } from '../src/physics.js';
import { Duel } from '../src/duel.js';

function setup(playerX = 500, bossX = 620, random = () => .99) {
  const player = new Actor('player', playerX, 420);
  const boss = new Actor('boss', bossX, 420, Math.sign(playerX - bossX));
  const brain = new BossBrain(boss, player, { random });
  return { player, boss, brain };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('jump rises with its collision boxes, pauses in air, and lands for frame 13', () => {
  const { boss, brain } = setup();
  const bodyY = getBodyBox(boss).y, hurtY = getHurtbox(boss).y;
  brain.startAttack('jump_attack'); brain.update(3 / 12);
  assert.equal(boss.elevation, 0);
  brain.update(4.5 / 12);
  assert.equal(boss.elevation, 32);
  assert.equal(getBodyBox(boss).y, bodyY - 32);
  assert.equal(getHurtbox(boss).y, hurtY - 32);
  const translations = [];
  boss.draw({ save() {}, restore() {}, translate(...xy) { translations.push(xy); }, scale() {}, drawImage() {} }, new Map());
  assert.deepEqual(translations, [[boss.x, 390]]);
  boss.animator.paused = true; brain.update(1); assert.equal(boss.elevation, 32);
  boss.animator.paused = false; brain.update(4.5 / 12);
  assert.equal(boss.animator.frame, 12); assert.equal(boss.elevation, 0);
  assert.equal(getBodyBox(boss).y, bodyY); assert.equal(getHurtbox(boss).y, hurtY);
  boss.preview('jump_attack'); boss.update(7.5 / 12); assert.equal(boss.elevation, 32);
  boss.resume(); assert.equal(boss.elevation, 0);
});

test('jump travels only during frames 4–12 in either direction and strikes on frame 13', () => {
  for (const [playerX, bossX, facing] of [[300, 700, -1], [700, 300, 1]]) {
    const { player, boss, brain } = setup(playerX, bossX);
    brain.startAttack('jump_attack');
    for (let frame = 0; frame < 19; frame++) assert.equal(!!getAttackBox(boss, frame), frame === 12);
    brain.update(3 / 12);
    close(boss.x, bossX); assert.equal(boss.animator.frame, 3);
    brain.update(1 / 12); close(boss.x, bossX + facing * 30);
    brain.update(7.5 / 12); assert.equal(player.machine.current, 'idle');
    brain.update(.5 / 12);
    close(boss.x, bossX + facing * 270);
    assert.equal(boss.animator.frame, 12); assert.equal(player.machine.current, 'hit');
    assert.equal(player.facing, -facing);
    const landingX = boss.x;
    brain.update(7 / 12); close(boss.x, landingX); assert.equal(boss.machine.current, 'idle');
  }
});

test('jump stops closing at 120px and never turns or travels backward mid-attack', () => {
  const { player, boss, brain } = setup(500, 700);
  brain.startAttack('jump_attack'); brain.update(1);
  close(boss.x, 620); close(player.x, 500);
  const near = setup(550, 650);
  near.brain.startAttack('jump_attack'); near.brain.update(1); close(near.boss.x, 650);
  const crossed = setup(300, 700);
  crossed.brain.startAttack('jump_attack'); crossed.brain.update(3 / 12);
  crossed.player.x = 850; crossed.brain.update(9 / 12);
  close(crossed.boss.x, 700); assert.equal(crossed.boss.facing, -1);
  assert.equal(crossed.player.machine.current, 'idle');
});

test('large and small boss updates produce the same jump travel and a single impact', () => {
  const results = [];
  for (const steps of [1, 120]) {
    const { player, boss, brain } = setup(300, 700);
    let hits = 0; const receiveHit = player.receiveHit.bind(player);
    player.receiveHit = (...args) => { hits++; receiveHit(...args); };
    brain.startAttack('jump_attack');
    for (let i = 0; i < steps; i++) brain.update(1 / steps);
    brain.update(1 / 24);
    results.push(boss.x); assert.equal(hits, 1); assert.equal(player.machine.current, 'hit');
  }
  close(results[0], results[1]);
});

test('blocking either way triggers defend_3 without damage and matches heavy hit displacement', () => {
  for (const facing of [-1, 1]) {
    const distances = [];
    for (const guard of [null, 'defend_1', 'defend_2']) {
      const { player, boss } = setup(500, 500 - facing * 120);
      boss.machine.change('jump_attack');
      let parries = 0;
      if (guard) {
        player.machine.change(guard);
        player.receiveHit = () => assert.fail('a blocked jump must not cause damage');
      }
      resolveAttackHits(boss, [player], 12, { parry: () => parries++ });
      resolveAttackHits(boss, [player], 12, { parry: () => parries++ });
      assert.equal(parries, guard ? 1 : 0);
      assert.equal(player.machine.current, guard ? 'defend_3' : 'hit');
      assert.equal(player.flashRemaining, guard ? 0 : 1 / 12);
      assert.equal(player.facing, -facing);
      player.update(.5, -facing, ['attack', 'defend'], [boss]);
      assert.equal(player.machine.current, guard ? 'defend_3' : 'hit');
      assert.equal(player.facing, -facing);
      player.update(.25, 0, [], [boss]);
      assert.equal(player.machine.current, 'idle'); assert.equal(player.knockbackVelocity, 0);
      distances.push(Math.abs(player.x - 500));
    }
    close(distances[0], distances[1]); close(distances[0], distances[2]);
    const normal = setup(500, 500 - facing * 120);
    normal.player.receiveHit(normal.boss); normal.player.update(.75, 0, [], [normal.boss]);
    assert.ok(distances[0] > Math.abs(normal.player.x - 500) * 2.5);
  }
});

test('jump selection is rare at range, limited in reach, and cannot repeat after the mandatory rest', () => {
  let jumps = 0;
  for (let i = 0; i < 100; i++) {
    const { boss, brain } = setup(260, 704, () => (i + .5) / 100);
    brain.decide(); if (boss.machine.current === 'jump_attack') jumps++;
  }
  assert.equal(jumps, 10);
  for (const playerX of [64, 600]) {
    const { boss, brain } = setup(playerX, 704, () => 0);
    brain.decide(); assert.notEqual(boss.machine.current, 'jump_attack');
  }
  const { player, boss, brain } = setup(260, 704, () => 0);
  brain.decide(); brain.update(19 / 12);
  assert.equal(boss.machine.current, 'idle'); close(brain.decisionRemaining, .5);
  player.x = 64;
  brain.update(.49); assert.equal(boss.machine.current, 'idle');
  brain.update(.02); assert.equal(boss.machine.current, 'run');
  brain.decide(); assert.notEqual(boss.machine.current, 'jump_attack');
  player.x = boss.x - 120; brain.decide(); assert.equal(boss.machine.current, 'attack_1');
  player.x = 64; brain.decide(); assert.equal(boss.machine.current, 'jump_attack');
});

test('thrust may chain into a jump, while ordinary slashes do not gain that follow-up', () => {
  for (const [attack, roll, expected] of [
    ['attack_3', .1, 'jump_attack'], ['attack_3', .9, 'idle'], ['attack_1', .1, 'attack_1'],
  ]) {
    const { boss, brain } = setup(500, 620, () => roll);
    brain.startAttack(attack); brain.update(boss.animator.clip.frames / 12);
    assert.equal(boss.machine.current, expected);
  }
});

test('fresh guard before jump impact enters slide, pause freezes it, and walls limit knockback', () => {
  const { player, boss } = setup();
  const duel = new Duel(player, boss, { introDuration: 0, random: () => .99 });
  duel.brain.startAttack('jump_attack'); boss.animator.frame = 11; boss.animator.elapsed = 1 / 12 - 1 / 240;
  duel.update(1 / 120, 0, ['defend']);
  assert.equal(player.machine.current, 'defend_3'); assert.equal(duel.effects.bursts.length, 1);
  const snapshot = () => [player.x, player.animator.frame, player.animator.elapsed,
    player.knockbackVelocity, player.knockbackRemaining, boss.animator.frame, duel.effects.bursts[0].age];
  const before = snapshot(); duel.setPaused(true); duel.update(10, 1, ['attack']);
  assert.deepEqual(snapshot(), before);
  duel.setPaused(false); duel.update(.1); assert.ok(player.x < before[0]);
  for (const [playerX, bossX, edge] of [[80, 200, 64], [880, 760, 896]]) {
    const corner = setup(playerX, bossX);
    corner.player.machine.change('defend_1'); corner.boss.machine.change('jump_attack');
    resolveAttackHits(corner.boss, [corner.player], 12);
    corner.player.update(.75, 0, [], [corner.boss]); close(corner.player.x, edge);
  }
});
