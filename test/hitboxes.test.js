import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { KeyboardInput } from '../src/input.js';
import { getHurtbox, getAttackBox, overlaps, HIT_FLASH_SECONDS } from '../src/combat.js';

const setup = (bossX = 340) => {
  const player = new Actor('player', 260, 420);
  const boss = new Actor('boss', bossX, 420, -1);
  const tick = (dt, actions = []) => player.update(dt, 0, actions, [boss]);
  tick(0, ['attack']);
  return { player, boss, tick };
};

test('body boxes follow position, scale, facing and boss ground offset', () => {
  const { player, boss } = setup();
  assert.deepEqual(getHurtbox(player), { x: 228, y: 324, width: 60, height: 96 });
  assert.deepEqual(getHurtbox(boss), { x: 296, y: 258, width: 92, height: 164 });
  player.x = 300; player.facing = -1;
  assert.deepEqual(getHurtbox(player), { x: 272, y: 324, width: 60, height: 96 });
});

test('only source frames six and fourteen expose padded attack boxes', () => {
  const { player } = setup();
  for (let frame = 0; frame < 16; frame++) assert.equal(getAttackBox(player, frame) !== null, frame === 5 || frame === 13);
  assert.deepEqual(getAttackBox(player, 5), { x: 260, y: 338, width: 68, height: 68 });
  assert.deepEqual(getAttackBox(player, 13), { x: 276, y: 350, width: 88, height: 32 });
  player.resume(); assert.equal(getAttackBox(player, 5), null);
});

test('first strike only hits during frame six and cannot refresh a flash within the same strike', () => {
  const { player, boss, tick } = setup();
  tick(4.5/16); assert.equal(boss.flashRemaining, 0);
  tick(.5/16); assert.equal(player.animator.frame, 5); assert.equal(boss.flashRemaining, HIT_FLASH_SECONDS);
  boss.update(1/32); const remaining = boss.flashRemaining;
  tick(1/128); assert.equal(boss.flashRemaining, remaining);
  boss.update(1/32); assert.equal(boss.flashRemaining, 0);
  tick(1/128); assert.equal(boss.flashRemaining, 0);
  assert.equal(boss.machine.current, 'idle');
});

test('second strike hits again at frame fourteen and chains after its full duration', () => {
  const { player, boss, tick } = setup();
  tick(0, ['attack']); tick(5/16); assert.equal(boss.flashRemaining, HIT_FLASH_SECONDS);
  boss.update(HIT_FLASH_SECONDS);
  tick(7.5/16); assert.equal(player.animator.frame, 12); assert.equal(boss.flashRemaining, 0);
  tick(.5/16); assert.equal(player.animator.frame, 13); assert.equal(boss.flashRemaining, HIT_FLASH_SECONDS);
  tick(.5/16, ['attack']); assert.equal(player.animator.frame, 13);
  tick(.5/16); assert.equal(player.animator.frame, 14); assert.equal(getAttackBox(player), null);
  tick(1/16); assert.equal(player.attackStage, 1); assert.equal(player.animator.frame, 0);
});

test('skipping an entire active frame still hits, including the terminal combo frame', () => {
  const { player, boss, tick } = setup();
  let flashes = 0, remaining = 0;
  Object.defineProperty(boss, 'flashRemaining', {
    get: () => remaining,
    set: value => { remaining = value; if (value === HIT_FLASH_SECONDS) flashes++; },
  });
  tick(0, ['attack']); tick(15/16);
  assert.equal(flashes, 2); assert.equal(player.machine.current, 'idle');
});

test('range misses, longer second-strike reach, and mirrored left-facing hits', () => {
  const far = setup(704); far.tick(0, ['attack']); far.tick(14/16);
  assert.equal(far.boss.flashRemaining, 0);
  const longer = setup(400); longer.tick(0, ['attack']); longer.tick(5/16);
  assert.equal(longer.boss.flashRemaining, 0);
  longer.tick(8/16); assert.equal(longer.boss.flashRemaining, HIT_FLASH_SECONDS);
  const left = setup(180); left.player.facing = -1;
  assert.deepEqual(getAttackBox(left.player, 5), { x: 192, y: 338, width: 68, height: 68 });
  left.tick(5/16); assert.equal(left.boss.flashRemaining, HIT_FLASH_SECONDS);
  const wrongWay = setup(340); wrongWay.player.facing = -1; wrongWay.tick(5/16);
  assert.equal(wrongWay.boss.flashRemaining, 0);
});

test('guard interruption and animation preview never produce phantom hits', () => {
  const { player, boss, tick } = setup();
  tick(4/16); tick(1/16, ['defend']); tick(1);
  assert.equal(boss.flashRemaining, 0);
  player.preview('attack'); tick(13/16);
  assert.ok(getAttackBox(player)); assert.equal(boss.flashRemaining, 0);
  player.resume(); tick(0, ['attack']); tick(5/16);
  assert.equal(boss.flashRemaining, HIT_FLASH_SECONDS);
  boss.resume(); assert.equal(boss.flashRemaining, 0);
});

test('flash draws the current white silhouette for one attack-frame duration then restores normal pixels', () => {
  const { boss, tick } = setup();
  const normal = {}, white = {}, calls = [];
  const images = new Map([[boss.animator.clip.url, normal], [`${boss.animator.clip.url}#white`, white]]);
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(image) { calls.push(image); } };
  tick(5/16); boss.draw(ctx, images);
  boss.update(HIT_FLASH_SECONDS / 2); boss.draw(ctx, images);
  boss.update(HIT_FLASH_SECONDS / 2); boss.draw(ctx, images);
  assert.deepEqual(calls, [white, white, normal]);
});

test('H toggles once per actual press and box edge contact is not an overlap', () => {
  const input = new KeyboardInput();
  input.press('KeyH'); input.press('KeyH', true); input.press('KeyH');
  assert.deepEqual(input.consumeActions(), ['toggleHitboxes']);
  input.release('KeyH'); input.press('KeyH'); assert.deepEqual(input.consumeActions(), ['toggleHitboxes']);
  assert.equal(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), false);
});
