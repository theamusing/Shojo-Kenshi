import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { Duel } from '../src/duel.js';
import { CombatEffects } from '../src/effects.js';
import { resolveAttackHits, getHurtbox } from '../src/combat.js';
import { drawHitBursts, HIT_PIXEL } from '../src/hit-effects.js';

function setup(facing = 1) {
  const player = new Actor('player', 500, 420, facing);
  const boss = new Actor('boss', 500 + facing * 80, 420, -facing);
  const effects = new CombatEffects(() => .5);
  return { player, boss, effects };
}

test('real hits create a single directional burst at the overlap, including both combo strikes', () => {
  for (const facing of [-1, 1]) {
    const { player, boss, effects } = setup(facing);
    player.machine.change('attack');
    resolveAttackHits(player, [boss], 5, effects);
    resolveAttackHits(player, [boss], 5, effects);
    assert.equal(effects.hits.length, 1);
    const hit = effects.hits[0], hurt = getHurtbox(boss);
    assert.equal(hit.direction, facing);
    assert.ok(hit.x >= hurt.x && hit.x <= hurt.x + hurt.width);
    assert.ok(hit.y >= hurt.y && hit.y <= hurt.y + hurt.height);
    assert.ok(hit.particles.reduce((sum, p) => sum + p.vx, 0) * facing > 0);
    player.startAttackSegment(2); resolveAttackHits(player, [boss], 13, effects);
    assert.equal(effects.hits.length, 2);
    assert.ok(effects.hits[1].particles.length > hit.particles.length);
    assert.notEqual(effects.hits[1].slash, hit.slash);
  }
});

test('misses and blocked hits do not create damage particles; unguarded player receives them', () => {
  const { player, boss, effects } = setup();
  player.machine.change('attack'); boss.x = 850;
  resolveAttackHits(player, [boss], 5, effects); assert.equal(effects.hits.length, 0);
  boss.x = 580; boss.machine.change('defend');
  resolveAttackHits(player, [boss], 5, effects); assert.equal(effects.hits.length, 0);
  player.machine.change('defend_1'); boss.machine.change('attack_1');
  resolveAttackHits(boss, [player], 12, effects); assert.equal(effects.hits.length, 0);
  player.resume(); boss.machine.change('jump_attack');
  resolveAttackHits(boss, [player], 12, effects);
  assert.equal(effects.hits.length, 1); assert.equal(effects.hits[0].heavy, true);
});

test('every drawn mark stays on the sprite pixel grid through the full particle lifetime', () => {
  const { player, boss, effects } = setup();
  player.machine.change('attack'); resolveAttackHits(player, [boss], 5, effects);
  let marks = 0;
  const ctx = { save() {}, restore() {}, fillRect(x, y, w, h) {
    for (const v of [x, y, w, h]) assert.equal(Math.abs(v % HIT_PIXEL), 0);
    assert.ok(w >= HIT_PIXEL && h >= HIT_PIXEL); marks++;
  } };
  for (let i = 0; i < 60; i++) { drawHitBursts(ctx, effects.hits); effects.update(1 / 120); }
  assert.ok(marks > 100); assert.equal(effects.hits.length, 0);
});

test('pause freezes hit particles, reset clears them, and victory uses its slow-motion clock', () => {
  const { player, boss } = setup();
  const duel = new Duel(player, boss, { introDuration: 0, random: () => .99 });
  player.machine.change('attack'); boss.health = 15;
  resolveAttackHits(player, [boss], 5, duel.effects); duel.applyEvents();
  assert.equal(duel.effects.hits.length, 1);
  duel.setPaused(true); duel.update(3); assert.equal(duel.effects.hits[0].age, 0);
  duel.setPaused(false); duel.update(.2);
  assert.ok(Math.abs(duel.effects.hits[0].age - .04) < 1e-8);
  duel.reset(); assert.equal(duel.effects.hits.length, 0);
});
