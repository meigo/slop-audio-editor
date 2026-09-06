import { describe, expect, it } from "vitest";
import { aggregatePeaks, computePeaks, peakPairCount } from "./peaks";

/** A ramp from -1 to +1 over `n` samples. */
function ramp(n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = -1 + (2 * i) / (n - 1);
  return a;
}

describe("computePeaks", () => {
  it("produces one min/max pair per bucket", () => {
    const peaks = computePeaks([new Float32Array(1024)], 256);
    expect(peaks).toHaveLength(8); // 4 pairs
    expect(peakPairCount(peaks)).toBe(4);
  });

  it("captures the min and max within each bucket", () => {
    const ch = new Float32Array([0, 0.5, -0.25, 0]);
    const peaks = computePeaks([ch], 4);
    expect(peaks[0]).toBeCloseTo(-0.25);
    expect(peaks[1]).toBeCloseTo(0.5);
  });

  it("takes the extremes ACROSS channels, so anti-phase stereo is not drawn as silence", () => {
    // This used to average the channels, which for L = -R summed to zero: a real, audible signal
    // drawn as a flat line. Hard-panned material had the same problem at half strength — a clip
    // playing only on the left drew half height. The waveform is meant to show what you will
    // hear, and the loudest channel is what you hear.
    const l = new Float32Array([1, 1]);
    const r = new Float32Array([-1, -1]);
    const peaks = computePeaks([l, r], 2);
    expect(peaks[0]).toBeCloseTo(-1); // min across both channels
    expect(peaks[1]).toBeCloseTo(1); // max across both channels
  });

  it("draws a hard-panned source at its own height, not half of it", () => {
    const loud = new Float32Array([0.8, -0.8]);
    const silent = new Float32Array([0, 0]);
    const peaks = computePeaks([loud, silent], 2);
    expect(peaks[0]).toBeCloseTo(-0.8);
    expect(peaks[1]).toBeCloseTo(0.8);
  });

  it("handles a final partial bucket", () => {
    expect(peakPairCount(computePeaks([new Float32Array(300)], 256))).toBe(2);
  });

  it("returns an empty array for empty input", () => {
    expect(computePeaks([new Float32Array(0)], 256)).toHaveLength(0);
    expect(computePeaks([], 256)).toHaveLength(0);
  });

  it("reports silence as a zero pair", () => {
    const peaks = computePeaks([new Float32Array(256)], 256);
    expect([...peaks]).toEqual([0, 0]);
  });
});

describe("aggregatePeaks", () => {
  // 48000 samples at 48 kHz = 1 s, 256 samples per pair => 187.5 pairs.
  const peaks = computePeaks([ramp(48000)], 256);

  it("returns exactly `width` pairs", () => {
    expect(aggregatePeaks(peaks, 48000, 256, 0, 1, 100)).toHaveLength(200);
  });

  it("spans the requested window, rising across a ramp", () => {
    const out = aggregatePeaks(peaks, 48000, 256, 0, 1, 4);
    expect(out[1]).toBeLessThan(out[7]); // first column's max < last column's max
    expect(out[0]).toBeCloseTo(-1, 1);
    expect(out[7]).toBeCloseTo(1, 1);
  });

  it("zooms into a sub-window", () => {
    const out = aggregatePeaks(peaks, 48000, 256, 0.9, 1.0, 2);
    expect(out[0]).toBeGreaterThan(0.5); // late in a -1..+1 ramp, everything is positive
  });

  it("pads with zeros past the end of the source", () => {
    const out = aggregatePeaks(peaks, 48000, 256, 2, 3, 4);
    expect([...out]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("never returns an empty column inside the source, even when zoomed past 1 pair per column", () => {
    const out = aggregatePeaks(peaks, 48000, 256, 0.5, 0.5001, 50);
    for (let i = 0; i < out.length; i += 2) expect(out[i + 1]).toBeGreaterThan(out[i] - 1e-9);
    expect(out.some((v) => v !== 0)).toBe(true);
  });

  it("returns zeros for a zero or negative width window", () => {
    expect([...aggregatePeaks(peaks, 48000, 256, 1, 1, 2)]).toEqual([0, 0, 0, 0]);
  });
});
