import { describe, expect, it } from "vitest";
import {
  dbToGain, dbToPosition, envelopeAreaPoints, envelopeCurvePoints, envelopeXY, fadeAreaPoints, fadeCurvePoints, fadeCurveXY, formatDb, formatTime, gainToDb,
  formatSignedDb, METER_FLOOR_DB, meterFillPct, pinchUpdate, positionToDb, pxToTime,
  rulerTicks, snapBandDb, snapTime, timeToPx,
} from "./geometry";
import { fadeInCurve, fadeOutCurve } from "../audio/fades";

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

  // The ladder keeps labels on round numbers; the target spacing decides how many. These pin the
  // density that was chosen, so a change to either is deliberate rather than accidental.
  it("puts ticks about 40 px apart at the default zoom", () => {
    const ticks = rulerTicks(0, 30, 60); // 60 px/s
    const gapPx = (ticks[1].s - ticks[0].s) * 60;
    expect(gapPx).toBeGreaterThanOrEqual(30);
    expect(gapPx).toBeLessThanOrEqual(80);
  });

  it("labels a round number often enough to read, but not so often they collide", () => {
    const ticks = rulerTicks(0, 60, 60);
    const majors = ticks.filter((t) => t.major);
    const labelGapPx = (majors[1].s - majors[0].s) * 60;
    expect(labelGapPx).toBeGreaterThanOrEqual(150); // a "00:00.000" label is ~55 px
    expect(labelGapPx).toBeLessThanOrEqual(400);
  });
});

describe("fadeCurveXY", () => {
  /** The y of the curve at a normalised x, from the points the clip actually draws. */
  const yAt = (curve: Float32Array, x: number): number => {
    const hit = fadeCurveXY(curve).find((p) => Math.abs(p.x - x * 100) < 0.01);
    if (!hit) throw new Error(`no point at x=${x * 100}%`);
    return hit.y;
  };

  it("is a straight diagonal for a linear fade in", () => {
    const c = fadeInCurve("linear", 5);
    for (const x of [0, 0.25, 0.5, 0.75, 1]) expect(yAt(c, x)).toBeCloseTo(100 - x * 100, 4);
  });

  it("bows away from the diagonal for equal power", () => {
    expect(yAt(fadeInCurve("equalPower", 5), 0.5)).toBeCloseTo(29.29, 1);
  });

  it("sags below the diagonal for exponential", () => {
    expect(yAt(fadeInCurve("exponential", 5), 0.5)).toBeCloseTo(75, 1);
  });

  it("gives the three shapes visibly different midpoints", () => {
    const mid = (sh: "linear" | "equalPower" | "exponential") => yAt(fadeInCurve(sh, 5), 0.5);
    expect(mid("equalPower")).toBeLessThan(mid("linear"));
    expect(mid("exponential")).toBeGreaterThan(mid("linear"));
  });

  it("mirrors for a fade out: full attenuation at the clip's end", () => {
    const c = fadeOutCurve("linear", 5);
    expect(yAt(c, 0)).toBeCloseTo(0, 4);
    expect(yAt(c, 1)).toBeCloseTo(100, 4);
  });
});

describe("fadeAreaPoints / fadeCurvePoints", () => {
  it("share the curve, so the shaded area and the stroked edge cannot disagree", () => {
    const c = fadeInCurve("equalPower", 5);
    const edge = fadeCurvePoints(c);
    // The area is the same points reversed, behind the two anchors that close it along the top.
    const area = fadeAreaPoints(c);
    expect(area.startsWith("0,0 100,0 ")).toBe(true);
    expect(area.slice("0,0 100,0 ".length).split(" ").reverse().join(" ")).toBe(edge);
  });
});

describe("meterFillPct", () => {
  it("fills completely at 0 dBFS", () => {
    expect(meterFillPct(0)).toBeCloseTo(100, 6);
  });

  it("is empty at and below the floor", () => {
    expect(meterFillPct(METER_FLOOR_DB)).toBeCloseTo(0, 6);
    expect(meterFillPct(METER_FLOOR_DB - 20)).toBe(0);
  });

  it("is empty for digital silence", () => {
    expect(meterFillPct(-Infinity)).toBe(0);
  });

  it("puts the halfway mark at half the floor", () => {
    expect(meterFillPct(METER_FLOOR_DB / 2)).toBeCloseTo(50, 6);
  });

  // An over must peg the bar rather than overflowing its track, the same way the waveform clamps
  // to the clip box instead of painting over its neighbours.
  it("clamps an over to 100 rather than exceeding the track", () => {
    expect(meterFillPct(6)).toBe(100);
  });
});

