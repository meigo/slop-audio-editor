import { describe, expect, it } from "vitest";
import { scaleCurve } from "./render";

describe("scaleCurve", () => {
  it("multiplies every point by the clip gain", () => {
    expect([...scaleCurve(new Float32Array([0, 0.5, 1]), 0.5)]).toEqual([0, 0.25, 0.5]);
  });

  it("returns the same array instance at unity gain — nothing to do", () => {
    const c = new Float32Array([0, 1]);
    expect(scaleCurve(c, 1)).toBe(c);
  });

  it("handles zero gain", () => {
    expect([...scaleCurve(new Float32Array([0, 1]), 0)]).toEqual([0, 0]);
  });
});
