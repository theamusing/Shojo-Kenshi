import { SOUND_DURATIONS, synthesize, pitchVariation, createScore, MUSIC_BPM, MUSIC_BEATS } from './sound-design.js';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const BASE_NOTES = { pluck: 57, flute: 69, strings: 45 };
export const SFX_FILES = Object.fromEntries(Object.entries({
  playerSwing: ['swing-4.wav'], bossSwing: ['swing-2.wav'],
  hit: ['hit-3.wav'], parry: ['parry-1.wav'],
}).map(([kind, files]) => [kind, files.map(file => new URL(`../assets/audio/${file}`, import.meta.url).href)]));
const EFFECT_MIX = {
  playerSwing: { pitch: 'swing', rate: 1.25, gain: .28 },
  bossSwing: { pitch: 'swing', rate: .82, gain: .28 },
  hit: { pitch: 'hit', rate: .78, gain: .68 },
  parry: { pitch: 'parry', rate: 1.17, gain: 1.65 },
};

export class GameAudio {
  constructor({ contextFactory = () => {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    return AudioContext ? new AudioContext() : null;
  }, random = Math.random, fetcher = (...args) => globalThis.fetch(...args) } = {}) {
    this.contextFactory = contextFactory; this.random = random;
    this.fetcher = fetcher; this.sampleCache = new Map(); this.effectsLoading = null; this.lastTake = new Map();
    this.context = null; this.paused = false; this.hidden = false; this.muted = false;
    this.musicVolume = .32; this.effectsVolume = .85;
    this.voices = new Set(); this.buffers = new Map(); this.score = createScore();
    this.timer = null; this.error = ''; this.started = false;
  }
  buildGraph() {
    const ctx = this.context;
    this.master = ctx.createGain(); this.master.gain.value = .7;
    this.music = ctx.createGain(); this.sfx = ctx.createGain(); this.duck = ctx.createGain();
    this.music.connect(this.duck); this.duck.connect(this.master); this.sfx.connect(this.master);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -8; compressor.knee.value = 12;
    compressor.ratio.value = 8; compressor.attack.value = .003; compressor.release.value = .14;
    this.master.connect(compressor); compressor.connect(ctx.destination);
    this.musicInput = ctx.createGain(); this.musicInput.connect(this.music);
    const room = ctx.createConvolver(), wet = ctx.createGain(); wet.gain.value = .18;
    const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 1.2), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    }
    room.buffer = impulse; this.musicInput.connect(room); room.connect(wet); wet.connect(this.music);
    for (const kind of Object.keys(SOUND_DURATIONS)) {
      // Keep the original BGM instruments; combat sounds are decoded recordings.
      const samples = synthesize(kind, ctx.sampleRate);
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(kind, [buffer]);
    }
    this.setVolumes(this.musicVolume, this.effectsVolume);
    this.setMuted(this.muted);
  }
  loadEffects() {
    if (this.effectsLoading) return this.effectsLoading;
    this.effectsLoading = (async () => {
      let failures = 0;
      await Promise.all(Object.entries(SFX_FILES).map(async ([kind, urls]) => {
        const results = await Promise.allSettled(urls.map(async url => {
          if (this.sampleCache.has(url)) return this.sampleCache.get(url);
          const response = await this.fetcher(url);
          if (!response.ok) throw new Error(`Audio download failed: ${response.status}`);
          const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
          this.sampleCache.set(url, buffer);
          return buffer;
        }));
        const buffers = results.filter(result => result.status === 'fulfilled').map(result => result.value);
        failures += results.length - buffers.length;
        if (buffers.length) this.buffers.set(kind, buffers);
      }));
      this.error = failures ? '部分音效加载失败，点击舞台重试' : '';
    })().finally(() => { this.effectsLoading = null; });
    return this.effectsLoading;
  }
  async start() {
    try {
      if (!this.context) {
        this.context = this.contextFactory();
        if (!this.context) { this.error = '当前浏览器不支持音频'; return false; }
        this.buildGraph();
      }
      if (this.paused || this.hidden) { await this.context.suspend(); return false; }
      // Called directly by a keyboard or pointer gesture for browser autoplay rules.
      await this.context.resume();
      if (this.paused || this.hidden) { await this.context.suspend(); return false; }
      if (!this.started) {
        this.started = true;
        this.musicOrigin = this.context.currentTime + .06; this.scoreIndex = 0;
        this.scheduleMusic();
        this.timer = setInterval(() => this.scheduleMusic(), 25);
      }
      await this.loadEffects();
      return this.context.state === 'running';
    } catch {
      this.error = '声音尚未开启，请再次点击舞台';
      return false;
    }
  }
  setVolumes(music, effects) {
    this.musicVolume = clamp(music); this.effectsVolume = clamp(effects);
    if (!this.context) return;
    this.music.gain.setTargetAtTime(this.musicVolume, this.context.currentTime, .025);
    this.sfx.gain.setTargetAtTime(this.effectsVolume, this.context.currentTime, .025);
  }
  setMuted(muted) {
    this.muted = !!muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : .7, this.context.currentTime, .015);
  }
  syncSuspension() {
    if (!this.context) return;
    const operation = this.paused || this.hidden ? this.context.suspend() : this.context.resume();
    operation.catch(() => {});
  }
  setPaused(paused) { this.paused = paused; this.syncSuspension(); }
  setHidden(hidden) { this.hidden = hidden; this.syncSuspension(); }
  playBuffer(kind, when, rate, volume, pan, music = false) {
    const ctx = this.context, takes = this.buffers.get(kind);
    if (!ctx || !takes?.length || ctx.state !== 'running') return;
    // Bound overlapping effects without ever cutting a score voice for a sword swing.
    if (!music) {
      const effects = [...this.voices].filter(voice => !voice.music);
      if (effects.length >= 16) this.stopVoice(effects[0]);
    }
    const source = ctx.createBufferSource(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
    let take = Math.floor(this.random() * takes.length);
    const last = this.lastTake.get(kind);
    if (!music && takes.length > 1 && last !== undefined && last < takes.length) {
      take = Math.floor(this.random() * (takes.length - 1));
      if (take >= last) take++;
    }
    if (!music) this.lastTake.set(kind, take);
    source.buffer = takes[take];
    source.playbackRate.value = rate;
    gain.gain.value = volume; panner.pan.value = Math.max(-.7, Math.min(.7, pan));
    source.connect(gain); gain.connect(panner); panner.connect(music ? this.musicInput : this.sfx);
    const voice = { source, gain, panner, music };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); panner.disconnect(); this.voices.delete(voice);
    };
    source.start(when);
  }
  stopVoice(voice) {
    voice.source.stop(); voice.source.onended?.();
  }
  clearEffects() {
    for (const voice of [...this.voices]) if (!voice.music) this.stopVoice(voice);
    if (this.duck) {
      this.duck.gain.cancelScheduledValues(this.context.currentTime);
      this.duck.gain.setTargetAtTime(1, this.context.currentTime, .025);
    }
  }
  effect(kind, x = 480, heavy = false, { pitchScale = 1, gainScale = 1, duck = true } = {}) {
    const ctx = this.context;
    if (!ctx || !this.started || !this.buffers.get(kind)?.length || ctx.state !== 'running' || this.paused || this.hidden || this.muted) return;
    const mix = EFFECT_MIX[kind];
    if (!mix) return;
    // Heavy strikes gain weight without losing the bright metallic parry pitch.
    const rate = mix.rate * pitchScale * pitchVariation(mix.pitch, this.random) * (heavy ? (kind === 'parry' ? .96 : .9) : 1);
    const gain = mix.gain * gainScale * (heavy ? 1.4 : 1) * (.92 + this.random() * .16);
    const when = ctx.currentTime + .005, pan = (x - 480) / 960;
    if (kind === 'parry') {
      // Keep the existing high pitch and add a lower body at the same onset.
      // Share the random variation so the interval stays stable between strikes.
      this.playBuffer(kind, when, rate, gain * .65, pan);
      this.playBuffer(kind, when, rate * ( .85 / 1.3 ), gain * .35, pan);
    } else {
      this.playBuffer(kind, when, rate, gain, pan);
    }
    if (kind === 'parry' && duck && this.effectsVolume > 0) {
      this.duck.gain.cancelScheduledValues(ctx.currentTime);
      this.duck.gain.setTargetAtTime(.4, ctx.currentTime, .008);
      this.duck.gain.setTargetAtTime(1, ctx.currentTime + .13, .12);
    }
  }
  swing(actor) { this.effect(actor.kind === 'boss' ? 'bossSwing' : 'playerSwing', actor.x, actor.machine?.current === 'jump_attack'); }
  impact(attacker, target) { this.effect('hit', target.x, attacker.machine.current === 'jump_attack'); }
  parry(player, heavy = false, breaksPosture = false) {
    this.effect('parry', player.x, heavy, { gainScale: breaksPosture ? 1.3 : 1 });
  }
  bossBlock(boss) { this.effect('parry', boss.x, false, { pitchScale: .75, gainScale: .45, duck: false }); }
  scheduleMusic() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.paused || this.hidden) return;
    const beatSeconds = 60 / MUSIC_BPM, loopSeconds = MUSIC_BEATS * beatSeconds;
    // A stalled tab skips missed notes instead of replaying a burst on return.
    if (ctx.currentTime - this.musicOrigin >= loopSeconds) {
      this.musicOrigin += Math.floor((ctx.currentTime - this.musicOrigin) / loopSeconds) * loopSeconds;
      this.scoreIndex = 0;
    }
    while (true) {
      const event = this.score[this.scoreIndex], time = this.musicOrigin + event.beat * beatSeconds;
      if (time > ctx.currentTime + .15) break;
      if (time >= ctx.currentTime - .025) {
        const rate = 2 ** ((event.note - (BASE_NOTES[event.kind] ?? 0)) / 12);
        this.playBuffer(event.kind, Math.max(ctx.currentTime, time), rate, event.gain, event.pan, true);
      }
      if (++this.scoreIndex === this.score.length) { this.scoreIndex = 0; this.musicOrigin += loopSeconds; }
    }
  }
  dispose() {
    clearInterval(this.timer); this.timer = null;
    for (const voice of [...this.voices]) this.stopVoice(voice);
    this.context?.close().catch(() => {});
  }
}
