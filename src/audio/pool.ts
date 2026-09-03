import { PEAK_SAMPLES_PER_PAIR, newId } from "../doc/document";
import type { SourceRecord } from "../persist/project-file";
import { getAudioContext } from "./context";
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
  const peaks = await computePeaksChunked(channels, PEAK_SAMPLES_PER_PAIR, onProgress);
  return { id, name, bytes, buffer, peaks, durationS: buffer.duration };
}

export async function sourceFromFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<Source> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeSource(newId("src"), file.name, bytes, onProgress);
}
