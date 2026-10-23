// Original BGM instruments. Combat effects use CC0 recordings in assets/audio.
const TAU = Math.PI * 2;
export const SOUND_DURATIONS = {
  taiko: 1.15, rim: .20, pluck: 1.4, flute: 1.4, strings: 1.6, gong: 2.8,
  shakuhachi: 4.8, koto: 3.4, sho: 5.4, rin: 5.2,
};
export const SFX_PITCH_RANGES = { swing: [-2, 2], hit: [4, 9], parry: [-1.2, 1.2] }; // semitone bounds
export function pitchVariation(kind, random = Math.random) {
  const [min, max] = SFX_PITCH_RANGES[kind];
  return 2 ** ((min + random() * (max - min)) / 12);
}
function seededNoise(seed) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2147483648 - 1; };
}

export function synthesize(kind, sampleRate, seed = 12345) {
  if (!(kind in SOUND_DURATIONS)) throw new Error(`Unknown sound: ${kind}`);
  const duration = SOUND_DURATIONS[kind], samples = new Float32Array(Math.ceil(duration * sampleRate));
  const noise = seededNoise(seed);
  const delay = new Float32Array(Math.round(sampleRate / 220));
  for (let i = 0; i < delay.length; i++) delay[i] = noise();
  let low = 0, phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, n = noise();
    let value = 0;
    if (kind === 'taiko') {
      phase += TAU * (58 + 78 * Math.exp(-t * 40)) / sampleRate;
      low += (n - low) * .08;
      value = (Math.sin(phase) + .32 * Math.sin(phase * 1.58)) * Math.exp(-t * 5.5)
        + .6 * low * Math.exp(-t * 18) + .18 * n * Math.exp(-t * 90);
    } else if (kind === 'rim') {
      value = (Math.sin(TAU * 820 * t) + .6 * Math.sin(TAU * 1417 * t)) * Math.exp(-t * 45)
        + n * .7 * Math.exp(-t * 60);
    } else if (kind === 'pluck') {
      // Karplus–Strong plucked string, with a short plectrum scrape.
      const index = i % delay.length, next = (index + 1) % delay.length;
      value = delay[index]; delay[index] = .497 * (delay[index] + delay[next]);
      value = value * Math.exp(-t * 1.3) + .08 * n * Math.exp(-t * 100);
    } else if (kind === 'flute') {
      low += (n - low) * .12;
      phase += TAU * 440 * (1 + .0035 * Math.sin(TAU * 5.1 * t)) / sampleRate;
      value = (Math.sin(phase) + .18 * Math.sin(phase * 2) + .08 * Math.sin(phase * 3) + low * .32)
        * Math.min(1, t / .07) * Math.exp(-t * 1.3);
    } else if (kind === 'strings') {
      // Slightly detuned bowed-string harmonics; softened attack keeps the mix clear.
      for (let h = 1; h <= 7; h++) {
        value += (Math.sin(TAU * (110 * h + .35) * t) + Math.sin(TAU * (110 * h - .35) * t)) / (h * 3);
      }
      value *= Math.min(1, t / .055) * Math.exp(-t * 1.8);
    } else if (kind === 'shakuhachi') {
      // Breath, a gentle scooped entrance and delayed vibrato: a low bamboo flute.
      low += (n - low) * .075;
      const bend = -.65 * Math.exp(-t * 7) + .11 * Math.sin(TAU * 4.3 * t) * Math.min(1, t / .9);
      phase += TAU * 220 * 2 ** (bend / 12) / sampleRate;
      value = (Math.sin(phase) + .40 * Math.sin(2 * phase) + .14 * Math.sin(3 * phase)
        + .045 * Math.sin(4 * phase) + low * .38) * Math.min(1, t / .12) * Math.exp(-t * .60)
        * Math.min(1, (duration - t) / .8);
    } else if (kind === 'koto') {
      // Unequal harmonic decay and a restrained bridge buzz give the string texture.
      const bend = .025 * Math.exp(-t * 6);
      phase += TAU * 220 * (1 + bend) / sampleRate;
      for (let h = 1; h <= 8; h++) {
        value += Math.sin(phase * h + .0015 * h * h * t) * Math.exp(-t * (1.05 + h * .25)) / h ** .85;
      }
      value += .16 * n * Math.exp(-t * 70);
    } else if (kind === 'sho') {
      // A soft sustained reed tone; the score supplies the suspended shō clusters.
      for (let h = 1; h <= 5; h++) {
        value += (Math.sin(TAU * (220 * h - .24) * t)
          + Math.sin(TAU * (220 * h + .24) * t)) / (h * h * 2);
      }
      value *= Math.sin(Math.PI * t / duration) ** 1.4 * (.94 + .06 * Math.sin(TAU * .7 * t));
    } else if (kind === 'rin') {
      // Distant temple bowl, with inharmonic partials and slow beating.
      for (const [ratio, gain, decay] of [[1, 1, .55], [2.71, .3, .8], [4.13, .15, 1.2]]) {
        value += Math.sin(TAU * 440 * ratio * t) * gain * Math.exp(-t * decay)
          * (.85 + .15 * Math.cos(TAU * 1.3 * t));
      }
    } else if (kind === 'gong') {
      for (let h = 0; h < 7; h++) {
        const frequency = [130, 207, 349, 493, 743, 1009, 1391][h];
        value += Math.sin(TAU * frequency * t + .6 * Math.sin(TAU * 3.2 * t)) * Math.exp(-t * (1.4 + h * .4)) / (h + 2);
      }
      value += n * .12 * Math.exp(-t * 18);
    }
    // Tiny fades prevent discontinuities at buffer edges.
    samples[i] = value * Math.min(1, t / .0015, (duration - t) / .025);
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= .9 / peak;
  return samples;
}

