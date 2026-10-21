import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { ANIMATIONS } from '../src/animations.js';
import { BossBrain, leftPressure } from '../src/boss.js';
import { getAttackBox, overlaps, resolveAttackHits } from '../src/combat.js';
import { getBodyBox, moveBossHorizontally } from '../src/physics.js';
import { CombatEffects, guardPoint } from '../src/effects.js';
import { Duel } from '../src/duel.js';

const randomSequence = (...values) => { let i = 0; return () => values[i++] ?? .99; };
const setup = (playerX = 600, bossX = 704, random = () => .99) => {
  const player = new Actor('player', playerX, 420), boss = new Actor('boss', bossX, 420, -1);
  const brain = new BossBrain(boss, player, { random });
  return { player, boss, brain };
};

test('boss starts idle, tracks player, and chooses slower 8fps movement after minimum hold', () => {
  const { player, boss, brain } = setup(260, 704, randomSequence(.1, .9, 0));
  brain.update(.49); assert.equal(boss.machine.current, 'idle'); assert.equal(boss.x, 704);
  brain.update(.01); assert.equal(boss.machine.current, 'idle');
  brain.update(.125); assert.equal(boss.machine.current, 'run'); assert.equal(boss.animator.fps, 8);
  assert.equal(boss.animator.frame, 1); assert.equal(boss.x, 692); assert.ok(boss.speed < player.speed);
  player.x = 850; brain.update(.1); assert.equal(boss.facing, 1); assert.equal(boss.machine.current, 'run');
  for (const [name, clip] of Object.entries(ANIMATIONS.boss)) assert.equal(clip.fps, name === 'run' ? 8 : 12);
});

test('far non-jump decisions hold idle/run for at least half a second', () => {
  for (const [roll, state] of [[.1, 'run'], [.99, 'idle']]) {
    const { boss, brain, player } = setup(260, 704, randomSequence(roll, .99, 0));
    brain.decide(); assert.equal(boss.machine.current, state); assert.ok(brain.decisionRemaining >= .5);
    player.x = boss.x - 100; brain.update(.49);
    assert.equal(boss.machine.current, state);
  }
});

test('left-side retreat probability increases toward the wall while facing stays on player', () => {
  assert.equal(leftPressure(704), 0); assert.ok(leftPressure(400) < leftPressure(200)); assert.equal(leftPressure(140), 1);
  const mid = setup(200, 400, randomSequence(.7, .5, 0));
  mid.brain.decide(); mid.brain.update(.1); assert.equal(mid.brain.moveMode, 'approach'); assert.ok(mid.boss.x < 400);
  const corner = setup(64, 160, randomSequence(.7, .5, 0));
  corner.brain.decide(); corner.brain.update(.1);
  assert.equal(corner.brain.moveMode, 'retreat'); assert.ok(corner.boss.x > 160); assert.equal(corner.boss.facing, -1);
});

test('left-edge pressure no longer overrides attacks or extends movement duration', () => {
  const { boss, brain, player } = setup(64, 200, randomSequence(.1, 0));
  brain.decide();
  assert.equal(boss.machine.current, 'attack_1');
  brain.update(12/12); assert.equal(player.machine.current, 'hit');
  const moving = setup(64, 200, randomSequence(.7, 0, 0));
  moving.brain.decide(); assert.equal(moving.brain.moveMode, 'retreat');
  assert.equal(moving.brain.decisionRemaining, .5);
});

test('close-range retreat is slightly favored on the right and a little more on the left', () => {
  const cases = [[704, 210, 0], [704, 181, 0]];
  for (const bossX of [704, 480, 479]) {
    for (const distance of [180, 150, 120, 90, 76]) {
      // Use either side of the boss where needed to keep actors inside the stage.
      cases.push([bossX, distance, bossX < 480 ? 60 : 55]);
    }
  }
  for (const [bossX, distance, expected] of cases) {
    const playerX = bossX - distance >= 64 ? bossX - distance : bossX + distance;
    let retreats = 0;
    for (let i = 0; i < 100; i++) {
      const { boss, brain } = setup(playerX, bossX, randomSequence(.7, (i + .5) / 100, 0));
      brain.decide(); if (brain.moveMode === 'retreat') retreats++;
      assert.equal(boss.machine.current, 'run');
    }
    assert.equal(retreats, expected);
    const attacking = setup(playerX, bossX, randomSequence(.1, 0));
    attacking.brain.decide(); assert.equal(attacking.boss.machine.current, 'attack_1');
  }
});

