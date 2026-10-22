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
    assert.ok(hit.rays.every(r => Math.sign(r.dx) === facing));
    assert.equal(hit.x, boss.x);
    assert.ok(Math.abs(hit.y - (hurt.y + hurt.height / 2)) <= HIT_PIXEL / 2);
    assert.ok(hit.x >= hurt.x && hit.x <= hurt.x + hurt.width);
    assert.ok(hit.y >= hurt.y && hit.y <= hurt.y + hurt.height);
    assert.ok(hit.particles.reduce((sum, p) => sum + p.vx, 0) * facing > 0);
    player.startAttackSegment(2); resolveAttackHits(player, [boss], 13, effects);
    assert.equal(effects.hits.length, 2);
    assert.ok(effects.hits[1].particles.length > hit.particles.length);
  }
});

test('successive hits overlap without restarting, moving or removing the earlier burst', () => {
  const { player, boss, effects } = setup();
  player.machine.change('attack');
  resolveAttackHits(player, [boss], 5, effects);
  effects.update(.08);
  const first = effects.hits[0], snapshot = structuredClone(first);
  boss.x += 12;
  player.startAttackSegment(2);
  resolveAttackHits(player, [boss], 13, effects);
  const second = effects.hits[1];
  assert.equal(effects.hits.length, 2);
  assert.deepEqual(first, snapshot);
  assert.equal(second.age, 0);
  assert.notEqual(first.x, second.x);
  assert.notEqual(first.particles, second.particles);
  assert.notEqual(first.rays, second.rays);
  const capture = hits => {
    const marks = [];
    drawHitBursts({ save() {}, restore() {}, fillRect(...rect) { marks.push(rect); } }, hits);
    return marks;
  };
  const firstMarks = capture([first]), secondMarks = capture([second]);
  assert.ok(firstMarks.length && secondMarks.length);
  assert.deepEqual(capture(effects.hits), [...firstMarks, ...secondMarks]);
  effects.update(.19);
  assert.deepEqual(effects.hits, [second]);
  assert.equal(second.age, .19);
  effects.update(.08);
  assert.equal(effects.hits.length, 0);
});

test('boss bursts are larger, predominantly exit away from the attacker, and dissipate quickly', () => {
  for (const facing of [-1, 1]) {
    const { player, boss, effects } = setup(facing);
    effects.impact(player, boss); effects.impact(boss, player);
    const [large, small] = effects.hits;
    assert.ok(large.particles.length > small.particles.length);
    assert.ok(Math.max(...large.particles.map(p => Math.abs(p.vx))) > Math.max(...small.particles.map(p => Math.abs(p.vx))));
    const forward = large.particles.filter(p => p.vx * facing > 0);
    const backward = large.particles.filter(p => p.vx * facing < 0);
    assert.ok(backward.length > 0 && forward.length >= backward.length * 2);
    assert.ok(Math.min(...forward.map(p => Math.abs(p.vx))) > Math.max(...backward.map(p => Math.abs(p.vx))) * 2);
    effects.update(.5); assert.equal(effects.hits.length, 0);
  }
});

test('particles with horizontal velocity never drop under gravity', () => {
  const hit = { x: 200, y: 100, particles: [
    { vx: 800, vy: 0, drag: 2, life: .3, size: 2, trail: .02 },
  ] };
  const ctx = { save() {}, restore() {}, fillRect(x, y) { assert.equal(y, 100); } };
  for (const age of [.05, .1, .2]) { hit.age = age; drawHitBursts(ctx, [hit]); }
});

test('blade flash tapers at both tips, stretches thinner, then splits and travels outward', () => {
  const hit = { x: 100, y: 100, particles: [], rays: [{ dx: 120, dy: 0, width: 10, offsetY: 0 }] };
  const capture = age => {
    const marks = []; hit.age = age;
    drawHitBursts({ save() {}, restore() {}, fillRect(x, y, w, h) { marks.push({ x, h }); } }, [hit]);
    return marks;
  };
  const early = capture(0), stretching = capture(.05), split = capture(.13);
  const height = marks => Math.max(...marks.map(m => m.h));
  const span = marks => Math.max(...marks.map(m => m.x)) - Math.min(...marks.map(m => m.x));
  assert.ok(early.find(m => m.x === 100).h > early[0].h);
  assert.ok(early.find(m => m.x === 100).h > early.at(-1).h);
  assert.ok(Math.max(...early.map(m => m.x)) - 100 > (100 - Math.min(...early.map(m => m.x))) * 2);
  assert.ok(span(stretching) > span(early)); assert.ok(height(stretching) < height(early));
  assert.ok(split.some(m => m.x < 90) && split.some(m => m.x > 110));
  assert.ok(split.every(m => Math.abs(m.x - 100) >= 10));
  assert.ok(span(split) > span(stretching)); assert.ok(height(split) < height(stretching));
  assert.equal(capture(.20).length, 0);
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

test('random-sized particles use only white or solid execution gray', () => {
  const { player, boss } = setup();
  let seed = 31;
  const effects = new CombatEffects(() => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; });
  player.machine.change('attack'); resolveAttackHits(player, [boss], 5, effects);
  const hit = effects.hits[0];
  assert.ok(hit.rays.length === 2 || hit.rays.length === 3);
  assert.ok(Math.abs(hit.mainAngle) <= Math.PI / 6);
  assert.ok(hit.rays.every(r => Math.abs(Math.atan2(r.dy, r.dx * hit.direction) - hit.mainAngle) <= Math.PI / 18 + 1e-10));
  assert.equal(hit.radius, getHurtbox(boss).width / 2);
  for (const p of hit.particles) {
    assert.ok(Math.abs(p.vy) <= Math.abs(p.vx) * Math.tan(Math.PI / 3) + 1e-8);
    assert.ok(p.aspect >= 1.8);
    assert.ok(Math.abs(Math.hypot(p.offsetX, p.offsetY) - hit.radius) < 1e-8);
    assert.ok(p.offsetX * p.vx + p.offsetY * p.vy > 0);
    assert.ok(Math.abs(p.offsetX * p.vy - p.offsetY * p.vx) < 1e-8);
  }
  assert.ok(new Set(hit.particles.map(p => p.size)).size > 2);
  for (const color of ['#fff', '#999999']) {
    let marks = 0;
    const ctx = { save() {}, restore() {}, fillRect() {
      assert.equal(this.fillStyle, color); assert.equal(this.globalAlpha, 1); marks++;
    } };
    for (const age of [0, .08, .2]) { hit.age = age; drawHitBursts(ctx, effects.hits, color); }
    assert.ok(marks > 100);
  }
});