export const MUSIC_BPM = 132;
export const MUSIC_BEATS = 128; // 32 bars, about 58 seconds before the theme returns.
export const MUSIC_TRACKS = {
  samurai: { title: '月下交锋', bpm: MUSIC_BPM, beats: MUSIC_BEATS, roomSeconds: 1.2, wet: .18, gain: 1 },
  ghost: { title: '幽村残笛', bpm: 124, beats: 128, roomSeconds: 1.8, wet: .16, gain: .96 },
};

// Battle arrangement informed by the traditional Sakura melody's repeated calls,
// arch-shaped phrases and descending cadences, recast in D/Eb/G/A/C.
// Reference transcription and arrangement notes: assets/audio/CREDITS.txt.
export function createGhostScore() {
  const events = [];
  const add = (beat, kind, note, gain, pan = 0, duration) => events.push({ beat, kind, note, gain, pan, ...(duration ? { duration } : {}) });
  // Beat, MIDI pitch, written length in beats. Repeated calls establish the tune;
  // the middle descends to the lower register, then the call returns and resolves.
  const melody = [
    [[0, 67, .9], [1, 67, .9], [2, 69, 1.8]],
    [[0, 67, .9], [1, 67, .9], [2, 69, 1.8]],
    [[0, 67, .9], [1, 69, .9], [2, 72, .9], [3, 69, .9]],
    [[0, 67, .9], [1, 69, .4], [1.5, 67, .4], [2, 63, 1.7]],
    [[0, 62, .9], [1, 60, .9], [2, 62, .9], [3, 63, .9]],
    [[0, 62, .9], [1, 62, .4], [1.5, 60, .4], [2, 57, 1.7]],
    [[0, 67, .9], [1, 69, .9], [2, 72, .9], [3, 69, .9]],
    [[0, 67, .9], [1, 69, .4], [1.5, 67, .4], [2, 63, 1.7]],
    [[0, 62, .9], [1, 60, .9], [2, 62, .9], [3, 63, .9]],
    [[0, 62, .9], [1, 62, .4], [1.5, 60, .4], [2, 57, 1.7]],
    [[0, 67, .9], [1, 67, .9], [2, 69, 1.8]],
    [[0, 67, .9], [1, 67, .9], [2, 69, 1.8]],
    [[0, 60, .9], [1, 62, .9], [2, 63, 1.8]],
    [[0, 69, 1.4], [1.5, 67, .4], [2, 63, .9], [3, 62, .9]],
    [[0, 62, 2.7], [3, 57, .4], [3.5, 60, .4]],
    [[0, 63, .9], [1, 62, 2.4]],
  ];
  for (let bar = 0; bar < 32; bar++) {
    const start = bar * 4, section = Math.floor(bar / 8), intense = section === 2;
    const fluteLead = section % 2 === 1;
    // Four-beat anchors and syncopated offbeats follow the samurai track's pulse.
    add(start, 'taiko', -2, .64, -.12);
    add(start + 2, 'taiko', -4, .48, .12);
    if (bar % 4 !== 3) add(start + 1.5, 'taiko', 2, .27, .2);
    if (bar % 2 || intense) add(start + 3.5, 'taiko', 0, .36, -.2);
    for (const beat of [1, 3]) add(start + beat, 'rim', -2, .12, .3);
    if (bar % 8 === 7) for (const beat of [3.5, 3.75]) add(start + beat, 'rim', 0, .14, -.3);
    for (const [beat, note, duration] of melody[bar % 16]) {
      add(start + beat, fluteLead ? 'shakuhachi' : 'koto', note,
        (fluteLead ? .23 : .30) * (beat === 0 ? 1 : .88), fluteLead ? .16 : -.18, duration);
    }
    // The accompanying koto only marks the low pedal, never a competing melody.
    if (fluteLead) {
      add(start + .5, 'koto', 50, .09, -.25, .55);
      add(start + 2.5, 'koto', 57, .075, -.25, .55);
    }
    for (const beat of (intense ? [0, 1, 2, 3] : [0, 2])) {
      add(start + beat, 'strings', beat === 2 ? 45 : 38, intense ? .12 : .10, .05, .7);
    }
    if (bar % 4 === 0) {
      add(start, 'sho', 50, .035, -.18, 6);
      add(start + .08, 'sho', 57, .02, .24, 6);
    }
    if (bar % 8 === 0) {
      add(start, 'gong', -3, .14);
      add(start + .5, 'rin', section === 2 ? 74 : 62, .10, .35);
    }
  }
  return events.sort((a, b) => a.beat - b.beat);
}

