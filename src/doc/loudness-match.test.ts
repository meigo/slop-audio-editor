import { describe, expect, it } from "vitest";
import { MAX_MATCH_DB, matchLoudnessGains, type LoudnessEntry } from "./loudness-match";

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

describe("matchLoudnessGains", () => {
  it("targets the median LUFS: below-median clips are turned down, above-median turned up", () => {
    const entries: LoudnessEntry[] = [
      { clipId: "a", lufs: -14 },
      { clipId: "b", lufs: -19 },
      { clipId: "c", lufs: -26 },
    ];
    const gains = matchLoudnessGains(entries);
    const byId = Object.fromEntries(gains.map((g) => [g.clipId, g.gain]));
    // median is -19, so: a needs -5 dB, b needs 0 dB (unity), c needs +7 dB.
    expect(byId.a).toBeCloseTo(dbToGain(-5), 5);
    expect(byId.b).toBeCloseTo(1, 5);
    expect(byId.c).toBeCloseTo(dbToGain(7), 5);
  });

  it("uses the mean of the two middle values as the median for an even count", () => {
    // Sorted: -22, -20, -10, -8 -> median = mean(-20, -10) = -15, and every correction here stays
    // within the ±MAX_MATCH_DB clamp so it isolates the median calculation from clamping.
    const entries: LoudnessEntry[] = [
      { clipId: "a", lufs: -22 },
      { clipId: "b", lufs: -20 },
      { clipId: "c", lufs: -10 },
      { clipId: "d", lufs: -8 },
    ];
    const gains = matchLoudnessGains(entries);
    const byId = Object.fromEntries(gains.map((g) => [g.clipId, g.gain]));
    expect(byId.a).toBeCloseTo(dbToGain(7), 5); // -22 -> -15 needs +7 dB
    expect(byId.d).toBeCloseTo(dbToGain(-7), 5); // -8 -> -15 needs -7 dB
  });

  it("clamps a correction of 40 dB down to MAX_MATCH_DB, never boosting past the clamp", () => {
    const entries: LoudnessEntry[] = [
      { clipId: "quiet", lufs: -60 },
      { clipId: "loud", lufs: -20 },
    ];
    // median = mean(-60, -20) = -40; "quiet" needs +40 dB of correction, way past the clamp.
    const gains = matchLoudnessGains(entries);
    const quiet = gains.find((g) => g.clipId === "quiet");
    expect(quiet?.gain).toBeCloseTo(dbToGain(MAX_MATCH_DB), 5);
  });

  it("skips non-finite entries entirely — silence is never boosted", () => {
    const entries: LoudnessEntry[] = [
      { clipId: "a", lufs: -14 },
      { clipId: "silent", lufs: -Infinity },
      { clipId: "b", lufs: -19 },
    ];
    const gains = matchLoudnessGains(entries);
    expect(gains.some((g) => g.clipId === "silent")).toBe(false);
    expect(gains).toHaveLength(2);
  });

  it("returns [] for an empty list", () => {
    expect(matchLoudnessGains([])).toEqual([]);
  });

  it("returns [] when every entry is non-finite", () => {
    const entries: LoudnessEntry[] = [
      { clipId: "a", lufs: -Infinity },
      { clipId: "b", lufs: NaN },
    ];
    expect(matchLoudnessGains(entries)).toEqual([]);
  });

  it("gives a single entry unity gain — it is its own median", () => {
    const gains = matchLoudnessGains([{ clipId: "only", lufs: -30 }]);
    expect(gains).toEqual([{ clipId: "only", gain: 1 }]);
  });
});
