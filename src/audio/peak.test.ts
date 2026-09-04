import { describe, expect, it } from "vitest";
import { amplitudeToDbfs, peakAmplitude } from "./peak";

describe("peakAmplitude", () => {
  it("takes the largest magnitude across every channel", () => {
    const l = Float32Array.from([0.1, 0.4, 0.2]);
    const r = Float32Array.from([0.3, 0.9, 0.1]);
    expect(peakAmplitude([l, r])).toBeCloseTo(0.9, 6);
  });

  it("measures magnitude, so a negative trough counts", () => {
    expect(peakAmplitude([Float32Array.from([0.2, -0.8, 0.3])])).toBeCloseTo(0.8, 6);
  });

  it("reports overs above 1.0 rather than clamping them", () => {
    // The whole point of the meter: the graph runs in float and CAN exceed 1.0. Clamping here
    // would report a clipping mix as exactly full scale and hide the amount of the over.
    expect(peakAmplitude([Float32Array.from([1.7])])).toBeCloseTo(1.7, 6);
  });

  it("is 0 for silence and for no channels", () => {
    expect(peakAmplitude([Float32Array.from([0, 0])])).toBe(0);
    expect(peakAmplitude([])).toBe(0);
  });
});

describe("amplitudeToDbfs", () => {
  it("puts full scale at 0 dBFS", () => {
    expect(amplitudeToDbfs(1)).toBeCloseTo(0, 6);
  });

  it("halving amplitude is about -6 dB", () => {
    expect(amplitudeToDbfs(0.5)).toBeCloseTo(-6.02, 2);
  });

  it("goes positive for an over", () => {
    expect(amplitudeToDbfs(2)).toBeCloseTo(6.02, 2);
  });

  it("is -Infinity for digital silence", () => {
    expect(amplitudeToDbfs(0)).toBe(-Infinity);
  });
});
