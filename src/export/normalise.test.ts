import { describe, expect, it } from "vitest";
import { integratedLoudness } from "../audio/loudness";
import { NORMALISE_CEILING_DBFS, normalisationGain, normaliseChannels } from "./normalise";

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

describe("normalisationGain with the limiter on", () => {
  // The dialog passes an infinite ceiling when limiting: take the gain the TARGET asks for and
  // let the limiter deal with the peaks, instead of capping the gain and landing short.
  it("reaches the target when the peak ceiling is lifted", () => {
    const capped = normalisationGain(-30, 0.9, -16);
    const uncapped = normalisationGain(-30, 0.9, -16, Infinity);

    expect(capped.limitedByPeak).toBe(true);
    expect(uncapped.limitedByPeak).toBe(false);
    expect(uncapped.achievedLufs).toBeCloseTo(-16, 6);
    expect(uncapped.gain).toBeGreaterThan(capped.gain);
  });
});

/** A quiet body with sparse transients — high crest factor, the case gain-only normalisation
 *  cannot solve. 4 s so the BS.1770 gating has enough 400 ms blocks to work with. */
function highCrestMix(): Float32Array[] {
  const SR = 48000;
  const n = SR * 4;
  return [0, 1].map(() => {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = 0.02 * Math.sin((2 * Math.PI * 220 * i) / SR);
    for (let k = 0; k < 8; k++) {
      const at = 3000 + k * 5500;
      for (let j = 0; j < 40; j++) d[at + j] = 0.85 * Math.exp(-j / 8);
    }
    return d;
  });
}

/** A mix sitting exactly on `targetLufs` whose peaks are still above the ceiling — the ordinary
 *  "mixed to -16, peaks near full scale" case. Its crest factor is what matters (peak vs ceiling
 *  is scale-invariant), so the bed level is chosen to give ~15 dB of it; the scale to the target
 *  is by MEASUREMENT, and the test asserts the fixture really is over the ceiling before it
 *  asserts anything else. */
function onTargetButHot(targetLufs: number): Float32Array[] {
  const SR = 48000;
  const n = SR * 4;
  const ch = [0, 1].map(() => {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = 0.18 * Math.sin((2 * Math.PI * 220 * i) / SR);
    for (let k = 0; k < 8; k++) {
      const at = 3000 + k * 5500;
      for (let j = 0; j < 60; j++) d[at + j] = 0.99 * Math.exp(-j / 20);
    }
    return d;
  });
  const gain = 10 ** ((targetLufs - integratedLoudness(ch, SR)) / 20);
  for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= gain;
  return ch;
}

describe("normaliseChannels", () => {
  const SR = 48000;
  // A loop, not `Math.max(...spread)`: these buffers are 192k samples and spreading them blows
  // the call stack.
  const peakDb = (chs: Float32Array[]) => {
    let peak = 0;
    for (const c of chs) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
    return 20 * Math.log10(peak);
  };

  it("falls short without the limiter, and says so", () => {
    const ch = highCrestMix();
    const r = normaliseChannels(ch, SR, -16, false);

    expect(r.limitedByPeak).toBe(true);
    expect(r.achievedLufs).toBeLessThan(-25); // nowhere near -16
    expect(r.reductionDb).toBe(0); // and the dynamics are untouched
  });

  it("reaches the target with the limiter — which one pass could not", () => {
    const ch = highCrestMix();
    const r = normaliseChannels(ch, SR, -16, true);

    expect(r.achievedLufs).toBeCloseTo(-16, 0);
    expect(r.reductionDb).toBeGreaterThan(6); // and it cost real dynamics, which it reports
    expect(peakDb(ch)).toBeLessThanOrEqual(-1 + 1e-6);
  });

  it("holds the ceiling however hard the target pushes", () => {
    const ch = highCrestMix();
    normaliseChannels(ch, SR, -6, true); // an aggressive target
    expect(peakDb(ch)).toBeLessThanOrEqual(-1 + 1e-6);
  });

  it("does nothing to material already on target", () => {
    const ch = highCrestMix();
    normaliseChannels(ch, SR, -16, true);
    const settled = ch.map((c) => Float32Array.from(c));

    const again = normaliseChannels(ch, SR, -16, true);

    expect(again.reductionDb).toBe(0); // no further squashing
    expect([...ch[0]]).toEqual([...settled[0]]);
  });

  it("still limits a mix that is already at the target but over the ceiling", () => {
    // The ordinary case: mixed to -16 with peaks near full scale, exported at -16 with the
    // limiter ticked. The loop used to break on the gain tolerance BEFORE limiting, so the
    // limiter the user asked for never ran and the file went out above the ceiling.
    const ch = onTargetButHot(-16);
    expect(peakDb(ch)).toBeGreaterThan(NORMALISE_CEILING_DBFS); // the fixture must actually be hot

    const r = normaliseChannels(ch, SR, -16, true);

    expect(peakDb(ch)).toBeLessThanOrEqual(NORMALISE_CEILING_DBFS + 1e-6);
    expect(r.reductionDb).toBeGreaterThan(0); // and it says what it cost
    expect(r.achievedLufs).toBeCloseTo(-16, 0);
  });

  it("leaves silence alone rather than looping on an infinite gain", () => {
    const ch = [new Float32Array(48000), new Float32Array(48000)];
    const r = normaliseChannels(ch, SR, -16, true);
    expect(r.reductionDb).toBe(0);
    expect(ch[0].every((x) => x === 0)).toBe(true);
  });
});