test('left third almost never advances into the corner, but can still approach players to its right', () => {
  for (const [bossX, playerX, expectedRetreats] of [
    [400, 200, 475], [320, 64, 950], [320, 200, 950],
    [300, 120, 953], [230, 100, 965], [140, 64, 980],
    [140, 260, 600], [230, 600, 0],
  ]) {
    let retreats = 0;
    for (let i = 0; i < 1000; i++) {
      const { boss, brain } = setup(playerX, bossX, randomSequence(.7, (i + .5) / 1000, 0));
      brain.decide();
      assert.equal(boss.machine.current, 'run');
      assert.equal(brain.decisionRemaining, .5);
      if (brain.moveMode === 'retreat') retreats++;
    }
    assert.equal(retreats, expectedRetreats, `boss ${bossX}, player ${playerX}`);
  }
});

test('following a close boss makes it yield ground to the right while facing the player', () => {
  const { player, boss } = setup(460, 550);
  let i = 0; const rolls = [.7, .1, 0];
  const duel = new Duel(player, boss, { introDuration: 0, random: () => rolls[i++ % rolls.length] });
  duel.brain.decide();
  for (let step = 0; step < 120; step++) duel.update(1/60, 1);
  assert.ok(boss.x > 700); assert.ok(player.x > 600); assert.equal(boss.facing, -1);
  assert.ok(boss.x - player.x >= 76 - 1e-8);
  const mirrored = setup(750, 660, randomSequence(.7, .1, 0));
  mirrored.brain.decide(); mirrored.brain.update(.1);
  assert.ok(mirrored.boss.x < 660); assert.equal(mirrored.boss.facing, 1);
});

test('boss still reaches and hits a stationary player at the left wall', () => {
  let seed = 123;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const { player, boss } = setup(64, 704); const duel = new Duel(player, boss, { introDuration: 0, random });
  let hits = 0; const receiveHit = player.receiveHit.bind(player);
  player.receiveHit = attacker => { hits++; receiveHit(attacker); };
  for (let i = 0; i < 1200; i++) duel.update(.025);
  assert.ok(hits > 0); assert.equal(player.x, 64);
});

test('near decisions can select all three attacks, then attack again, idle or move', () => {
  for (const [roll, name] of [[0, 'attack_1'], [.5, 'attack_2'], [.99, 'attack_3']]) {
    const { boss, brain } = setup(600, 704, randomSequence(.1, roll));
    brain.decide(); assert.equal(boss.machine.current, name); assert.equal(boss.animator.fps, 12);
  }
  for (const [roll, expected] of [[.1, 'attack_1'], [.75, 'run'], [.99, 'idle']]) {
    const { boss, brain } = setup(600, 704, randomSequence(roll, 0, 0));
    boss.machine.change('attack_1'); brain.lastAttack = 'attack_1';
    brain.update(17/12);
    assert.equal(boss.machine.current, expected);
    if (expected === 'attack_1') assert.equal(boss.animator.frame, 0);
    else assert.ok(brain.decisionRemaining >= .5);
  }
});

test('attack windup locks facing even if player changes side', () => {
  const { player, boss, brain } = setup();
  boss.machine.change('attack_1'); player.x = 850; brain.update(.5);
  assert.equal(boss.facing, -1); assert.equal(boss.machine.current, 'attack_1');
  brain.update(17/12 - .5); assert.equal(boss.machine.current, 'idle'); assert.equal(boss.facing, 1);
});

test('boss pushes players from either side and stops at stage walls without crushing them', () => {
  for (const [playerX, bossX, direction, wall] of [[260, 400, -1, 64], [700, 560, 1, 896]]) {
    const { player, boss } = setup(playerX, bossX);
    moveBossHorizontally(boss, direction * 100, player);
    assert.equal(player.x, boss.x + direction * 76);
    moveBossHorizontally(boss, direction * 1000, player);
    assert.equal(player.x, wall); assert.equal(boss.x, wall - direction * 76);
    assert.equal(overlaps(getBodyBox(player), getBodyBox(boss)), false);
    const start = player.x;
    moveBossHorizontally(boss, -direction * 10, player); assert.equal(player.x, start);
  }
});

test('boss boxes activate on exactly frames 13, 12/17 and 11, reaching the short player', () => {
  for (const [name, active] of [['attack_1', [12]], ['attack_2', [11, 16]], ['attack_3', [10]]]) {
    for (const facing of [-1, 1]) {
      const { player, boss } = setup(facing === -1 ? 600 : 808);
      boss.facing = facing; boss.machine.change(name);
      for (let frame = 0; frame < boss.animator.clip.frames; frame++) assert.equal(!!getAttackBox(boss, frame), active.includes(frame));
      for (const frame of active) {
        const box = getAttackBox(boss, frame);
        assert.ok(box.height >= 100); assert.ok(overlaps(box, getBodyBox(player)));
      }
    }
  }
});

