import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { Duel } from '../src/duel.js';
import { resolveAttackHits } from '../src/combat.js';
import { loadProgress, saveProgress } from '../src/progress.js';

const setup = options => new Duel(new Actor('player', 260, 420), new Actor('boss', 340, 420, -1), { random: () => .99, ...options });

test('hard mode is locked until victory completes, unlocks once and survives resets', () => {
  let unlocks = 0;
  const duel = setup({ difficulty: 'hard', onUnlock: () => unlocks++ });
  assert.equal(duel.difficulty, 'normal');
  assert.equal(duel.boss.health, 600); assert.equal(duel.boss.maxPosture, 60);
  duel.elapsed = 12;
  assert.equal(duel.reset('hard'), false); assert.equal(duel.elapsed, 12);
  duel.effects.damage(duel.boss, 600); duel.applyEvents(); duel.update(.5);
  assert.equal(duel.hardUnlocked, false); assert.equal(unlocks, 0);
  duel.update(1.27);
  assert.equal(duel.phase, 'won'); assert.equal(duel.newUnlock, true); assert.equal(unlocks, 1);
  duel.update(10); assert.equal(unlocks, 1);
  assert.equal(duel.reset('hard'), true);
  assert.equal(duel.boss.health, 1000); assert.equal(duel.boss.maxPosture, 80);
  assert.equal(duel.introRemaining, 3); assert.equal(duel.elapsed, 0); assert.equal(duel.newUnlock, false);
  duel.effects.damage(duel.boss, 1000); duel.applyEvents(); duel.update(1.77);
  assert.equal(unlocks, 1);
  duel.reset('normal'); assert.equal(duel.boss.health, 600); assert.equal(duel.hardUnlocked, true);
});

test('death does not unlock hard mode', () => {
  const duel = setup();
  duel.effects.damage(duel.player, 100); duel.applyEvents(); duel.update(3);
  assert.equal(duel.phase, 'dead'); assert.equal(duel.hardUnlocked, false);
});

test('posture-breaking parries enhance feedback once in either difficulty and recover the correct bar', () => {
  for (const difficulty of ['normal', 'hard']) for (const heavy of [false, true]) {
    const duel = setup({ difficulty, hardUnlocked: true, introDuration: 0 });
    const { player, boss, effects } = duel, calls = [];
    effects.audio = { parry: (...args) => calls.push(args), clearEffects() {} };
    boss.posture = boss.maxPosture - 5;
    player.machine.change('defend_1'); boss.machine.change(heavy ? 'jump_attack' : 'attack_1');
    resolveAttackHits(boss, [player], 12, effects); duel.applyEvents();
    resolveAttackHits(boss, [player], 12, effects); duel.applyEvents();
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(1), [heavy, true]);
    assert.equal(effects.bursts[0].style, 'break'); assert.equal(effects.ripples.length, 1);
    assert.equal(boss.machine.current, 'down'); assert.equal(boss.posture, boss.maxPosture);
    assert.notDeepEqual(effects.cameraOffset, { x: 0, y: 0 });
    duel.setPaused(true); duel.update(1);
    assert.equal(effects.ripples[0].age, 0); assert.equal(effects.shake.age, 0);
    duel.setPaused(false); player.resume(); duel.update(10 / 12 + 1.5);
    assert.ok(Math.abs(boss.posture - boss.maxPosture / 2) < 1e-6);
    assert.equal(effects.ripples.length, 0); assert.equal(effects.shake, null);
    effects.parry(player); effects.postureBreak(boss); duel.reset();
    assert.equal(effects.ripples.length, 0); assert.equal(effects.bursts.length, 0); assert.equal(effects.shake, null);
  }
});

test('ordinary parry gives brief gentle shake; boss defense does not shake the camera', () => {
  const duel = setup(), { effects, player, boss } = duel;
  player.machine.change('defend_1'); boss.machine.change('attack_1');
  resolveAttackHits(boss, [player], 12, effects); duel.applyEvents();
  assert.equal(effects.bursts[0].style, 'parry'); assert.equal(effects.ripples.length, 0);
  assert.ok(Math.abs(effects.cameraOffset.x) <= 2); assert.ok(effects.shake);
  effects.update(.2); assert.deepEqual(effects.cameraOffset, { x: 0, y: 0 });
  effects.bossBlock(boss); assert.equal(effects.shake, null); assert.equal(effects.ripples.length, 0);
});

test('progress persists unlock and selected difficulty, and rejects malformed or locked selections', () => {
  let value = null;
  const storage = { getItem: () => value, setItem: (key, next) => { assert.equal(key, 'shojo-progress'); value = next; } };
  assert.deepEqual(loadProgress(storage), { hardUnlocked: false, difficulty: 'normal' });
  assert.equal(saveProgress({ hardUnlocked: true, difficulty: 'hard' }, storage), true);
  assert.deepEqual(loadProgress(storage), { hardUnlocked: true, difficulty: 'hard' });
  for (const saved of [{ hardUnlocked: false, difficulty: 'hard' }, { hardUnlocked: 'true', difficulty: 'hard' }, null]) {
    value = JSON.stringify(saved);
    assert.deepEqual(loadProgress(storage), { hardUnlocked: false, difficulty: 'normal' });
  }
  value = '{broken'; assert.equal(loadProgress(storage).difficulty, 'normal');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(loadProgress(blocked).hardUnlocked, false); assert.equal(saveProgress({}, blocked), false);
});
