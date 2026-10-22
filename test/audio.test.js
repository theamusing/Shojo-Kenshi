import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, SFX_FILES } from '../src/audio.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SOUND_DURATIONS, SFX_PITCH_RANGES, synthesize, pitchVariation, createScore, MUSIC_BEATS } from '../src/sound-design.js';
import { Actor } from '../src/actor.js';
import { BossBrain } from '../src/boss.js';
import { CombatEffects } from '../src/effects.js';
import { Duel } from '../src/duel.js';

function setup(bossX = 340) {
  const events = [];
  const audio = Object.fromEntries(['swing', 'impact', 'parry', 'clearEffects', 'setPaused'].map(name =>
    [name, (...args) => events.push({ name, args })]));
  const player = new Actor('player', 260, 420), boss = new Actor('boss', bossX, 420, -1);
  const effects = new CombatEffects(() => .5, audio);
  const tick = (dt, actions = []) => player.update(dt, 0, actions, [boss], effects);
  return { events, audio, player, boss, effects, tick };
}

test('player swings precede hits, fire once per segment, and never repeat in recovery', () => {
  const { events, tick } = setup();
  tick(0, ['attack']); tick(3.99/16); assert.equal(events.length, 0);
  tick(.01/16); assert.deepEqual(events.map(e => e.name), ['swing']);
  tick(1/16); assert.deepEqual(events.map(e => e.name), ['swing', 'impact']);
  tick(4/16); assert.equal(events.length, 2);
  tick(0, ['attack', 'attack']); tick(15/16);
  assert.deepEqual(events.map(e => e.name), ['swing', 'impact', 'swing', 'impact', 'swing', 'impact']);
});

test('misses make only air sounds; an interrupted windup and animation previews stay silent', () => {
  const far = setup(704); far.tick(0, ['attack', 'attack']); far.tick(15/16);
  assert.deepEqual(far.events.map(e => e.name), ['swing', 'swing']);
  const cancelled = setup(); cancelled.tick(0, ['attack']); cancelled.tick(3/16); cancelled.tick(1, ['defend']);
  assert.equal(cancelled.events.length, 0);
  cancelled.player.preview('attack'); cancelled.tick(3); assert.equal(cancelled.events.length, 0);
});

test('boss strikes choose flesh or metal exclusively, including both thrust-chain and jump impacts', () => {
  for (const [attack, impactTime, swingTime, heavy] of [
    ['attack_1', 12/12, 10/12, false], ['attack_3', 10/12, 8/12, false], ['jump_attack', 12/12, 11/12, true],
  ]) for (const guarded of [false, true]) {
    const { player, boss, events, effects } = setup();
    const brain = new BossBrain(boss, player, { random: () => .99 }); brain.startAttack(attack);
    brain.update(swingTime, effects); assert.deepEqual(events.map(e => e.name), ['swing']);
    if (guarded) player.machine.change('defend_1');
    brain.update(impactTime - swingTime, effects);
    brain.update(.01, effects);
    assert.deepEqual(events.map(e => e.name), ['swing', guarded ? 'parry' : 'impact']);
    if (guarded) assert.equal(events[1].args[1], heavy);
    else assert.equal(events[1].args[1], player);
  }
  const { player, boss, events, effects } = setup();
  const brain = new BossBrain(boss, player, { random: () => .99 }); brain.startAttack('attack_2');
  brain.update(17/12, effects);
  assert.deepEqual(events.map(e => e.name), ['swing', 'impact', 'swing', 'impact']);
});

test('paused combat creates no sounds and reset clears ringing effects', () => {
  const { player, boss, events, audio } = setup();
  const duel = new Duel(player, boss, { audio, random: () => .99 });
  duel.setPaused(true); events.length = 0; duel.update(2, 0, ['attack']); assert.equal(events.length, 0);
  duel.reset(); assert.deepEqual(events.map(e => e.name), ['clearEffects', 'setPaused']);
});

