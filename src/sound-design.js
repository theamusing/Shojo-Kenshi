// Original BGM instruments. Combat effects use CC0 recordings in assets/audio.
const TAU = Math.PI * 2;
export const SOUND_DURATIONS = {
  taiko: 1.15, rim: .20, pluck: 1.4, flute: 1.4, strings: 1.6, gong: 2.8,
};
export const SFX_PITCH_RANGES = { swing: 2, hit: .5, parry: 1.2 }; // semitones either side
export function pitchVariation(kind, random = Math.random) {
  return 2 ** (((random() * 2 - 1) * SFX_PITCH_RANGES[kind]) / 12);
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
