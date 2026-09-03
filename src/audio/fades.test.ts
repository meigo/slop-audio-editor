import { describe, expect, it } from "vitest";
import { FADE_CURVE_POINTS, fadeInCurve, fadeOutCurve } from "./fades";
import type { FadeShape } from "../doc/document";

const SHAPES: FadeShape[] = ["linear", "equalPower", "exponential"];

describe("fadeInCurve", () => {
  it("defaults to FADE_CURVE_POINTS samples", () => {
    expect(fadeInCurve("linear")).toHaveLength(FADE_CURVE_POINTS);
  });

  it.each(SHAPES)("%s starts at 0 and ends at 1", (shape) => {
    const c = fadeInCurve(shape, 64);
    expect(c[0]).toBeCloseTo(0);
    expect(c[63]).toBeCloseTo(1);
  });

  it.each(SHAPES)("%s is monotonically non-decreasing", (shape) => {
    const c = fadeInCurve(shape, 64);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1] - 1e-6);
  });

  it("the three shapes are genuinely different at the midpoint", () => {
    const mid = (s: FadeShape) => fadeInCurve(s, 65)[32];
    expect(mid("linear")).toBeCloseTo(0.5);
    expect(mid("equalPower")).toBeGreaterThan(0.6); // sin(pi/4) ~ 0.707
    expect(mid("exponential")).toBeLessThan(0.3); // 0.5^2 = 0.25
  });

  it("samples a sub-range for a fade the playback window cut into", () => {
    const half = fadeInCurve("linear", 33, 0.5, 1);
    expect(half[0]).toBeCloseTo(0.5);
    expect(half[32]).toBeCloseTo(1);
  });
});

describe("fadeOutCurve", () => {
  it.each(SHAPES)("%s starts at 1 and ends at 0", (shape) => {
    const c = fadeOutCurve(shape, 64);
    expect(c[0]).toBeCloseTo(1);
    expect(c[63]).toBeCloseTo(0);
  });

  it.each(SHAPES)("%s is monotonically non-increasing", (shape) => {
    const c = fadeOutCurve(shape, 64);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1] + 1e-6);
  });

  it("is the mirror of the fade in", () => {
    const inC = fadeInCurve("equalPower", 33);
    const outC = fadeOutCurve("equalPower", 33);
    for (let i = 0; i < 33; i++) expect(outC[i]).toBeCloseTo(inC[32 - i], 5);
  });

  it("samples a sub-range", () => {
    const tail = fadeOutCurve("linear", 33, 0.5, 1);
    expect(tail[0]).toBeCloseTo(0.5);
    expect(tail[32]).toBeCloseTo(0);
  });
});
