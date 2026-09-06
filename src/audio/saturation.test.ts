import { describe, expect, it } from "vitest";
import { SATURATION_CURVE_POINTS, SATURATION_MAX_K, saturationCurve } from "./saturation";

const at = (curve: Float32Array, x: number): number =>
  curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

describe("saturationCurve", () => {
  it("is null at zero drive — a linear curve is not the same as no node", () => {
    expect(saturationCurve(0)).toBe(null);
  });

  // The whole point of the normalisation: without it, drive doubles as a volume control. The
  // slope is measured between ADJACENT curve points — dividing a quantised sample by an
  // un-quantised x measures the grid, not the curve.
  it("leaves QUIET material at unity however hard it is driven", () => {
    for (const amount of [0.1, 0.5, 1]) {
      const c = saturationCurve(amount)!;
      const mid = (c.length - 1) / 2;
      const dx = 2 / (c.length - 1);
      const slope = (c[mid + 1] - c[mid]) / dx;
      expect(slope, `amount ${amount}`).toBeCloseTo(1, 3);
    }
  });

  it("bends the peaks down, and harder as drive rises", () => {
    const gentle = at(saturationCurve(0.25)!, 1);
    const hard = at(saturationCurve(1)!, 1);
    expect(gentle).toBeLessThan(1);
    expect(hard).toBeLessThan(gentle);
    expect(hard).toBeCloseTo(Math.tanh(SATURATION_MAX_K) / SATURATION_MAX_K, 6);
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
