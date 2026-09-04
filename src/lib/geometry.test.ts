import { describe, expect, it } from "vitest";
import {
  dbToGain, formatDb, formatTime, gainToDb, pxToTime, rulerTicks, snapTime, timeToPx,
} from "./geometry";

describe("timeToPx / pxToTime", () => {
  it("converts with scroll and zoom applied", () => {
    expect(timeToPx(5, 2, 60)).toBe(180);
    expect(pxToTime(180, 2, 60)).toBe(5);
  });

  it("round-trips", () => {
    expect(pxToTime(timeToPx(3.25, 1.5, 44), 1.5, 44)).toBeCloseTo(3.25);
  });

  it("goes negative for times left of the viewport", () => {
    expect(timeToPx(0, 2, 60)).toBe(-120);
  });
});

describe("snapTime", () => {
  it("snaps to the nearest candidate within the pixel threshold", () => {
    expect(snapTime(5.05, [5, 9], 60, 8)).toBe(5);
  });

  it("leaves a time outside the threshold alone", () => {
    expect(snapTime(5.5, [5, 9], 60, 8)).toBe(5.5);
  });

  it("threshold is in PIXELS, so zooming in snaps less eagerly in time", () => {
    expect(snapTime(5.1, [5], 60, 8)).toBe(5); // 6 px away
    expect(snapTime(5.1, [5], 600, 8)).toBe(5.1); // 60 px away
  });

  it("picks the nearest of several candidates", () => {
    expect(snapTime(5.05, [5, 5.06], 60, 8)).toBe(5.06);
  });

  it("is identity with no candidates", () => {
    expect(snapTime(5.05, [], 60, 8)).toBe(5.05);
  });
});

describe("formatTime", () => {
  it("formats mm:ss.mmm", () => {
    expect(formatTime(0)).toBe("00:00.000");
    expect(formatTime(83.456)).toBe("01:23.456");
    expect(formatTime(3600)).toBe("60:00.000");
  });

  it("clamps negatives to zero", () => {
    expect(formatTime(-1)).toBe("00:00.000");
  });
});

describe("gain and dB", () => {
  it("round-trips unity as 0 dB", () => {
    expect(gainToDb(1)).toBe(0);
    expect(dbToGain(0)).toBe(1);
  });

  it("halving amplitude is about -6 dB", () => {
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(dbToGain(-6.02)).toBeCloseTo(0.5, 2);
  });

  it("reports silence as -inf rather than -Infinity noise", () => {
    expect(formatDb(0)).toBe("−∞ dB");
  });

  it("formats to one decimal with a sign", () => {
    expect(formatDb(1)).toBe("0.0 dB");
    expect(formatDb(0.5)).toBe("−6.0 dB");
    expect(formatDb(2)).toBe("+6.0 dB");
  });
});

describe("rulerTicks", () => {
  it("covers the window and marks majors", () => {
    const ticks = rulerTicks(0, 10, 60);
    expect(ticks[0].s).toBe(0);
    expect(ticks[0].major).toBe(true);
    expect(ticks[ticks.length - 1].s).toBeGreaterThanOrEqual(10);
  });

  it("uses a coarser step when zoomed out", () => {
    const near = rulerTicks(0, 10, 200);
    const far = rulerTicks(0, 600, 2);
    expect(near.length).toBeLessThan(200);
    expect(far.length).toBeLessThan(200);
    expect(far[1].s - far[0].s).toBeGreaterThan(near[1].s - near[0].s);
  });

  it("returns nothing for an inverted window", () => {
    expect(rulerTicks(10, 5, 60)).toEqual([]);
  });
});