test('all synthesized sounds are finite, non-silent and bounded at browser sample rates', () => {
  for (const sampleRate of [44100, 48000]) for (const kind of Object.keys(SOUND_DURATIONS)) {
    const samples = synthesize(kind, sampleRate);
    let peak = 0, energy = 0;
    for (const sample of samples) { assert.ok(Number.isFinite(sample)); peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
    assert.ok(peak > .1 && peak <= .900001, kind);
    assert.ok(Math.sqrt(energy / samples.length) > .005, kind);
    assert.equal(Math.abs(samples[0]), 0); assert.ok(Math.abs(samples.at(-1)) < .01, kind);
  }
});

test('random pitch stays in each sound range and musical voices keep their written pitches', () => {
  for (const [kind, [min, max]] of Object.entries(SFX_PITCH_RANGES)) {
    assert.equal(pitchVariation(kind, () => .5), 2 ** ((min + max) / 24));
    assert.equal(pitchVariation(kind, () => 0), 2 ** (min / 12));
    assert.equal(pitchVariation(kind, () => 1), 2 ** (max / 12));
  }
  const score = createScore(); assert.ok(score.length > 400);
  assert.equal(new Set(score.map(event => Math.floor(event.beat / 4))).size, 32);
  assert.ok(score.every(event => event.beat >= 0 && event.beat < MUSIC_BEATS && event.kind in SOUND_DURATIONS));
  assert.ok(score.every((event, i) => !i || event.beat >= score[i - 1].beat));
});

function fakeContext() {
  const param = () => ({ value: 1, events: [],
    setTargetAtTime(value, time, duration) { this.value = value; this.events.push({ value, time, duration }); },
    cancelScheduledValues() { this.events.length = 0; },
  });
  const node = extra => ({ connect() {}, disconnect() {}, ...extra });
  const ctx = {
    state: 'suspended', currentTime: 0, sampleRate: 22050, destination: {}, sources: [],
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
    close() { this.state = 'closed'; return Promise.resolve(); },
    createGain: () => node({ gain: param() }),
    createStereoPanner: () => node({ pan: param() }),
    createConvolver: () => node({}),
    createDynamicsCompressor: () => node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, param()]))),
    createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: i => data[i] }; },
    decodeAudioData: async () => ({ recorded: true }),
    createBufferSource() {
      const source = node({ playbackRate: param(), start(time) { this.time = time; }, stop() { this.stopped = true; } });
      this.sources.push(source); return source;
    },
  };
  return ctx;
}
const sampleResponse = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });

test('default loader calls native fetch with the global receiver, not the GameAudio instance', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async function () {
    assert.equal(this, globalThis, 'browser fetch rejects a GameAudio receiver with Illegal invocation');
    calls++;
    return sampleResponse();
  });
  const sound = new GameAudio({ contextFactory: fakeContext });
  t.after(() => sound.dispose());
  assert.equal(await sound.start(), true);
  assert.equal(calls, 4); assert.equal(sound.sampleCache.size, 4); assert.equal(sound.error, '');
  for (const [kind, count] of [['playerSwing', 1], ['bossSwing', 1], ['hit', 1], ['parry', 1]]) assert.equal(sound.buffers.get(kind).length, count);
});

test('audio unlock is lazy, pause and hidden state compose, mute is respected and effects are bounded', async t => {
  const ctx = fakeContext(); let constructions = 0, roll = 0;
  const sound = new GameAudio({ contextFactory: () => { constructions++; return ctx; }, random: () => (roll++ % 10) / 10, fetcher: sampleResponse });
  t.after(() => sound.dispose());
  sound.effect('parry'); assert.equal(constructions, 0);
  assert.equal(await sound.start(), true); assert.equal(constructions, 1);
  const timer = sound.timer; await sound.start(); assert.equal(sound.timer, timer);
  sound.setPaused(true); sound.setHidden(true); sound.setPaused(false); assert.equal(ctx.state, 'suspended');
  const before = ctx.sources.length; sound.effect('hit'); assert.equal(ctx.sources.length, before);
  sound.setHidden(false); assert.equal(ctx.state, 'running');
  sound.setMuted(true); sound.effect('parry'); assert.equal(ctx.sources.length, before); assert.equal(sound.master.gain.value, 0);
  sound.setMuted(false); sound.setVolumes(.2, .7); assert.equal(sound.music.gain.value, .2); assert.equal(sound.sfx.gain.value, .7);
  for (let i = 0; i < 30; i++) sound.effect('parry', 260);
  const effects = [...sound.voices].filter(voice => !voice.music);
  assert.equal(effects.length, 16);
  assert.ok(new Set(effects.map(voice => voice.source.playbackRate.value)).size > 1);
  assert.ok(effects.every(voice => voice.source.buffer.recorded));
  assert.ok(effects.every(voice => voice.source.buffer === sound.buffers.get('parry')[0]));
  assert.ok(new Set(effects.map(voice => voice.gain.gain.value)).size > 1);
  assert.ok(sound.duck.gain.events.some(event => event.value === .4));
  sound.clearEffects(); assert.equal([...sound.voices].filter(voice => !voice.music).length, 0);
  // Skipping ahead never schedules a backlog of hundreds of expired notes.
  ctx.currentTime = 120.1; const count = ctx.sources.length; sound.scheduleMusic();
  assert.ok(ctx.sources.length - count < 20);
  assert.ok(ctx.sources.slice(count).every(source => source.time >= ctx.currentTime));
});

