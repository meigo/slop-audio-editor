import { describe, expect, it } from "vitest";
import { NORMALISE_CEILING_DBFS, normalisationGain } from "./normalise";

const at = (measured: number, peak: number, target: number) =>
  normalisationGain(measured, peak, target);

describe("normalisationGain", () => {
  it("reaches the target exactly when the peak allows it", () => {
    // -30 LUFS with a tiny peak: 14 dB of gain is available before the ceiling.
    const r = at(-30, 0.05, -16);
    expect(r.achievedLufs).toBeCloseTo(-16, 6);
    expect(r.limitedByPeak).toBe(false);
  });

  it("always reaches the target when turning DOWN, whatever the peak", () => {
    const r = at(-6, 1, -23);
    expect(r.achievedLufs).toBeCloseTo(-23, 6);
    expect(r.limitedByPeak).toBe(false);
  });

  // The honest case: get as far as the ceiling allows and say so, rather than squashing the mix
  // with a limiter to hit the number.
  it("stops at the ceiling and reports falling short", () => {
    const r = at(-30, 0.5, -16); // wants +14 dB, headroom to the ceiling allows only ~+5 dB
    expect(r.limitedByPeak).toBe(true);
    expect(r.achievedLufs).toBeGreaterThan(-30); // it did move up
    expect(r.achievedLufs).toBeLessThan(-16); // but not all the way
  });

  // Uncovered by a wrong assumption in the test above: a mix whose peak is ALREADY over the
  // ceiling is turned down to respect it, even though the loudness target asked for more.
  it("turns a mix down when its peak already exceeds the ceiling", () => {
    const r = at(-30, 0.9, -16);
    expect(r.gain).toBeLessThan(1);
    expect(0.9 * r.gain).toBeCloseTo(10 ** (NORMALISE_CEILING_DBFS / 20), 9);
    expect(r.limitedByPeak).toBe(true);
  });

  it("never lets the result exceed the ceiling", () => {
    for (const peak of [0.2, 0.5, 0.9, 1]) {
      const r = at(-40, peak, -6);
      expect(peak * r.gain).toBeLessThanOrEqual(10 ** (NORMALISE_CEILING_DBFS / 20) + 1e-9);
    }
  });

  it("is a no-op for a mix already at the target", () => {
    const r = at(-16, 0.5, -16);
    expect(r.gain).toBeCloseTo(1, 9);
  });

  // Silence measures -Infinity and cannot be scaled to anything.
  it("leaves silence alone rather than multiplying by infinity", () => {
    const r = at(-Infinity, 0, -16);
    expect(r.gain).toBe(1);
    expect(r.achievedLufs).toBe(-Infinity);
    expect(r.limitedByPeak).toBe(false);
  });

  it("leaves a non-finite peak alone", () => {
    expect(at(-20, 0, -16).gain).toBe(1);
  });
});