export function createScore() {
  const events = [];
  const add = (beat, kind, note, gain, pan = 0) => events.push({ beat, kind, note, gain, pan });
  const roots = [40, 40, 38, 45, 40, 41, 47, 40];
  // E-based Japanese pentatonic motifs, answered by a higher flute in the second half.
  const motifs = [
    [64, null, 65, 69, 71, null, 69, 65], [64, 71, null, 74, 71, 69, null, 65],
    [62, null, 65, 69, 74, 71, 69, null], [69, 71, 74, null, 76, 74, 71, 69],
    [64, null, 71, 69, 65, 64, null, 59], [65, 69, null, 71, 74, null, 71, 69],
    [71, null, 74, 76, 77, 76, 74, 71], [69, 65, 64, null, 59, null, 64, null],
  ];
  for (let bar = 0; bar < 32; bar++) {
    const start = bar * 4, root = roots[bar % 8], intense = bar >= 16;
    add(start, 'taiko', 0, .68, -.12);
    add(start + 2, 'taiko', -3, .48, .12);
    add(start + 1.5, 'taiko', 4, .3, .22);
    if (bar % 2 || intense) add(start + 3.5, 'taiko', 2, .4, -.2);
    for (const beat of [1, 2.5, 3]) add(start + beat, 'rim', 0, .16, .32);
    if (bar % 4 === 3) for (const beat of [3.25, 3.5, 3.75]) add(start + beat, 'rim', 2, .14 + (beat - 3) * .1, -.3);
    if (bar % 8 === 0) add(start, 'gong', 0, .25);
    for (let eighth = 0; eighth < 8; eighth++) {
      const note = motifs[bar % 8][eighth];
      if (note !== null) add(start + eighth / 2, 'pluck', note, eighth % 2 ? .21 : .29, -.28);
      if (intense || eighth % 2 === 0) {
        add(start + eighth / 2, 'strings', root + (eighth % 4 === 2 ? 7 : 0), intense ? .16 : .12, .1);
      }
    }
    if (bar >= 8 && bar % 2 === 0) {
      add(start + .25, 'flute', motifs[bar % 8][0] + 12, .23, .28);
      add(start + 2.25, 'flute', motifs[bar % 8][4] + (intense ? 12 : 0), .19, .28);
    }
  }
  return events.sort((a, b) => a.beat - b.beat);
}