test('missing audio support and a rejected resume do not prevent the game from running', async t => {
  const unavailable = new GameAudio({ contextFactory: () => null });
  assert.equal(await unavailable.start(), false); unavailable.effect('hit'); assert.ok(unavailable.error);
  const ctx = fakeContext(); ctx.resume = () => Promise.reject(new Error('gesture required'));
  const blocked = new GameAudio({ contextFactory: () => ctx, fetcher: sampleResponse }); t.after(() => blocked.dispose());
  assert.equal(await blocked.start(), false); assert.equal(blocked.started, false);
  ctx.resume = () => { ctx.state = 'running'; return Promise.resolve(); };
  assert.equal(await blocked.start(), true); assert.equal(blocked.error, '');
});

test('recordings load once, a failed sample retries, and BGM runs without synthesized SFX fallback', async t => {
  const ctx = fakeContext(), calls = [];
  let fail = true;
  const sound = new GameAudio({ contextFactory: () => ctx, fetcher: async url => {
    calls.push(url);
    if (url.endsWith('hit-3.wav') && fail) return { ok: false, status: 404 };
    return sampleResponse();
  } });
  t.after(() => sound.dispose());
  assert.equal(await sound.start(), true); assert.equal(calls.length, 4);
  assert.ok(sound.error); assert.equal(sound.buffers.has('hit'), false);
  assert.ok([...sound.voices].some(voice => voice.music));
  assert.ok(!('hit' in SOUND_DURATIONS));
  fail = false;
  await sound.start(); assert.equal(calls.length, 5); assert.equal(sound.error, '');
  assert.equal(sound.buffers.get('hit').length, 1);
  await sound.start(); assert.equal(calls.length, 5);
});

test('fixed actor samples, bright loud parry and heavier jump strikes retain the intended mix', async t => {
  const sound = new GameAudio({ contextFactory: fakeContext, random: () => .5, fetcher: sampleResponse });
  t.after(() => sound.dispose());
  await sound.start();
  const player = { kind: 'player', x: 260, machine: { current: 'attack' } };
  const boss = { kind: 'boss', x: 340, machine: { current: 'attack_1' } };
  const capture = trigger => { sound.clearEffects(); trigger(); return [...sound.voices].find(v => !v.music); };
  const playerSwing = capture(() => sound.swing(player));
  const bossSwing = capture(() => sound.swing(boss));
  assert.equal(playerSwing.source.buffer, sound.sampleCache.get(SFX_FILES.playerSwing[0]));
  assert.equal(bossSwing.source.buffer, sound.sampleCache.get(SFX_FILES.bossSwing[0]));
  assert.equal(playerSwing.gain.gain.value, .28);
  assert.equal(bossSwing.gain.gain.value, .28);
  assert.ok(playerSwing.source.playbackRate.value > 1);
  assert.ok(playerSwing.source.playbackRate.value > bossSwing.source.playbackRate.value);
  const hit = capture(() => sound.impact(boss, player));
  assert.equal(hit.source.buffer, sound.sampleCache.get(SFX_FILES.hit[0]));
  assert.equal(hit.gain.gain.value, .68);
  const parry = capture(() => sound.parry(player));
  assert.equal(parry.source.buffer, sound.sampleCache.get(SFX_FILES.parry[0]));
  assert.ok(parry.source.playbackRate.value < 1.3);
  const parryLayers = [...sound.voices].filter(v => !v.music);
  assert.equal(parryLayers.length, 2);
  const lowParry = parryLayers[1];
  assert.equal(parry.source.playbackRate.value, 1.17);
  assert.ok(Math.abs(lowParry.source.playbackRate.value - .765) < 1e-12);
  assert.equal(lowParry.source.buffer, parry.source.buffer);
  assert.equal(lowParry.source.time, parry.source.time);
  assert.ok(lowParry.gain.gain.value < parry.gain.gain.value);
  assert.ok(Math.abs(parryLayers.reduce((sum, v) => sum + v.gain.gain.value, 0) - 1.65) < 1e-12);
  assert.ok(parryLayers.reduce((sum, v) => sum + v.gain.gain.value, 0) > hit.gain.gain.value);
  boss.machine.current = 'jump_attack';
  for (const [normal, trigger] of [[bossSwing, () => sound.swing(boss)], [hit, () => sound.impact(boss, player)], [parry, () => sound.parry(player, true)]]) {
    const heavy = capture(trigger);
    assert.ok(heavy.gain.gain.value >= normal.gain.gain.value * 1.3);
  }
  for (const roll of [0, .5, .999]) {
    sound.random = () => roll;
    const heavyParry = capture(() => sound.parry(player, true));
    assert.ok(heavyParry.source.playbackRate.value > 1);
    const layers = [...sound.voices].filter(v => !v.music);
    assert.equal(layers.length, 2);
    assert.ok(layers[1].source.playbackRate.value < 1);
    assert.equal(layers[0].source.time, layers[1].source.time);
  }
});

