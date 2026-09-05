import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, newId, type Clip } from "./document";
import { clampFades, insertClip, sliceClip } from "./overlap";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: newId("clip"),
    sourceId: "src-1",
    startS: 0,
    inS: 0,
    durS: 10,
    gain: 1,
    fadeInS: 0,
    fadeOutS: 0,
    fadeShape: "linear",
    ...over,
  };
}

beforeEach(() => __resetIds());

describe("clampFades", () => {
  it("leaves fades that fit alone, returning the same object", () => {
    const c = clip({ durS: 10, fadeInS: 1, fadeOutS: 2 });
    expect(clampFades(c)).toBe(c);
  });

  it("scales overlapping fades down proportionally to fill exactly the duration", () => {
    const c = clampFades(clip({ durS: 3, fadeInS: 2, fadeOutS: 4 }));
    expect(c.fadeInS).toBeCloseTo(1);
    expect(c.fadeOutS).toBeCloseTo(2);
    expect(c.fadeInS + c.fadeOutS).toBeCloseTo(3);
  });

  it("clamps a single fade longer than the clip", () => {
    expect(clampFades(clip({ durS: 2, fadeInS: 5, fadeOutS: 0 })).fadeInS).toBe(2);
  });
});

describe("sliceClip", () => {
  it("returns the clip unchanged when the window contains it", () => {
    const c = clip({ startS: 2, durS: 3 });
    expect(sliceClip(c, 0, 100)).toEqual(c);
  });

  it("advances inS by the amount cut off the head", () => {
    const c = clip({ startS: 2, inS: 5, durS: 10 });
    const s = sliceClip(c, 6, 100)!;
    expect(s.startS).toBe(6);
    expect(s.inS).toBe(9); // 5 + (6 - 2)
    expect(s.durS).toBe(6);
  });

  it("shortens durS without touching inS when only the tail is cut", () => {
    const c = clip({ startS: 2, inS: 5, durS: 10 });
    const s = sliceClip(c, 0, 8)!;
    expect(s).toMatchObject({ startS: 2, inS: 5, durS: 6 });
  });

  it("returns null when nothing survives", () => {
    expect(sliceClip(clip({ startS: 0, durS: 5 }), 10, 20)).toBeNull();
  });

  it("returns null rather than a sliver shorter than MIN_CLIP_S", () => {
    expect(sliceClip(clip({ startS: 0, durS: 5 }), 4.999, 20)).toBeNull();
  });

  it("clamps fades that no longer fit the slice", () => {
    const s = sliceClip(clip({ startS: 0, durS: 10, fadeInS: 4, fadeOutS: 4 }), 0, 3)!;
    expect(s.fadeInS + s.fadeOutS).toBeCloseTo(3);
  });
});

describe("insertClip", () => {
  it("keeps clips that do not overlap and sorts by startS", () => {
    const a = clip({ startS: 20, durS: 5 });
    const b = clip({ startS: 0, durS: 5 });
    expect(insertClip([a], b).map((c) => c.startS)).toEqual([0, 20]);
  });

  it("treats touching edges as no overlap", () => {
    const a = clip({ startS: 0, durS: 5 });
    const b = clip({ startS: 5, durS: 5 });
    expect(insertClip([a], b)).toHaveLength(2);
  });

  it("trims the tail of a clip the incoming one lands on", () => {
    const a = clip({ startS: 0, inS: 0, durS: 10 });
    const b = clip({ startS: 6, durS: 4 });
    const out = insertClip([a], b);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: a.id, startS: 0, inS: 0, durS: 6 });
  });

  it("trims the head of a clip the incoming one lands on, advancing inS", () => {
    const a = clip({ startS: 5, inS: 2, durS: 10 });
    const b = clip({ startS: 0, durS: 8 });
    const out = insertClip([a], b);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: a.id, startS: 8, inS: 5, durS: 7 });
  });

  it("removes a clip the incoming one fully covers", () => {
    const a = clip({ startS: 2, durS: 3 });
    const b = clip({ startS: 0, durS: 10 });
    expect(insertClip([a], b)).toEqual([b]);
  });

  it("splits a clip the incoming one lands inside, giving the tail a NEW id", () => {
    const a = clip({ startS: 0, inS: 0, durS: 10 });
    const b = clip({ startS: 4, durS: 2 });
    const out = insertClip([a], b);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: a.id, startS: 0, inS: 0, durS: 4 });
    expect(out[1]).toBe(b);
    expect(out[2]).toMatchObject({ startS: 6, inS: 6, durS: 4 });
    expect(out[2].id).not.toBe(a.id);
  });

  it("resolves overlaps against several existing clips at once", () => {
    const a = clip({ startS: 0, durS: 4 });
    const b = clip({ startS: 4, durS: 4 });
    const c = clip({ startS: 8, durS: 4 });
    const incoming = clip({ startS: 2, durS: 8 });
    const out = insertClip([a, b, c], incoming);
    expect(out.map((x) => [x.startS, x.durS])).toEqual([
      [0, 2],
      [2, 8],
      [10, 2],
    ]);
  });
});
