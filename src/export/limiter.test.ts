import { describe, expect, it } from "vitest";
import { LIMITER_LOOKAHEAD_S, limitPeaks } from "./limiter";

const SR = 48000;
const CEILING_DB = -1;
const CEILING = 10 ** (CEILING_DB / 20);

function tone(n: number, amp: number, hz = 200): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return a;
}
const peakOf = (a: Float32Array): number => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

describe("limitPeaks", () => {
  it("leaves material below the ceiling BIT-EXACT", () => {
    const input = tone(4800, 0.5);
    const ch = Float32Array.from(input);

    const { maxReductionDb } = limitPeaks([ch], SR, CEILING_DB);

    expect([...ch]).toEqual([...input]); // not "close to" — untouched
    expect(maxReductionDb).toBe(0);
  });

  it("never exceeds the ceiling, whatever the material", () => {
    const cases: Record<string, Float32Array> = {
      isolatedSpike: (() => {
        const a = new Float32Array(4800);
        a[2400] = 4;
        return a;
      })(),
      densePeaks: (() => {
        const a = new Float32Array(4800);
        for (let i = 0; i < a.length; i += 50) a[i] = i % 100 === 0 ? 3 : -2.5;
        return a;
      })(),
      fullScaleSquare: Float32Array.from({ length: 4800 }, (_, i) => (i % 64 < 32 ? 2 : -2)),
      loudTone: tone(4800, 1.8),
    };
    for (const [name, input] of Object.entries(cases)) {
      const ch = Float32Array.from(input);
      limitPeaks([ch], SR, CEILING_DB);
      expect(peakOf(ch), name).toBeLessThanOrEqual(CEILING + 1e-6);
    }
  });

  it("starts reducing BEFORE the peak — the point of looking ahead", () => {
    const spike = 2400;
    const ch = new Float32Array(4800).fill(0.1);
    ch[spike] = 4;
    const before = Float32Array.from(ch);

    limitPeaks([ch], SR, CEILING_DB);

    const lookaheadSamples = Math.round(LIMITER_LOOKAHEAD_S * SR);
    const early = spike - Math.floor(lookaheadSamples / 2);
    expect(ch[early] / before[early]).toBeLessThan(1); // already ducking
    expect(ch[spike - lookaheadSamples - 20] / before[spike - lookaheadSamples - 20]).toBe(1);
  });

  it("releases more slowly than it attacks, so it cannot pump", () => {
    const spike = 1000;
    const ch = new Float32Array(24000).fill(0.1);
    ch[spike] = 4;
    limitPeaks([ch], SR, CEILING_DB);

    const gainAt = (i: number) => ch[i] / 0.1;
    const attackSamples =
      spike -
      (() => {
        let i = spike;
        while (i > 0 && gainAt(i - 1) < 0.999) i--;
        return i;
      })();
    const releaseSamples = (() => {
      let i = spike;
      while (i < ch.length - 1 && gainAt(i + 1) < 0.999) i++;
      return i - spike;
    })();
    expect(releaseSamples).toBeGreaterThan(attackSamples * 5);
  });

  it("applies ONE envelope to both channels, so the stereo image does not shift", () => {
    const l = new Float32Array(4800).fill(0.2);
    const r = new Float32Array(4800).fill(0.2);
    // The peak is on the RIGHT — deliberately not channel 0, or an implementation that only ever
    // looks at the first channel passes this while letting the other one clip.
    r[2400] = 4;

    limitPeaks([l, r], SR, CEILING_DB);

    expect(peakOf(r)).toBeLessThanOrEqual(CEILING + 1e-6);
    expect(l[2400] / 0.2).toBeCloseTo(r[2399] / 0.2, 5); // both ducked by the same envelope
    expect(l[2400]).toBeLessThan(0.2);
  });

  it("ramps the reduction in rather than stepping — a gain step is itself a click", () => {
    const ch = new Float32Array(4800).fill(0.1);
    ch[2400] = CEILING * 4; // 12 dB of reduction to reach
    limitPeaks([ch], SR, CEILING_DB);

    let biggestStep = 0;
    for (let i = 1; i < 2400; i++) {
      biggestStep = Math.max(biggestStep, Math.abs(ch[i] / 0.1 - ch[i - 1] / 0.1));
    }
    // Spread over the lookahead this is ~0.008 per sample; dropped in one sample it is 0.75.
    expect(biggestStep).toBeLessThan(0.05);
  });

  it("leaves silence alone", () => {
    const ch = new Float32Array(480);
    const { maxReductionDb } = limitPeaks([ch], SR, CEILING_DB);
    expect([...ch]).toEqual([...new Float32Array(480)]);
    expect(maxReductionDb).toBe(0);
  });

  it("reports the deepest reduction it applied", () => {
    const ch = new Float32Array(4800).fill(0.1);
    ch[2400] = CEILING * 4; // needs exactly 12 dB of reduction at the peak
    const { maxReductionDb } = limitPeaks([ch], SR, CEILING_DB);
    expect(maxReductionDb).toBeCloseTo(12, 1);
  });

  it("handles an empty buffer", () => {
    expect(limitPeaks([new Float32Array(0)], SR, CEILING_DB).maxReductionDb).toBe(0);
    expect(limitPeaks([], SR, CEILING_DB).maxReductionDb).toBe(0);
  });
});
