import { describe, expect, it } from "vitest";
import {
  dbToGain, dbToPosition, formatDb, formatTime, gainToDb, positionToDb, pxToTime, rulerTicks,
  snapTime, timeToPx,
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

describe("positionToDb / dbToPosition (fader taper)", () => {
  it("maps each breakpoint exactly", () => {
    expect(positionToDb(0)).toBe(-Infinity);
    expect(positionToDb(0.25)).toBe(-30);
    expect(positionToDb(0.5)).toBe(-12);
    expect(positionToDb(0.75)).toBe(0);
    expect(positionToDb(1)).toBe(12);

    expect(dbToPosition(-30)).toBeCloseTo(0.25, 9);
    expect(dbToPosition(-12)).toBeCloseTo(0.5, 9);
    expect(dbToPosition(0)).toBeCloseTo(0.75, 9);
    expect(dbToPosition(12)).toBeCloseTo(1, 9);
  });

  it("position 0 is exactly silence, -Infinity dB", () => {
    expect(positionToDb(0)).toBe(-Infinity);
  });

  it("is monotonically increasing across the range", () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1; p += 0.01) {
      const db = positionToDb(p);
      expect(db).toBeGreaterThanOrEqual(prev);
      prev = db;
    }
  });

  it("round-trips position -> dB -> position within 1e-9", () => {
    for (let p = 0; p <= 1; p += 0.03) {
      expect(dbToPosition(positionToDb(p))).toBeCloseTo(p, 9);
    }
  });

  it("clamps dB beyond the ends to position 0 and 1", () => {
    expect(dbToPosition(-1000)).toBe(0);
    expect(dbToPosition(-Infinity)).toBe(0);
    expect(dbToPosition(1000)).toBe(1);
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