test('posture break amplifies both parry voices without stacking a second parry sound', async t => {
  const sound = new GameAudio({ contextFactory: fakeContext, random: () => .5, fetcher: sampleResponse });
  t.after(() => sound.dispose()); await sound.start();
  for (const heavy of [false, true]) {
    sound.clearEffects(); sound.parry({ x: 260 }, heavy);
    const normal = [...sound.voices].filter(v => !v.music);
    sound.clearEffects(); sound.parry({ x: 260 }, heavy, true);
    const breaking = [...sound.voices].filter(v => !v.music);
    assert.equal(breaking.length, 2);
    breaking.forEach((voice, i) => {
      assert.ok(Math.abs(voice.gain.gain.value / normal[i].gain.gain.value - 1.3) < 1e-9);
      assert.equal(voice.source.playbackRate.value, normal[i].source.playbackRate.value);
    });
  }
});

test('boss block uses both parry layers at a lower pitch and gain without ducking the music', async t => {
  const sound = new GameAudio({ contextFactory: fakeContext, random: () => .5, fetcher: sampleResponse });
  t.after(() => sound.dispose()); await sound.start();
  sound.parry({ x: 260 });
  const playerLayers = [...sound.voices].filter(v => !v.music);
  sound.clearEffects(); const duckEvents = sound.duck.gain.events.length;
  sound.bossBlock({ x: 340 });
  const bossLayers = [...sound.voices].filter(v => !v.music);
  assert.equal(bossLayers.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(bossLayers[i].source.buffer, playerLayers[i].source.buffer);
    assert.equal(bossLayers[i].source.playbackRate.value, playerLayers[i].source.playbackRate.value * .75);
    assert.ok(Math.abs(bossLayers[i].gain.gain.value - playerLayers[i].gain.gain.value * .45) < 1e-12);
  }
  assert.equal(bossLayers[0].source.time, bossLayers[1].source.time);
  assert.equal(sound.duck.gain.events.length, duckEvents);
});

test('a missing player swing cannot substitute the boss recording', async t => {
  const sound = new GameAudio({ contextFactory: fakeContext, fetcher: async url =>
    url.endsWith('swing-4.wav') ? { ok: false, status: 404 } : sampleResponse() });
  t.after(() => sound.dispose());
  await sound.start();
  sound.swing({ kind: 'player', x: 260 });
  assert.equal([...sound.voices].filter(v => !v.music).length, 0);
  sound.swing({ kind: 'boss', x: 340 });
  assert.equal([...sound.voices].find(v => !v.music).source.buffer, sound.sampleCache.get(SFX_FILES.bossSwing[0]));
});

test('all shipped recordings are short, valid PCM WAV with provenance and no clipping', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8'));
  const urls = Object.values(SFX_FILES).flat(); assert.equal(urls.length, 4);
  assert.deepEqual(urls.map(url => url.split('/').at(-1)).sort(), ['hit-3.wav', 'parry-1.wav', 'swing-2.wav', 'swing-4.wav']);
  assert.ok(manifest.length >= urls.length);
  for (const url of urls) {
    const bytes = await readFile(new URL(url));
    const row = manifest.find(item => url.endsWith(item.file));
    assert.ok(row); assert.equal(row.license, row.file === 'hit-3.wav' ? 'User-provided; source license unspecified (wet layer: CC0-1.0)' : 'CC0-1.0'); assert.ok(row.sources.length);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 44100); assert.equal(bytes.readUInt16LE(34), 16);
    let offset = 12, samples;
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32LE(offset + 4);
      if (bytes.toString('ascii', offset, offset + 4) === 'data') { samples = bytes.subarray(offset + 8, offset + 8 + length); break; }
      offset += 8 + length + (length % 2);
    }
    assert.ok(samples && samples.length > 4410 && samples.length < 44100 * 2 * 1.2);
    let peak = 0;
    for (let i = 0; i < samples.length; i += 2) peak = Math.max(peak, Math.abs(samples.readInt16LE(i)));
    assert.ok(peak > 1000 && peak < 32767);
  }
});
