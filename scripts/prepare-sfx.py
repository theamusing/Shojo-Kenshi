"""Prepare the four runtime recordings from source-assets/audio (offline).

Original inputs are included in source-assets/audio.
Requires numpy, scipy and soundfile. See assets/audio/CREDITS.txt.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfilt

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'source-assets/audio'
OUT = ROOT / 'assets/audio'
RATE = 44100
manifest = []


def read(name, highpass=60, tail=.08, max_length=1.2):
    samples, rate = sf.read(RAW / name, always_2d=True)
    samples = samples.mean(axis=1)
    divisor = math.gcd(rate, RATE)
    samples = resample_poly(samples, RATE // divisor, rate // divisor)
    samples = sosfilt(butter(2, highpass, 'highpass', fs=RATE, output='sos'), samples)
    # Remove leading room noise so recorded impacts align with the collision frame.
    peak = np.max(np.abs(samples))
    active = np.flatnonzero(np.abs(samples) > peak * .025)
    start = max(0, active[0] - int(.003 * RATE))
    end = min(len(samples), active[-1] + int(tail * RATE), start + int(max_length * RATE))
    return samples[start:end] / peak


def mix(*layers):
    result = np.zeros(max(len(data) + int(offset * RATE) for data, gain, offset in layers))
    for data, gain, offset in layers:
        start = int(offset * RATE)
        result[start:start + len(data)] += data * gain
    return result


def write(name, samples, sources, processing, license='CC0-1.0'):
    if name == 'hit.wav':
        # Filter after saturation and wet layering, including any new harmonics.
        # Hit 3 needs more upper-mid detail at its slowed in-game playback rate.
        cutoff, order = 4800, 2
        samples = sosfilt(butter(order, cutoff, 'lowpass', fs=RATE, output='sos'), samples)
        processing += f' Final {cutoff / 1000:g}kHz order-{order} low-pass after all mixing/saturation to soften the high end.'
    fade_in = min(int(.001 * RATE), len(samples))
    fade_out = min(int(.018 * RATE), len(samples))
    samples[:fade_in] *= np.linspace(0, 1, fade_in)
    samples[-fade_out:] *= np.linspace(1, 0, fade_out)
    samples *= .9 / np.max(np.abs(samples))
    target = OUT / name
    sf.write(target, samples, RATE, subtype='PCM_16')
    manifest.append({
        'file': name, 'duration': round(len(samples) / RATE, 4), 'license': license,
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'processing': processing,
        'sources': [{'file': (RAW / source).relative_to(ROOT).as_posix(),
                     'sha256': hashlib.sha256((RAW / source).read_bytes()).hexdigest()} for source in sources],
    })


OUT.mkdir(parents=True, exist_ok=True)
for name in ['boss-swing', 'player-swing']:
    source = f'{name}.flac'
    write(f'{name}.wav', read(source, 160, .035, .35), [source],
          'Mono, 44.1kHz, 160Hz high-pass, silence trim, short fades, peak normalization.')

# Preserve the original recording and produce the runtime WAV separately.
source = 'hit-original.mp3'
strike = read(source, 70, .04, .65)
strike = sosfilt(butter(2, 4200, 'lowpass', fs=RATE, output='sos'), strike)
window = int(.015 * RATE)
energy = np.convolve(strike ** 2, np.ones(window) / window, mode='same')
accent = np.argmax(energy) / RATE
time = np.arange(len(strike)) / RATE
# Hold the main impact, then smoothly push its trailing sound down by 14dB.
progress = np.clip((time - accent - .045) / .11, 0, 1)
envelope = 1 - .8 * (progress ** 2 * (3 - 2 * progress))
envelope *= np.exp(-np.maximum(0, time - accent - .2) * 5)
strike *= envelope
wet_source = 'hit-wet.flac'
wet = read(wet_source, 160, .015, .20)
wet = sosfilt(butter(2, 2400, 'lowpass', fs=RATE, output='sos'), wet)
wet /= max(np.max(np.abs(wet)), 1e-9)
wet *= np.exp(-np.arange(len(wet)) / RATE * 18)
wet[-int(.02 * RATE):] *= np.linspace(1, 0, int(.02 * RATE))
strike = mix((strike, 1, 0), (wet, np.max(np.abs(strike)) * .18, max(0, accent - .01)))
write('hit.wav', strike, [source, wet_source],
      f'User-provided MP3, mono 44.1kHz, 70Hz high-pass, 4.2kHz low-pass; accent at {accent:.3f}s; '
      '45ms accent hold, 110ms smooth tail reduction to -14dB then decay; short CC0 wet impact layer at 18% peak, '
      '2.4kHz low-pass, 200ms cap and fast decay; fades, peak normalization. Original MP3 preserved.',
      license='User-provided; source license unspecified (wet layer: CC0-1.0)')

source = 'parry.ogg'
clang = read(source, 180, .3, 1.1)
write('parry.wav', mix((clang, 1, 0), (clang, .1, .035), (clang, .06, .071)), [source],
      'Recorded blade clash, 180Hz high-pass, trim, two quiet early reflections, fades, peak normalization.')

(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'files': len(manifest), 'total_bytes': sum((OUT / row['file']).stat().st_size for row in manifest),
                  'durations': {row['file']: row['duration'] for row in manifest}}, indent=2))
