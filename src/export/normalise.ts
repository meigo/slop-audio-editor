import { amplitudeToDbfs, peakAmplitude } from "../audio/peak";
import { limitPeaks } from "./limiter";
import { integratedLoudness } from "../audio/loudness";
import { PROJECT_SAMPLE_RATE } from "../doc/document";

/** Loudness targets offered on export, in LUFS. */
export const NORMALISE_TARGETS = [
  { label: "Off", lufs: null },
  { label: "−14 LUFS (streaming)", lufs: -14 },
  { label: "−16 LUFS (podcast)", lufs: -16 },
  { label: "−23 LUFS (EBU R128)", lufs: -23 },
] as const;

/** Peak the normalised mix may not exceed. A little under full scale, so the file survives a
 *  lossy encoder — MP3/AAC decode with slightly different sample values and a 0 dBFS master can
 *  come back over. */
export const NORMALISE_CEILING_DBFS = -1;

export interface Normalisation {
  /** Linear gain to apply to every sample. */
  gain: number;
  /** What the mix will actually measure afterwards — not always the target. */
  achievedLufs: number;
  /** True when the ceiling stopped it reaching the target. */
  limitedByPeak: boolean;
}

/**
 * The gain that moves a mix to `targetLufs` without pushing its peak past the ceiling.
 *
 * Pure arithmetic, so the decision is testable without rendering anything. Gain-only on purpose:
 * a limiter would always hit the number, but by changing the dynamics — the file would no longer
 * be the mix that was monitored. Falling 0.2 dB short and saying so is the better trade.
 */
export function normalisationGain(
  measuredLufs: number,
  peak: number,
  targetLufs: number,
  ceilingDbfs: number = NORMALISE_CEILING_DBFS,
): Normalisation {
  // Silence has no level to scale, and a zero peak gives no headroom to reason about.
  if (!Number.isFinite(measuredLufs) || !(peak > 0)) {
    return { gain: 1, achievedLufs: measuredLufs, limitedByPeak: false };
  }
  const desired = 10 ** ((targetLufs - measuredLufs) / 20);
  const maxByPeak = 10 ** (ceilingDbfs / 20) / peak;
  const gain = Math.min(desired, maxByPeak);
  return {
    gain,
    achievedLufs: measuredLufs + 20 * Math.log10(gain),
    limitedByPeak: gain < desired,
  };
}

/** Measure a rendered mixdown. The buffer is always stereo, so `integratedLoudness` is used
 *  directly — `computeLoudnessChunked`'s mono→dual-mono correction (see the loudness gotcha)
 *  applies to single-channel SOURCES and would bias a mix by ~3 dB. */
export function measureMix(buffer: AudioBuffer): { lufs: number; peak: number; peakDbfs: number } {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  const peak = peakAmplitude(channels);
  return {
    lufs: integratedLoudness(channels, PROJECT_SAMPLE_RATE),
    peak,
    peakDbfs: amplitudeToDbfs(peak),
  };
}

/** Scale every sample in place. Applied to the RENDERED buffer, never to the node graph: the
 *  graph is shared by preview and export, and a gain stage in there would make them differ. */
export function applyGain(buffer: AudioBuffer, gain: number): void {
  if (gain === 1) return;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
}

/** How many gain-then-limit passes to take before giving up on the target. Limiting LOWERS
 *  loudness, so one pass always undershoots — measured on a high-crest mix aiming at -16 LUFS,
 *  the passes landed at -19.53, -16.19, -16.01, which is why this is 4 and not 1. */
export const NORMALISE_MAX_PASSES = 4;

/** Stop once the remaining correction is smaller than this. Below a tenth of a dB nobody can hear
 *  the difference, and each further pass only squashes the mix more. */
export const NORMALISE_TOLERANCE_DB = 0.1;

export interface NormaliseResult {
  /** What the material actually measures afterwards — always the truth, never the target. */
  achievedLufs: number;
  /** Deepest reduction the limiter applied, across all passes. 0 when not limiting. */
  reductionDb: number;
  /** Gain-only mode: the peak ceiling stopped the target being reached. */
  limitedByPeak: boolean;
}

/**
 * Bring `channels` to `targetLufs`, in place.
 *
 * Without `limit` this is pure gain and lands short whenever the peak ceiling says so — the mix is
 * untouched but the number may not be met. With `limit`, the gain the target asks for is applied
 * in full and a brick-wall limiter deals with the peaks, repeated until the measurement settles:
 * one pass cannot converge, because limiting removes energy and therefore loudness.
 *
 * Loudness is measured with `integratedLoudness` DIRECTLY, never `computeLoudnessChunked` — that
 * function's dual-mono correction is for single-channel SOURCES, and a mixdown is already stereo.
 */
export function normaliseChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  targetLufs: number,
  limit: boolean,
): NormaliseResult {
  const scale = (gain: number): void => {
    if (gain === 1) return;
    for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  };

  if (!limit) {
    const n = normalisationGain(
      integratedLoudness(channels, sampleRate),
      peakAmplitude(channels),
      targetLufs,
    );
    scale(n.gain);
    return { achievedLufs: n.achievedLufs, reductionDb: 0, limitedByPeak: n.limitedByPeak };
  }

  let reductionDb = 0;
  for (let pass = 0; pass < NORMALISE_MAX_PASSES; pass++) {
    // Silence needs no guard of its own: `normalisationGain` returns a gain of 1 for a
    // non-finite measurement, which trips the convergence break below on the first pass.
    const lufs = integratedLoudness(channels, sampleRate);
    // No ceiling here: the limiter is what keeps the peaks in check, so capping the gain as well
    // would leave the target unreachable — the very thing the limiter was turned on to fix.
    const n = normalisationGain(lufs, peakAmplitude(channels), targetLufs, Infinity);
    if (Math.abs(20 * Math.log10(n.gain)) < NORMALISE_TOLERANCE_DB) break;
    scale(n.gain);
    const r = limitPeaks(channels, sampleRate);
    if (r.maxReductionDb > reductionDb) reductionDb = r.maxReductionDb;
  }
  return {
    achievedLufs: integratedLoudness(channels, sampleRate),
    reductionDb,
    limitedByPeak: false,
  };
}

/** `normaliseChannels` over a rendered buffer, in place. `getChannelData` returns a live view, so
 *  writing through it writes the buffer. */
export function normaliseBuffer(
  buffer: AudioBuffer,
  targetLufs: number,
  limit: boolean,
): NormaliseResult {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return normaliseChannels(channels, buffer.sampleRate, targetLufs, limit);
}
