import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { getBodyBox } from '../src/physics.js';
import { getAttackBox, overlaps, HIT_FLASH_SECONDS } from '../src/combat.js';

const pair = (playerX = 260, bossX = 704) => {
  const player = new Actor('player', playerX, 420);
  const boss = new Actor('boss', bossX, 420, -1);
  const tick = (dt, direction = 0, actions = []) => player.update(dt, direction, actions, [boss]);
  return { player, boss, tick };
};

test('both attack steps move only during frames 5–7 and 12–14 in the locked facing', () => {
  for (const facing of [-1, 1]) {
    const { player, tick } = pair(400, 800); player.facing = facing;
    tick(0, 0, ['attack', 'attack']);
    tick(4/16, -facing); assert.equal(player.x, 400);
    for (let frame = 0; frame < 3; frame++) {
      tick(1/16, -facing); assert.equal(player.x, 400 + facing * 8 * (frame + 1));
    }
    assert.equal(player.attackStage, 2);
    tick(4/16, -facing); assert.equal(player.x, 400 + facing * 24);
    for (let frame = 0; frame < 3; frame++) {
      tick(1/16, -facing); assert.equal(player.x, 400 + facing * (24 + 8 * (frame + 1)));
    }
    tick(1/16); assert.equal(player.x, 400 + facing * 48);
    assert.equal(player.machine.current, 'idle');
  }
});

test('attack steps stop at bodies and walls without pushing, and recovery never steps again', () => {
  for (const [start, bossX, facing, end] of [[620, 704, 1, 628], [788, 704, -1, 780],
    [888, 500, 1, 896], [72, 500, -1, 64]]) {
    const { player, boss, tick } = pair(start, bossX); player.facing = facing;
    tick(0, 0, ['attack']); tick(7/16);
    assert.equal(player.x, end); assert.equal(boss.x, bossX);
    tick(2/16); assert.equal(player.x, end);
    assert.equal(overlaps(getBodyBox(player), getBodyBox(boss)), false);
  }
  const free = pair(); free.tick(0, 0, ['attack']); free.tick(7/16);
  assert.equal(free.player.x, 284); free.tick(2/16); assert.equal(free.player.x, 284);
});

test('attack movement survives uneven updates, stops on guard, and stays still in preview or pause', () => {
  for (const steps of [1, 90]) {
    const { player, boss, tick } = pair(260, 386);
    tick(0, 0, ['attack', 'attack']);
    for (let i = 0; i < steps; i++) tick((15/16) / steps);
    assert.ok(Math.abs(player.x - 308) < 1e-8);
    assert.equal(boss.flashRemaining, HIT_FLASH_SECONDS);
  }
  const interrupted = pair(); interrupted.tick(0, 0, ['attack']); interrupted.tick(5/16);
  assert.equal(interrupted.player.x, 268);
  interrupted.tick(4/16, 0, ['defend']); assert.equal(interrupted.player.x, 268);
  const paused = pair(); paused.tick(0, 0, ['attack']); paused.tick(4.5/16);
  paused.player.animator.paused = true; paused.tick(1); assert.equal(paused.player.x, 264);
  paused.player.animator.paused = false; paused.tick(4.5/16); assert.equal(paused.player.x, 284);
  paused.player.preview('attack'); paused.tick(2); assert.equal(paused.player.x, 284);
});

test('movement stops at the boss from both sides without pushing or tunneling', () => {
  for (const [start, direction, contactX] of [[260, 1, 628], [850, -1, 780]]) {
    const { player, boss, tick } = pair(start);
    tick(10, direction);
    assert.equal(player.x, contactX); assert.equal(boss.x, 704);
    assert.equal(overlaps(getBodyBox(player), getBodyBox(boss)), false);
    for (let i = 0; i < 100; i++) tick(1/60, direction);
    assert.equal(player.x, contactX); assert.equal(boss.x, 704);
    const body = getBodyBox(player);
    player.facing *= -1;
    assert.deepEqual(getBodyBox(player), body);
    tick(.1, -direction);
    assert.equal(player.x, contactX - direction * 16);
  }
});