describe("envelopeXY", () => {
  const yAt = (pts: { t: number; gain: number }[], durS: number, xPct: number): number => {
    const hit = envelopeXY(pts, durS).find((p) => Math.abs(p.x - xPct) < 0.01);
    if (!hit) throw new Error(`no point at x=${xPct}%`);
    return hit.y;
  };

  it("is empty for no points, so no overlay is drawn", () => {
    expect(envelopeXY([], 10)).toEqual([]);
    expect(envelopeAreaPoints([], 10)).toBe("");
  });

  it("shades nothing where the envelope is at unity", () => {
    expect(yAt([{ t: 0, gain: 1 }], 10, 0)).toBeCloseTo(0, 6);
  });

  it("shades the attenuated depth: gain 0.25 leaves 75% covered", () => {
    expect(yAt([{ t: 5, gain: 0.25 }], 10, 50)).toBeCloseTo(75, 6);
  });

  it("maps time to x as a fraction of the clip's duration", () => {
    expect(yAt([{ t: 0, gain: 1 }, { t: 2, gain: 0.5 }], 8, 25)).toBeCloseTo(50, 6);
  });

  // The envelope holds its last value to the end of the clip; without this the shading would stop
  // partway and the clip would look like it comes back up when it does not.
  it("extends the last value to the end of the clip", () => {
    expect(yAt([{ t: 0, gain: 0.25 }], 10, 100)).toBeCloseTo(75, 6);
  });
});

describe("envelopeAreaPoints", () => {
  it("closes the removed region along the top edge, from the same points as the stroked edge", () => {
    const pts = [{ t: 0, gain: 1 }, { t: 2, gain: 0.25 }];
    const edge = envelopeCurvePoints(pts, 8);
    const area = envelopeAreaPoints(pts, 8);
    expect(area.startsWith("0,0 100,0 ")).toBe(true);
    expect(area.slice("0,0 100,0 ".length).split(" ").reverse().join(" ")).toBe(edge);
  });
});

describe("pinchUpdate", () => {
  // 100 px/s, scrolled to t=10 s. Two fingers 200 px apart centred at 400 px, so the time under
  // the centre is 10 + 400/100 = 14 s. Started away from t=0 on purpose: the scrollS >= 0 clamp
  // legitimately breaks the pin near the timeline start, and that is tested separately below.
  const start = { pxPerSecond: 100, scrollS: 10, centerPx: 400, spreadPx: 200 };

  it("keeps the time under the pinch centre pinned while zooming in", () => {
    const r = pinchUpdate(start, { centerPx: 400, spreadPx: 400 });
    expect(r.pxPerSecond).toBeCloseTo(200, 6);
    // t = 4 s must still sit at 400 px: scrollS + 400/200 === 4
    expect(r.scrollS + 400 / r.pxPerSecond).toBeCloseTo(14, 6);
  });

  it("keeps it pinned while zooming out too", () => {
    const r = pinchUpdate(start, { centerPx: 400, spreadPx: 100 });
    expect(r.pxPerSecond).toBeCloseTo(50, 6);
    expect(r.scrollS + 400 / r.pxPerSecond).toBeCloseTo(14, 6);
  });

  // Two fingers moving together without spreading is a pan: the same gesture handler covers both,
  // so this must fall out of the same maths rather than needing a separate mode.
  it("pans when the fingers move together without changing spread", () => {
    const r = pinchUpdate(start, { centerPx: 500, spreadPx: 200 });
    expect(r.pxPerSecond).toBeCloseTo(100, 6);
    expect(r.scrollS).toBeCloseTo(9, 6); // fingers moved right -> timeline scrolls back 1 s
  });

  // Near t=0 the pin CANNOT hold, because scrollS is clamped at zero. That is the correct
  // trade: the alternative is showing negative time.
  it("never scrolls before zero, even though that breaks the pin", () => {
    const atStart = { pxPerSecond: 100, scrollS: 0, centerPx: 400, spreadPx: 200 };
    expect(pinchUpdate(atStart, { centerPx: 900, spreadPx: 200 }).scrollS).toBe(0);
  });

  it("clamps the scale to the viewport's limits", () => {
    expect(pinchUpdate(start, { centerPx: 400, spreadPx: 1e6 }).pxPerSecond).toBe(2000);
    expect(pinchUpdate(start, { centerPx: 400, spreadPx: 0.001 }).pxPerSecond).toBe(2);
  });

  it("ignores a degenerate starting spread rather than dividing by zero", () => {
    const r = pinchUpdate({ ...start, spreadPx: 0 }, { centerPx: 400, spreadPx: 300 });
    expect(Number.isFinite(r.pxPerSecond)).toBe(true);
    expect(r.pxPerSecond).toBe(100); // scale unchanged
  });
});

describe("snapBandDb", () => {
  it("snaps to exactly flat near the centre", () => {
    // Without this, letting go of an EQ band almost never lands on 0.0 and a 'flat' track keeps
    // building filter nodes it does not need.
    expect(snapBandDb(0.3)).toBe(0);
    expect(snapBandDb(-0.3)).toBe(0);
  });

  it("leaves a deliberate small move alone", () => {
    expect(snapBandDb(1.2)).toBe(1.2);
    expect(snapBandDb(-2)).toBe(-2);
  });

  it("snaps at the boundary but not beyond it", () => {
    expect(snapBandDb(0.5)).toBe(0);
    expect(snapBandDb(0.51)).toBe(0.51);
  });
});

describe("formatSignedDb", () => {
  it("shows a sign on a boost so cut and boost are distinguishable at a glance", () => {
    expect(formatSignedDb(3)).toBe("+3.0 dB");
  });

  it("shows a real minus sign on a cut", () => {
    expect(formatSignedDb(-4.5)).toBe("−4.5 dB");
  });

  it("shows flat without a sign", () => {
    expect(formatSignedDb(0)).toBe("0.0 dB");
  });
});
