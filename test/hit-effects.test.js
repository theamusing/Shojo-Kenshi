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

test('real hits create a single burst at the victim center, including both combo strikes', () => {
  for (const facing of [-1, 1]) {
    const { player, boss, effects } = setup(facing);
    player.machine.change('attack');
    resolveAttackHits(player, [boss], 5, effects);
    resolveAttackHits(player, [boss], 5, effects);
    assert.equal(effects.hits.length, 1);
    const hit = effects.hits[0], hurt = getHurtbox(boss);
    assert.equal(hit.direction, facing);
    assert.equal(hit.x, boss.x);
    assert.ok(Math.abs(hit.y - (hurt.y + hurt.height / 2)) <= HIT_PIXEL / 2);
    assert.ok(hit.x >= hurt.x && hit.x <= hurt.x + hurt.width);
    assert.ok(hit.y >= hurt.y && hit.y <= hurt.y + hurt.height);
    assert.ok(hit.particles.reduce((sum, p) => sum + p.vx, 0) * facing > 0);
    player.startAttackSegment(2); resolveAttackHits(player, [boss], 13, effects);
    assert.equal(effects.hits.length, 2);
    assert.ok(effects.hits[1].particles.length > hit.particles.length);
    assert.ok(effects.hits[1].reach > hit.reach);
  }
});

test('boss bursts are larger, predominantly exit away from the attacker, and dissipate quickly', () => {
  for (const facing of [-1, 1]) {
    const { player, boss, effects } = setup(facing);
    effects.impact(player, boss); effects.impact(boss, player);
    const [large, small] = effects.hits;
    assert.ok(large.reach > small.reach); assert.ok(large.particles.length > small.particles.length);
    const outgoing = large.rays.filter(ray => ray.dx * facing > 0);
    const returning = large.rays.filter(ray => ray.dx * facing < 0);
    assert.ok(outgoing.length >= returning.length * 3);
    assert.ok(Math.min(...outgoing.map(ray => Math.abs(ray.dx))) > Math.max(...returning.map(ray => Math.abs(ray.dx))) * 2);
    const forward = large.particles.filter(p => p.vx * facing > 0);
    const backward = large.particles.filter(p => p.vx * facing < 0);
    assert.ok(forward.length >= backward.length * 4);
    assert.ok(Math.min(...forward.map(p => Math.abs(p.vx))) > Math.max(...backward.map(p => Math.abs(p.vx))) * 2);
    effects.update(.5); assert.equal(effects.hits.length, 0);
  }
});

test('particles with horizontal velocity never drop under gravity', () => {
  const hit = { x: 200, y: 100, rays: [], particles: [
    { vx: 800, vy: 0, drag: 2, life: .3, size: 2, trail: .02 },
  ] };
  const ctx = { save() {}, restore() {}, fillRect(x, y) { assert.equal(y, 100); } };
  for (const age of [.05, .1, .2]) { hit.age = age; drawHitBursts(ctx, [hit]); }
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

test('horizontal cones and random-sized particles use only white or solid execution gray', () => {
  const { player, boss } = setup();
  let seed = 31;
  const effects = new CombatEffects(() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; });
  player.machine.change('attack'); resolveAttackHits(player, [boss], 5, effects);
  const hit = effects.hits[0];
  assert.ok(new Set(hit.particles.map(p => p.size)).size > 2);
  assert.ok(hit.rays.every(ray => Math.abs(ray.dx) > Math.abs(ray.dy) * 2));
  assert.ok(hit.rays.some(ray => ray.dx < 0) && hit.rays.some(ray => ray.dx > 0));
  for (const color of ['#fff', '#999999']) {
    let marks = 0;
    const ctx = { save() {}, restore() {}, fillRect() {
      assert.equal(this.fillStyle, color); assert.equal(this.globalAlpha, 1); marks++;
    } };
    for (const age of [0, .08, .2]) { hit.age = age; drawHitBursts(ctx, effects.hits, color); }
    assert.ok(marks > 100);
  }
});
