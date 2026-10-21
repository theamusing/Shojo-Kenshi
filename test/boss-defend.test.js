import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { Duel } from '../src/duel.js';
import { resolveAttackHits } from '../src/combat.js';

function setup(random = () => .1, options = {}) {
  const player = new Actor('player', 260, 420), boss = new Actor('boss', 340, 420, -1);
  const sounds = [];
  const audio = { impact: () => sounds.push('hit'), bossBlock: () => sounds.push('block'), parry() {}, swing() {}, clearEffects() {}, setPaused() {} };
  const duel = new Duel(player, boss, { random, introDuration: 0, audio, ...options });
  const strike = (stage = 1) => {
    player.x = 260; boss.x = 340; player.facing = 1;
    player.machine.change('attack', true); player.startAttackSegment(stage);
    resolveAttackHits(player, [boss], stage === 1 ? 5 : 13, duel.effects);
    duel.applyEvents();
  };
  return { duel, player, boss, strike, sounds };
}

test('a hit can trigger defense, but a failed roll preserves idle or walking', () => {
  for (const state of ['idle', 'run']) for (const roll of [.1, .3, .9]) {
    const { boss, strike } = setup(() => roll); boss.machine.change(state);
    strike(); assert.equal(boss.health, 585);
    assert.equal(boss.machine.current, roll === .1 ? 'defend' : state);
  }
});

test('defense takes 30 percent damage and metal sounds replace flesh without adding posture', () => {
  const { duel, player, boss, strike, sounds } = setup();
  strike(); boss.flashRemaining = 0;
  strike(1); assert.equal(boss.health, 580.5);
  strike(2); assert.equal(boss.health, 574.5);
  assert.equal(boss.flashRemaining, 0); assert.equal(boss.posture, 0);
  assert.deepEqual(sounds, ['hit', 'block', 'block']);
  assert.equal(duel.effects.bursts.length, 2);
  const block = duel.effects.bursts[0];
  assert.equal(block.style, 'block'); assert.ok(block.x < boss.x);
  duel.effects.parry(player);
  const parry = duel.effects.bursts.at(-1);
  assert.ok(block.radius < parry.radius && block.brightness < parry.brightness);
  assert.ok(block.particles.length < parry.particles.length);
  resolveAttackHits(player, [boss], 13, duel.effects); duel.applyEvents();
  assert.equal(sounds.length, 3); assert.equal(boss.health, 574.5);
});

test('defense keeps its rolled duration through hits and pause, then always attacks', () => {
  const { duel, player, boss, strike } = setup();
  strike(); player.resume();
  duel.update(.5); assert.equal(boss.machine.current, 'defend');
  const left = duel.brain.defendRemaining;
  strike(2); assert.equal(duel.brain.defendRemaining, left);
  duel.setPaused(true); duel.update(10); assert.equal(duel.brain.defendRemaining, left);
  duel.setPaused(false); player.resume(); player.x = 64; boss.x = 800;
  duel.update(left);
  assert.equal(boss.machine.current, 'attack_1'); assert.equal(boss.animator.frame, 0);
  assert.equal(duel.brain.defensePending, false);
});

test('longer configured guard holds its final frame and carries time into the counterattack', () => {
  const { duel, boss } = setup(() => .99, { minimumDefendTime: 1, defendTimeVariation: 0 });
  duel.brain.startDefense(); duel.brain.update(.8);
  assert.equal(boss.machine.current, 'defend'); assert.equal(boss.animator.frame, 8);
  duel.brain.update(.3); assert.equal(boss.machine.current, 'attack_3'); assert.equal(boss.animator.frame, 1);
});

test('defense duration varies from half a second to nine tenths without changing animation speed', () => {
  const durations = [];
  for (const roll of [0, .25, .5, .75, .999]) {
    const { duel, boss } = setup(() => roll);
    duel.brain.startDefense();
    const duration = duel.brain.defendRemaining; durations.push(duration);
    assert.ok(duration >= .5 && duration <= .9); assert.equal(boss.animator.fps, 12);
    duel.brain.update(duration - .001); assert.equal(boss.machine.current, 'defend');
    duel.brain.update(.001); assert.match(boss.machine.current, /^attack_[123]$/);
  }
  assert.equal(new Set(durations).size, durations.length);
});

test('hits during an attack queue defense until it finishes; jump still gets its mandatory rest', () => {
  for (const name of ['attack_1', 'attack_3', 'jump_attack']) {
    const { duel, boss, strike } = setup();
    duel.brain.startAttack(name); strike();
    assert.equal(boss.machine.current, name); assert.equal(duel.brain.defensePending, true);
    duel.brain.update(boss.animator.clip.frames / boss.animator.fps);
    if (name === 'jump_attack') {
      assert.equal(boss.machine.current, 'idle');
      duel.brain.update(duel.brain.decisionRemaining + .001);
    }
    assert.equal(boss.machine.current, 'defend');
  }
});

test('intro, knockdown and get-up prevent defensive reactions; defeat overrides defense', () => {
  const opening = setup(() => .1, { introDuration: 3 }); opening.strike();
  assert.equal(opening.boss.machine.current, 'idle');
  for (const state of ['down', 'up']) {
    const { boss, duel, strike } = setup(); boss.machine.change(state); strike();
    assert.equal(boss.machine.current, state); assert.equal(duel.brain.defensePending, false);
  }
  const { duel, boss, strike } = setup();
  duel.brain.startDefense(); boss.health = 4; strike();
  assert.equal(boss.health, 0); assert.equal(boss.machine.current, 'defeated'); assert.equal(duel.phase, 'victory');
  duel.update(2); assert.equal(duel.phase, 'won');
  duel.reset(); assert.equal(duel.brain.defendRemaining, 0); assert.equal(duel.brain.defensePending, false);
});
