import test from 'node:test';
import assert from 'node:assert/strict';
import { Actor } from '../src/actor.js';
import { KeyboardInput } from '../src/input.js';

const player = () => new Actor('player', 260, 420);
const press = (p, action = 'attack', direction = 0) => p.update(0, direction, [action]);

test('single attack plays seven frames then repeats seven and six before idling', () => {
  const p = player(); press(p);
  assert.equal(p.machine.current, 'attack'); assert.equal(p.animator.frame, 0); assert.equal(p.animator.fps, 16);
  for (let frame = 1; frame <= 6; frame++) {
    p.update(1/16); assert.equal(p.animator.frame, frame);
  }
  p.update(1/32); assert.equal(p.machine.current, 'attack'); assert.equal(p.animator.frame, 6);
  p.update(1/32); assert.equal(p.attackRecoveryFrame, 6); assert.equal(p.animator.frame, 6);
  p.update(1/16); assert.equal(p.attackRecoveryFrame, 5); assert.equal(p.animator.frame, 5);
  p.update(1/32); assert.equal(p.machine.current, 'attack');
  p.update(1/32); assert.equal(p.machine.current, 'idle'); assert.equal(p.attackStage, null); assert.equal(p.animator.fps, 12);
});

test('J in the last first-segment frame joins frame eight; frame fifteen finishes fully', () => {
  const p = player(); press(p); p.update(6.5/16); press(p);
  p.update(.5/16); assert.equal(p.attackStage, 2); assert.equal(p.animator.frame, 7);
  assert.equal(p.attackQueued, false);
  p.update(7.5/16); assert.equal(p.animator.frame, 14); assert.equal(p.machine.current, 'attack');
  p.update(.5/16); assert.equal(p.machine.current, 'idle');
});

test('second segment can chain back to first repeatedly, with a fresh buffer per segment', () => {
  const p = player(); press(p); press(p); press(p); // extra first-segment presses do not spill over
  p.update(7/16); assert.equal(p.attackStage, 2); assert.equal(p.attackQueued, false);
  p.update(7.5/16); press(p); p.update(.5/16);
  assert.equal(p.attackStage, 1); assert.equal(p.animator.fps, 16); assert.equal(p.animator.frame, 0); assert.equal(p.attackQueued, false);
  press(p); p.update(7/16); assert.equal(p.attackStage, 2);
  p.update(8/16); assert.equal(p.machine.current, 'idle');
});

test('excess presses during first segment alone cannot queue a third segment', () => {
  const p = player(); press(p); p.update(0, 0, ['attack', 'attack', 'attack']);
  p.update(15/16); assert.equal(p.machine.current, 'idle');
});

test('attack overrides run, steps in its locked facing, then resumes current held direction', () => {
  const p = player(); p.update(.1, 1); const startX = p.x;
  press(p, 'attack', 1); p.update(6/16, -1);
  assert.equal(p.x, startX + 16); assert.equal(p.facing, 1); assert.equal(p.machine.current, 'attack');
  p.update(1/16, -1); assert.equal(p.attackRecoveryFrame, 6); assert.equal(p.x, startX + 24); assert.equal(p.facing, 1);
  p.update(2/16, -1); assert.equal(p.machine.current, 'run'); assert.equal(p.facing, -1); assert.equal(p.x, startX + 24);
  p.update(.1, -1); assert.equal(p.x, startX + 8);
});

test('irregular updates preserve surplus time across combo and recovery boundaries', () => {
  const p = player(); press(p); press(p);
  p.update(8/16); assert.equal(p.attackStage, 2); assert.equal(p.animator.frame, 8);
  p.update(8/16, 1); assert.equal(p.machine.current, 'run');
  assert.ok(Math.abs(p.x - (260 + 48 + 160/16)) < 1e-8);
});

test('K interrupts either attack segment immediately and discards queued combos', t => {
  for (const stage of [1, 2]) for (const random of [0, .999]) {
    const mock = t.mock.method(Math, 'random', () => random);
    const p = player(); press(p);
    if (stage === 2) { press(p); p.update(7/16); }
    press(p); press(p, 'defend');
    assert.equal(p.machine.current, random < .5 ? 'defend_1' : 'defend_2');
    assert.equal(p.animator.fps, 16); assert.equal(p.animator.frame, 0); assert.equal(p.attackQueued, false); assert.equal(p.attackStage, null);
    p.update(4/16); assert.equal(p.machine.current, 'idle');
    press(p); p.update(9/16); assert.equal(p.machine.current, 'idle');
    mock.mock.restore();
  }
});

test('guard wins simultaneous presses, cannot be restarted, and resumes movement', () => {
  for (const actions of [['attack', 'defend'], ['defend', 'attack']]) {
    const p = player(); p.update(0, 1, actions);
    assert.match(p.machine.current, /^defend_[12]$/);
    p.update(2/16, -1); assert.equal(p.x, 260); assert.equal(p.facing, 1);
    p.update(0, -1, ['attack', 'defend']); assert.equal(p.animator.frame, 2);
    p.update(2/16, -1); assert.equal(p.machine.current, 'run'); assert.equal(p.attackQueued, false);
  }
});

test('keyboard requires a release and new press; held J never auto-combos', () => {
  const input = new KeyboardInput(), p = player();
  input.press('KeyJ'); p.update(0, 0, input.consumeActions());
  input.press('KeyJ', true); input.press('KeyJ');
  p.update(9/16, 0, input.consumeActions()); assert.equal(p.machine.current, 'idle');
  input.release('KeyJ'); input.press('KeyJ'); p.update(0, 0, input.consumeActions());
  input.release('KeyJ'); input.press('KeyJ'); p.update(7/16, 0, input.consumeActions());
  assert.equal(p.attackStage, 2);
  input.press('KeyD'); assert.equal(input.direction, 1);
  input.press('KeyA'); assert.equal(input.direction, 0);
  input.press('KeyK'); input.clear(); assert.deepEqual(input.consumeActions(), []); assert.equal(input.direction, 0);
});

test('preview stops at fifteen frames; live input leaves preview cleanly', () => {
  const p = player(); p.preview('attack'); p.update(14/16);
  assert.equal(p.animator.frame, 14); assert.equal(p.attackStage, null);
  p.update(1/16); assert.equal(p.animator.frame, 0);
  press(p); assert.equal(p.previewing, false); assert.equal(p.attackStage, 1); assert.equal(p.animator.frame, 0);
  press(p); p.resume(); press(p); p.update(9/16); assert.equal(p.machine.current, 'idle');
});

test('boss rendering moves down one source pixel at the current scale', () => {
  const b = new Actor('boss', 704, 420, -1), translations = [];
  const ctx = { save() {}, restore() {}, translate(...xy) { translations.push(xy); }, scale() {}, drawImage() {} };
  b.draw(ctx, new Map());
  assert.deepEqual(translations, [[704, 422]]);
  assert.equal(player().renderOffsetY, 0);
});