test('all three moves hit on their active frame, not earlier, and each strike only hits once', () => {
  for (const [name, active] of [['attack_1', 12], ['attack_2', 11], ['attack_3', 10]]) {
    const { player, boss, brain } = setup(); boss.machine.change(name);
    brain.update((active - .5)/12); assert.equal(player.machine.current, 'idle');
    brain.update(.5/12); assert.equal(player.machine.current, 'hit'); assert.equal(player.animator.frame, 0);
    assert.equal(player.flashRemaining, 1/12); assert.equal(player.facing, 1);
    player.update(2/12, 0, [], [boss]); assert.equal(player.animator.frame, 2);
    brain.update(1/120); assert.equal(player.animator.frame, 2);
  }
});

test('attack 2 can re-hit a stunned player and restart the eight-frame hit animation', () => {
  const { player, boss, brain } = setup(); boss.machine.change('attack_2');
  brain.update(11/12); player.update(3/12, 0, [], [boss]);
  assert.equal(player.animator.frame, 3); assert.ok(player.x < 600);
  brain.update(5/12); assert.equal(player.machine.current, 'hit'); assert.equal(player.animator.frame, 0);
  assert.equal(boss.strikeTargets.size, 2);
});

test('hit interrupts attack/guard, ignores all gameplay controls, faces attacker and knocks back', () => {
  for (const state of ['idle', 'run', 'attack', 'defend_1', 'defend_2', 'hit']) {
    const { player, boss } = setup(); player.machine.change(state);
    player.receiveHit(boss);
    player.update(7.5/12, -1, ['attack', 'defend'], [boss]);
    assert.equal(player.machine.current, 'hit'); assert.equal(player.animator.frame, 7);
    assert.equal(player.facing, 1); assert.ok(player.x < 600); assert.equal(player.attackQueued, false);
    player.update(.5/12, -1, [], [boss]);
    assert.equal(player.machine.current, 'run'); assert.equal(player.knockbackVelocity, 0);
    assert.equal(player.facing, -1);
  }
  const corner = setup(64, 180); corner.player.receiveHit(corner.boss); corner.player.update(8/12, 0, [], [corner.boss]);
  assert.equal(corner.player.x, 64); assert.equal(corner.boss.x, 180);
});

test('either guard blocks without damage; attack 2 requires separate guard windows', () => {
  for (const guard of ['defend_1', 'defend_2']) {
    const { player, boss, brain } = setup(); player.machine.change(guard); boss.machine.change('attack_2');
    let parries = 0; const effects = { parry: target => { assert.equal(target, player); parries++; } };
    brain.update(11/12, effects);
    assert.equal(parries, 1); assert.equal(player.machine.current, guard); assert.equal(player.x, 600); assert.equal(player.flashRemaining, 0);
    brain.update(1/120, effects); assert.equal(parries, 1);
    player.update(4/16); assert.equal(player.machine.current, 'idle');
    brain.update(5/12, effects); assert.equal(player.machine.current, 'hit'); assert.equal(parries, 1);
  }
});

test('ordinary blocks recoil away on either side less than a hit, without restarting guard', () => {
  for (const guard of ['defend_1', 'defend_2']) for (const facing of [-1, 1]) {
    for (const [attack, frame] of [['attack_1', 12], ['attack_2', 11], ['attack_2', 16], ['attack_3', 10]]) {
      const { player, boss } = setup(500, 500 - facing * 120);
      boss.facing = facing; boss.machine.change(attack);
      player.machine.change(guard); player.update(1/16);
      let parries = 0;
      player.receiveHit = () => assert.fail('ordinary block must not damage the player');
      resolveAttackHits(boss, [player], frame, { parry: () => parries++ });
      assert.equal(player.animator.frame, 1); assert.equal(player.machine.current, guard);
      player.update(1/16, 0, [], [boss]);
      assert.ok((player.x - 500) * facing > 0);
      const velocity = player.knockbackVelocity, remaining = player.knockbackRemaining;
      resolveAttackHits(boss, [player], frame, { parry: () => parries++ });
      assert.equal(parries, 1); assert.equal(player.knockbackVelocity, velocity);
      assert.equal(player.knockbackRemaining, remaining);
      player.update(2/16, 0, [], [boss]);
      assert.equal(player.machine.current, 'idle'); assert.equal(player.flashRemaining, 0);
      assert.equal(player.knockbackVelocity, 0);
      const blockedDistance = Math.abs(player.x - 500);
      const hit = setup(500, boss.x); hit.player.receiveHit(hit.boss); hit.player.update(8/12);
      assert.ok(blockedDistance > 10 && blockedDistance < Math.abs(hit.player.x - 500));
      const endX = player.x; player.update(.25); assert.equal(player.x, endX);
    }
  }
});

