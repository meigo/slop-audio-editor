import { PEAK_SAMPLES_PER_PAIR, PROJECT_SAMPLE_RATE, newId } from "../doc/document";
import type { SourceRecord } from "../persist/project-file";
import { getAudioContext } from "./context";
import {
  BLOCK_S,
  HOP_S,
  createKWeightFilter,
  gatedLoudnessFromBlockPowers,
  weightedBlockPower,
} from "./loudness";
import { computePeaks } from "./peaks";

export interface Source {
  id: string;
  name: string;
  /** Original encoded bytes, kept for the project file. */
  bytes: Uint8Array;
  /** Decoded at PROJECT_SAMPLE_RATE. */
  buffer: AudioBuffer;
  peaks: Float32Array;
  durationS: number;
  /** ITU-R BS.1770 integrated loudness of the decoded audio, LUFS. -Infinity for silence. */
  loudnessLufs: number;
}

/** Session-scoped, append-only, NOT part of undo history. Cleared only when a project is opened. */
export class SourcePool {
  #byId = new Map<string, Source>();

  add(source: Source): void {
    this.#byId.set(source.id, source);
  }

  get(id: string): Source | undefined {
    return this.#byId.get(id);
  }

  all(): Source[] {
    return [...this.#byId.values()];
  }

  clear(): void {
    this.#byId.clear();
  }

  records(): SourceRecord[] {
    return this.all().map((s) => ({ id: s.id, name: s.name, bytes: s.bytes }));
  }
}

const PEAK_CHUNK_PAIRS = 4096;

/**
 * Peaks in chunks that yield to the event loop, so importing a 30-minute file does not freeze the
 * UI. Not a Worker: an `AudioBuffer` cannot be transferred, so a Worker would have to COPY every
 * channel across, and the copy costs about what the computation does.
 */
export async function computePeaksChunked(
  channels: readonly Float32Array[],
  samplesPerPair: number = PEAK_SAMPLES_PER_PAIR,
  onProgress?: (fraction: number) => void,
): Promise<Float32Array> {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return new Float32Array(0);
  const totalPairs = Math.ceil(n / samplesPerPair);
  const out = new Float32Array(totalPairs * 2);

  for (let p = 0; p < totalPairs; p += PEAK_CHUNK_PAIRS) {
    const endPair = Math.min(totalPairs, p + PEAK_CHUNK_PAIRS);
    const slice = channels.map((ch) =>
      ch.subarray(p * samplesPerPair, Math.min(n, endPair * samplesPerPair)),
    );
    out.set(computePeaks(slice, samplesPerPair), p * 2);
    onProgress?.(endPair / totalPairs);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

const LOUDNESS_CHUNK_SAMPLES = PEAK_CHUNK_PAIRS * PEAK_SAMPLES_PER_PAIR; // same order as the peak scan
const BLOCKS_PER_CHUNK = 256;

/**
 * Integrated loudness (see `loudness.ts`) computed in chunks that yield to the event loop, the
 * same reason `computePeaksChunked` exists: a long import must not freeze the UI. K-weighting
 * runs first, chunk by chunk with the filter state carried across chunk boundaries (an IIR filter
 * cannot be split any other way); block powers are then accumulated in chunks of blocks over the
 * now fully-weighted channels.
 */
export async function computeLoudnessChunked(
  channels: readonly Float32Array[],
  sampleRate: number = PROJECT_SAMPLE_RATE,
  onProgress?: (fraction: number) => void,
): Promise<number> {
  if (channels.length === 0) return -Infinity;
  const n = channels[0].length;
  const blockSize = Math.round(BLOCK_S * sampleRate);
  const hop = Math.round(HOP_S * sampleRate);
  if (n < blockSize) return -Infinity;

  const weighted = channels.map(() => new Float32Array(n));
  const filters = channels.map(() => createKWeightFilter());
  for (let start = 0; start < n; start += LOUDNESS_CHUNK_SAMPLES) {
    const end = Math.min(n, start + LOUDNESS_CHUNK_SAMPLES);
    for (let c = 0; c < channels.length; c++) {
      weighted[c].set(filters[c].process(channels[c].subarray(start, end)), start);
    }
    onProgress?.((end / n) * 0.5);
    await new Promise((r) => setTimeout(r, 0));
  }

  // Web Audio upmixes a mono buffer to stereo by DUPLICATION (L = R = input) under the default
  // "speakers" channel interpretation, and this app always renders stereo (AudioContext's default
  // destination, OfflineAudioContext(2, …) for export) — so a mono file and its dual-mono stereo
  // equivalent sound IDENTICAL here, even though `integratedLoudness` (a faithful, uncorrected
  // BS.1770 meter — see its own tests) measures them 3.01 dB apart, since the standard SUMS
  // per-channel power at G=1.0 rather than averaging. Measuring the raw mono channel alone would
  // under-report what will actually be heard, so "Match loudness" would over-boost every mono clip
  // by ~3 dB in a project that mixes mono and stereo sources — precisely the situation this feature
  // exists for. `weighted[0]` is referenced twice below, never duplicated, so this costs no extra
  // memory even on a long file.
  const measured = weighted.length === 1 ? [weighted[0], weighted[0]] : weighted;

  const numBlocks = Math.floor((n - blockSize) / hop) + 1;
  const blockPowers = new Array<number>(numBlocks);
  for (let i = 0; i < numBlocks; i += BLOCKS_PER_CHUNK) {
    const end = Math.min(numBlocks, i + BLOCKS_PER_CHUNK);
    for (let b = i; b < end; b++) {
      const s = b * hop;
      blockPowers[b] = weightedBlockPower(measured, s, s + blockSize);
    }
    onProgress?.(0.5 + (end / numBlocks) * 0.5);
    await new Promise((r) => setTimeout(r, 0));
  }

  return gatedLoudnessFromBlockPowers(blockPowers);
}

export async function decodeSource(
  id: string,
  name: string,
  bytes: Uint8Array,
  onProgress?: (fraction: number) => void,
): Promise<Source> {
  const ctx = getAudioContext();
  // decodeAudioData detaches the ArrayBuffer it is given, so hand it a copy and keep `bytes`.
  const ab = bytes.slice().buffer;
  const buffer = await ctx.decodeAudioData(ab);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  // Two chunked passes over the same decoded channels, each yielding to the event loop — one for
  // waveform peaks, one for loudness — so a long import never blocks the UI thread. Progress is
  // split across the two: the first half of the reported fraction is the peak scan, the second
  // half is the loudness pass.
  const peaks = await computePeaksChunked(channels, PEAK_SAMPLES_PER_PAIR, (f) =>
    onProgress?.(f * 0.5),
  );
  const loudnessLufs = await computeLoudnessChunked(channels, PROJECT_SAMPLE_RATE, (f) =>
    onProgress?.(0.5 + f * 0.5),
  );
  return { id, name, bytes, buffer, peaks, durationS: buffer.duration, loudnessLufs };
}

export async function sourceFromFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<Source> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeSource(newId("src"), file.name, bytes, onProgress);
}
