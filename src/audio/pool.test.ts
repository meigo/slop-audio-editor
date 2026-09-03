import { describe, expect, it } from "vitest";
import { computePeaks } from "./peaks";
import { computePeaksChunked, SourcePool, type Source } from "./pool";

function fakeSource(id: string, name: string): Source {
  return {
    id, name, bytes: new Uint8Array([1, 2]),
    buffer: null as unknown as AudioBuffer, // the pool never touches the buffer
    peaks: new Float32Array([0, 0]), durationS: 1.5,
  };
}

describe("SourcePool", () => {
  it("stores and retrieves by id", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    expect(pool.get("a")?.name).toBe("a.wav");
    expect(pool.get("nope")).toBeUndefined();
  });

  it("lists everything it holds", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    pool.add(fakeSource("b", "b.mp3"));
    expect(pool.all().map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("produces SourceRecords carrying only what a project file needs", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    expect(pool.records()).toEqual([
      { id: "a", name: "a.wav", bytes: new Uint8Array([1, 2]) },
    ]);
  });

  it("clears on project open", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    pool.clear();
    expect(pool.all()).toEqual([]);
  });

  it("replaces a source added twice under the same id", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "old.wav"));
    pool.add(fakeSource("a", "new.wav"));
    expect(pool.all()).toHaveLength(1);
    expect(pool.get("a")?.name).toBe("new.wav");
  });
});

describe("computePeaksChunked", () => {
  // Mirrors PEAK_CHUNK_PAIRS in pool.ts (4096). Kept small samplesPerPair so a real chunk-boundary
  // crossing doesn't require allocating millions of samples.
  const PEAK_CHUNK_PAIRS = 4096;
  const samplesPerPair = 4;

  // Two independently-scaled ramps: monotonic (so a misaligned offset produces detectably wrong
  // values, unlike an all-zeros input) and per-channel-distinct (so channel averaging is exercised).
  function ramp(n: number, scale: number): Float32Array {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = i * scale;
    return out;
  }

  it("matches unchunked computePeaks exactly across an exact multiple of the chunk size", async () => {
    const totalPairs = PEAK_CHUNK_PAIRS * 2;
    const n = totalPairs * samplesPerPair;
    const channels = [ramp(n, 1), ramp(n, 2)];
    const expected = computePeaks(channels, samplesPerPair);
    const actual = await computePeaksChunked(channels, samplesPerPair);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it("matches unchunked computePeaks exactly with a partial final chunk", async () => {
    const totalPairs = PEAK_CHUNK_PAIRS * 2 + 37;
    // n is not a multiple of samplesPerPair, so the last pair (and the last chunk) is partial —
    // this is what exercises the `Math.min(n, endPair * samplesPerPair)` clipping.
    const n = totalPairs * samplesPerPair - 3;
    const channels = [ramp(n, 1), ramp(n, 2)];
    const expected = computePeaks(channels, samplesPerPair);
    const actual = await computePeaksChunked(channels, samplesPerPair);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });
});
