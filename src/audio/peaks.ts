import { PEAK_SAMPLES_PER_PAIR } from "../doc/document";

/**
 * Downsample to interleaved `[min, max]` pairs, one pair per `samplesPerPair` input samples,
 * taking the extremes ACROSS every channel. Computed ONCE per imported source; every zoom level is
 * drawn by aggregating from this one array (see `aggregatePeaks`).
 *
 * Across, not averaged. Averaging summed L and R and divided, so anti-phase stereo (L = -R) drew
 * as a FLAT LINE — audible material shown as silence — and anything hard-panned drew at half its
 * real height. The waveform is meant to show what you will hear, and what you hear is the loudest
 * channel, not their mean. It also matches the meter, which takes the max across channels for the
 * same reason (see `peakAmplitude`).
 */
export function computePeaks(
  channels: readonly Float32Array[],
  samplesPerPair: number = PEAK_SAMPLES_PER_PAIR,
): Float32Array {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return new Float32Array(0);
  const pairs = Math.ceil(n / samplesPerPair);
  const out = new Float32Array(pairs * 2);

  for (let p = 0; p < pairs; p++) {
    const start = p * samplesPerPair;
    const end = Math.min(n, start + samplesPerPair);
    let min = Infinity;
    let max = -Infinity;
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = ch[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    out[p * 2] = min;
    out[p * 2 + 1] = max;
  }
  return out;
}

export function peakPairCount(peaks: Float32Array): number {
  return peaks.length >> 1;
}

/**
 * `width` interleaved min/max pairs covering `[fromS, toS)` — one per pixel column.
 *
 * When zoomed in past one pair per column, neighbouring columns read the SAME pair rather than
 * some reading none: an empty column would draw as a gap in the middle of continuous audio.
 * Columns outside the source read as `[0, 0]` (silence), which is what a clip's unused tail is.
 */
export function aggregatePeaks(
  peaks: Float32Array,
  sampleRate: number,
  samplesPerPair: number,
  fromS: number,
  toS: number,
  width: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, width) * 2);
  if (width <= 0 || !(toS > fromS)) return out;

  const pairs = peakPairCount(peaks);
  const pairDurS = samplesPerPair / sampleRate;
  const stepS = (toS - fromS) / width;

  for (let col = 0; col < width; col++) {
    const t0 = fromS + col * stepS;
    const t1 = t0 + stepS;
    let lo = Math.floor(t0 / pairDurS);
    let hi = Math.ceil(t1 / pairDurS);
    if (hi <= lo) hi = lo + 1; // zoomed past one pair per column
    lo = Math.max(0, lo);
    hi = Math.min(pairs, hi);
    if (hi <= lo) continue; // outside the source — leave the [0, 0] silence

    let min = Infinity;
    let max = -Infinity;
    for (let p = lo; p < hi; p++) {
      const a = peaks[p * 2];
      const b = peaks[p * 2 + 1];
      if (a < min) min = a;
      if (b > max) max = b;
    }
    out[col * 2] = min;
    out[col * 2 + 1] = max;
  }
  return out;
}
