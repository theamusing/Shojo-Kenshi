import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { Duel } from '../src/duel.js';

function setup() {
  const player = new Actor('player', 260, 420), boss = new Actor('boss', 704, 420, -1);
  return { player, boss, duel: new Duel(player, boss, { random: () => .99, introDuration: 0 }) };
}
function snapshot(duel) {
  return JSON.stringify({
    actors: [duel.player, duel.boss].map(a => ({
      x: a.x, facing: a.facing, state: a.machine.current, frame: a.animator.frame,
      elapsed: a.animator.elapsed, flash: a.flashRemaining, velocity: a.knockbackVelocity,
      queued: a.attackQueued, stage: a.attackStage,
    })),
    timer: duel.brain.decisionRemaining,
    effects: duel.effects.bursts,
  });
}

test('global pause freezes combat, knockback, flash, AI timer and particles and rejects inputs', () => {
  const { player, boss, duel } = setup();
  duel.effects.parry(player);
  player.receiveHit(boss); boss.flashRemaining = 1/16;
  duel.setPaused(true);
  const before = snapshot(duel);
  duel.update(60, 1, ['attack', 'defend']); duel.update(0, -1, ['attack']);
  assert.equal(snapshot(duel), before);
  duel.setPaused(false); duel.update(1/120);
  assert.ok(player.x < 260); assert.ok(player.flashRemaining < 1/12);
  assert.ok(duel.effects.bursts[0].age > 0); assert.ok(duel.brain.decisionRemaining < .5);
});

test('resuming preserves the attack frame and queued combo without replaying paused actions', () => {
  const { player, duel } = setup();
  duel.update(3/16, 0, ['attack', 'attack']);
  assert.equal(player.animator.frame, 3); assert.equal(player.attackQueued, true);
  duel.setPaused(true); duel.update(10, 1, ['defend']);
  duel.setPaused(false); duel.update(4/16);
  assert.equal(player.attackStage, 2); assert.equal(player.animator.frame, 7);
  assert.equal(player.x, 284); assert.equal(player.machine.current, 'attack');
  duel.setPaused(true); duel.reset(); assert.equal(duel.paused, false);
});
