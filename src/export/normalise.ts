import { amplitudeToDbfs, peakAmplitude } from "../audio/peak";
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
