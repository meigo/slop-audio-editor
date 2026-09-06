import { describe, expect, it } from "vitest";
import {
  SATURATION_CURVE_POINTS,
  SATURATION_REFERENCE_AMPLITUDE,
  saturationCurve,
  saturationMakeup,
} from "./saturation";

const at = (curve: Float32Array, x: number): number =>
  curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

describe("saturationCurve", () => {
  it("is null at zero drive — a linear curve is not the same as no node", () => {
    expect(saturationCurve(0)).toBe(null);
  });

  /** RMS of a reference sine after shaping, which is what the makeup gain is calibrated against. */
  function shapedRms(curve: Float32Array, amplitude: number, n = 4096): number {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const y = at(curve, amplitude * Math.sin((2 * Math.PI * i) / n));
      sum += y * y;
    }
    return Math.sqrt(sum / n);
  }

  // THE contract, and the reason the first version of this feature was inaudible: without makeup,
  // more drive simply sounds quieter, which is indistinguishable from a control that does nothing.
  it("holds the LEVEL at a mixed programme level, so drive changes colour not loudness", () => {
    const dry = SATURATION_REFERENCE_AMPLITUDE / Math.SQRT2;
    for (const amount of [0.25, 0.5, 0.75, 1]) {
      const wet = shapedRms(saturationCurve(amount)!, SATURATION_REFERENCE_AMPLITUDE);
      const changeDb = 20 * Math.log10(wet / dry);
      expect(
        Math.abs(changeDb),
        `amount ${amount} moved the level ${changeDb.toFixed(2)} dB`,
      ).toBeLessThan(0.2);
    }
  });

  it("still bends peaks, which is what generates the harmonics", () => {
    // A full-scale input comes out below full scale even with makeup applied.
    for (const amount of [0.5, 1]) {
      expect(at(saturationCurve(amount)!, 1), `amount ${amount}`).toBeLessThan(1);
    }
  });

  it("compresses the peak-to-average ratio harder as drive rises", () => {
    // Peak relative to the reference level: makeup holds the average, so what changes is how much
    // of the peak survives.
    const ratio = (amount: number) =>
      at(saturationCurve(amount)!, 1) /
      shapedRms(saturationCurve(amount)!, SATURATION_REFERENCE_AMPLITUDE);
    expect(ratio(1)).toBeLessThan(ratio(0.25));
  });

  it("is odd-symmetric, so it adds no DC offset", () => {
    const c = saturationCurve(0.7)!;
    for (const x of [0.2, 0.5, 0.9]) {
      expect(at(c, x)).toBeCloseTo(-at(c, -x), 6);
    }
    expect(at(c, 0), "an odd point count puts a sample exactly at zero").toBe(0);
  });

  // Non-decreasing rather than strictly increasing: at full drive tanh flattens so hard that
  // consecutive points near the ends are equal in float32. Folding would show as a DECREASE.
  it("never folds back on itself", () => {
    const c = saturationCurve(1)!;
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });

  it("never exceeds full scale for a full-scale input", () => {
    for (const amount of [0.1, 0.5, 1]) {
      const c = saturationCurve(amount)!;
      for (const v of c) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it("clamps the control and uses the requested resolution", () => {
    expect(saturationCurve(5)).toEqual(saturationCurve(1));
    expect(saturationCurve(-1)).toBe(null);
    expect(saturationCurve(1)!.length).toBe(SATURATION_CURVE_POINTS);
    expect(saturationCurve(1, 64)!.length).toBe(64);
  });
});

describe("saturationMakeup", () => {
  it("is unity when there is no shaping to compensate for", () => {
    expect(saturationMakeup(0)).toBe(1);
  });

  it("grows with hardness, because there is more level to put back", () => {
    expect(saturationMakeup(3)).toBeGreaterThan(saturationMakeup(1));
    expect(saturationMakeup(1)).toBeGreaterThan(1);
  });
});