test('body contact still allows the weapon to reach the boss', () => {
  for (const [start, direction] of [[260, 1], [850, -1]]) {
    const { player, boss, tick } = pair(start);
    tick(10, direction); const contactX = player.x;
    tick(0, direction, ['attack']); tick(5/16, direction);
    assert.equal(player.x, contactX); assert.equal(boss.x, 704);
    assert.equal(boss.flashRemaining, HIT_FLASH_SECONDS);
  }
});

test('vertically separated bodies do not block, and existing overlaps separate only the player', () => {
  const elevated = pair(); elevated.boss.groundY = 100;
  elevated.tick(10, 1); assert.equal(elevated.player.x, 896);
  const overlap = pair(690);
  overlap.tick(.01, 1);
  assert.equal(overlap.player.x, 628); assert.equal(overlap.boss.x, 704);
  assert.equal(overlaps(getBodyBox(overlap.player), getBodyBox(overlap.boss)), false);
});

test('recovery has no attack box or hit even if a new target enters the replayed sixth frame', () => {
  const { player, boss, tick } = pair();
  tick(0, 0, ['attack']); tick(7/16);
  assert.equal(player.attackRecoveryFrame, 6); assert.equal(player.animator.frame, 6);
  boss.x = 340;
  tick(1/16); assert.equal(player.attackRecoveryFrame, 5); assert.equal(player.animator.frame, 5);
  assert.equal(getAttackBox(player), null); assert.equal(boss.flashRemaining, 0);
  tick(.5/16); assert.equal(getAttackBox(player), null); assert.equal(boss.flashRemaining, 0);
  tick(.5/16); assert.equal(player.machine.current, 'idle'); assert.equal(player.attackRecoveryFrame, null);
});

test('J immediately cancels either recovery frame into frame eight and keeps second-strike hits', () => {
  for (const time of [7.25/16, 8.75/16]) {
    const { player, boss, tick } = pair(260, 340);
    tick(0, 0, ['attack']); tick(time);
    assert.notEqual(player.attackRecoveryFrame, null);
    boss.flashRemaining = 0;
    tick(0, 0, ['attack']);
    assert.equal(player.attackRecoveryFrame, null); assert.equal(player.attackStage, 2);
    assert.equal(player.animator.frame, 7); assert.equal(player.animator.elapsed, 0);
    assert.equal(player.attackQueued, false);
    tick(6/16); assert.equal(player.animator.frame, 13); assert.equal(boss.flashRemaining, HIT_FLASH_SECONDS);
    tick(1/16); assert.equal(player.animator.frame, 14); assert.equal(getAttackBox(player), null);
    tick(1/16); assert.equal(player.machine.current, 'idle');
  }
});

test('K still interrupts either recovery frame and wins over simultaneous J', () => {
  for (const time of [7.5/16, 8.5/16]) {
    const { player, tick } = pair();
    tick(0, 0, ['attack']); tick(time); tick(0, 0, ['attack', 'defend']);
    assert.match(player.machine.current, /^defend_[12]$/);
    assert.equal(player.attackRecoveryFrame, null); assert.equal(player.attackStage, null);
    tick(4/16); assert.equal(player.machine.current, 'idle');
  }
});

test('buffered first-strike combo skips recovery; uneven updates preserve recovery duration', () => {
  const combo = pair(); combo.tick(0, 0, ['attack', 'attack']); combo.tick(7/16);
  assert.equal(combo.player.attackStage, 2); assert.equal(combo.player.attackRecoveryFrame, null);
  assert.equal(combo.player.animator.frame, 7);
  const single = pair(); single.tick(0, 0, ['attack']); single.tick(8.5/16, 1);
  assert.equal(single.player.x, 284); assert.equal(single.player.animator.frame, 5);
  single.tick(1.5/16, 1);
  assert.equal(single.player.machine.current, 'run'); assert.equal(single.player.x, 294);
});

test('movement resumed after recovery is also stopped by the boss', () => {
  const { player, boss, tick } = pair(620);
  tick(0, 0, ['attack']); tick(1, 1);
  assert.equal(player.machine.current, 'run'); assert.equal(player.x, 628); assert.equal(boss.x, 704);
});