test('ordinary guard recoil respects walls and pause, and expires with a late guard', () => {
  for (const [playerX, bossX, edge] of [[70, 190, 64], [890, 770, 896]]) {
    const { player, boss } = setup(playerX, bossX);
    boss.facing = Math.sign(playerX - bossX); boss.machine.change('attack_1');
    player.machine.change('defend_1'); resolveAttackHits(boss, [player], 12);
    player.animator.paused = true; player.update(1); assert.equal(player.x, playerX);
    player.animator.paused = false; player.update(.25, 0, [], [boss]); assert.equal(player.x, edge);
  }
  const { player, boss } = setup(); player.machine.change('defend_2'); player.update(3.5/16);
  boss.machine.change('attack_1'); resolveAttackHits(boss, [player], 12);
  player.update(.5/16); assert.equal(player.machine.current, 'idle'); assert.ok(player.x < 600);
  assert.equal(player.knockbackVelocity, 0); assert.equal(player.knockbackRemaining, 0);
});

test('both strikes can be parried when guard is renewed before the second active frame', () => {
  const { player, boss, brain } = setup(); boss.machine.change('attack_2'); player.machine.change('defend_1');
  let parries = 0; const effects = { parry: () => parries++ };
  brain.update(11/12, effects); player.update(4/16); player.machine.change('defend_2');
  brain.update(5/12, effects); assert.equal(parries, 2); assert.equal(player.machine.current, 'defend_2');
});

test('far, wrong-facing and preview attacks cannot hit', () => {
  for (const mode of ['far', 'wrongFacing', 'preview']) {
    const { player, boss, brain } = setup(mode === 'far' ? 260 : 600);
    if (mode === 'preview') boss.preview('attack_1');
    else boss.machine.change('attack_1');
    if (mode === 'wrongFacing') boss.facing = 1;
    brain.update(13/12); assert.equal(player.machine.current, 'idle'); assert.equal(player.flashRemaining, 0);
  }
});

test('fresh K is applied before enemy collision in the same render interval', () => {
  const { player, boss } = setup(); const duel = new Duel(player, boss, { introDuration: 0, random: () => .99 });
  boss.machine.change('attack_1'); boss.animator.frame = 11; boss.animator.elapsed = 1/12 - 1/240;
  duel.update(1/120, 0, ['defend']);
  assert.ok(player.isGuarding); assert.equal(player.flashRemaining, 0); assert.equal(duel.effects.bursts.length, 1);
  assert.ok(duel.effects.bursts[0].particles.length > 28);
});

test('an early guard that expires before impact does not block', () => {
  const { player, boss } = setup(); const duel = new Duel(player, boss, { introDuration: 0, random: () => .99 });
  boss.machine.change('attack_1'); boss.animator.frame = 8;
  duel.update(4/12 + .001, 0, ['defend']); assert.equal(player.machine.current, 'hit');
});

test('sparks originate on the current mirrored blade pose, draw and expire', () => {
  const { player } = setup(); player.machine.change('defend_1'); player.animator.frame = 1; player.facing = -1;
  assert.deepEqual(guardPoint(player), { x: 608, y: 326 });
  const effects = new CombatEffects(() => .5); effects.parry(player);
  assert.equal(effects.bursts[0].x, 608); assert.equal(effects.bursts[0].y, 326);
  let strokes = 0, fills = 0;
  const ctx = { save() {}, restore() {}, createRadialGradient: () => ({ addColorStop() {} }), fillRect() { fills++; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() { strokes++; } };
  const burst = effects.bursts[0];
  effects.draw(ctx); assert.equal(strokes, burst.particles.length * 2); assert.ok(fills >= burst.particles.length + 2);
  effects.update(burst.duration / 2); assert.equal(effects.bursts.length, 1);
  effects.update(burst.duration / 2); assert.equal(effects.bursts.length, 0);
});

test('long fight stays within bounds, preserves body separation, and actually produces attacks', () => {
  let seed = 123;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const { player, boss } = setup(); const duel = new Duel(player, boss, { introDuration: 0, random });
  let hits = 0; const receiveHit = player.receiveHit.bind(player);
  player.receiveHit = attacker => { hits++; receiveHit(attacker); };
  for (let i = 0; i < 1200; i++) {
    duel.update(.025, i % 400 < 200 ? 1 : -1, i % 19 === 0 ? ['attack'] : i % 23 === 0 ? ['defend'] : []);
    assert.ok(player.x >= 64 && player.x <= 896); assert.ok(boss.x >= 64 && boss.x <= 896);
    assert.ok(Math.abs(player.x - boss.x) >= 76 - 1e-8);
  }
  assert.ok(hits > 0);
  player.resume(); boss.resume(); duel.reset(); assert.equal(duel.brain.decisionRemaining, .5); assert.equal(duel.effects.bursts.length, 0);
});
