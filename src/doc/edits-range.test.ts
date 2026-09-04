import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, addTrack, deleteRange, makeClip } from "./edits";
import { expectNoOverlaps } from "./test-helpers";

/** Track A: one 20s clip at t=0. Track B: one 20s clip at t=0. */
function twoLongTracks(): Project {
  let p = addTrack(createProject(), "B");
  p = addClip(p, p.tracks[0].id, makeClip("s", 0, 20));
  p = addClip(p, p.tracks[1].id, makeClip("s", 0, 20));
  return p;
}

beforeEach(() => __resetIds());

describe("deleteRange without ripple", () => {
  it("cuts a hole and leaves the tail where it was", () => {
    const p = twoLongTracks();
    const next = deleteRange(p, [p.tracks[0].id], 5, 8, false);
    expect(next.tracks[0].clips.map((c) => [c.startS, c.durS])).toEqual([[0, 5], [8, 12]]);
    expectNoOverlaps(next);
  });

  it("advances inS on the tail so the surviving audio stays under the same times", () => {
    const p = twoLongTracks();
    const clips = deleteRange(p, [p.tracks[0].id], 5, 8, false).tracks[0].clips;
    expect(clips[1].inS).toBe(8);
  });

  it("removes clips entirely inside the range", () => {
    let p = addTrack(createProject(), "B");
    p = addClip(p, p.tracks[0].id, makeClip("s", 6, 2));
    expect(deleteRange(p, [p.tracks[0].id], 5, 10, false).tracks[0].clips).toHaveLength(0);
  });
});

describe("deleteRange with ripple", () => {
  it("closes the gap by shifting the tail left by the range length", () => {
    const p = twoLongTracks();
    const next = deleteRange(p, [p.tracks[0].id], 5, 8, true);
    expect(next.tracks[0].clips.map((c) => [c.startS, c.durS])).toEqual([[0, 5], [5, 12]]);
    expectNoOverlaps(next);
  });

  it("shifts every later clip, not just the adjacent one", () => {
    let p = addTrack(createProject(), "B");
    const t = p.tracks[0].id;
    p = addClip(p, t, makeClip("s", 0, 2));
    p = addClip(p, t, makeClip("s", 10, 2));
    p = addClip(p, t, makeClip("s", 20, 2));
    const next = deleteRange(p, [t], 4, 6, true);
    expect(next.tracks[0].clips.map((c) => c.startS)).toEqual([0, 8, 18]);
    expectNoOverlaps(next);
  });

  it("NEVER touches tracks outside trackIds — this is what keeps a bed in sync", () => {
    const p = twoLongTracks();
    const next = deleteRange(p, [p.tracks[0].id], 5, 8, true);
    expect(next.tracks[1].clips.map((c) => [c.startS, c.durS])).toEqual([[0, 20]]);
    expectNoOverlaps(next);
  });

  it("ripples several tracks together when several are selected", () => {
    const p = twoLongTracks();
    const ids = p.tracks.map((t) => t.id);
    const next = deleteRange(p, ids, 5, 8, true);
    expect(next.tracks[0].clips.map((c) => c.startS)).toEqual([0, 5]);
    expect(next.tracks[1].clips.map((c) => c.startS)).toEqual([0, 5]);
    expectNoOverlaps(next);
  });

  it("never overlaps when the cut's trailing edge lands within MIN_CLIP_S of a clip boundary " +
    "(regression: deleteRange used to route through splitAt, which refuses that split and " +
    "leaves the whole clip in place, overlapping the rippled tail)", () => {
    let p = addTrack(createProject(), "B");
    const t = p.tracks[0].id;
    p = addClip(p, t, makeClip("s", 10, 10)); // A: [10, 20]
    p = addClip(p, t, makeClip("s", 20, 5)); // B: [20, 25]
    const next = deleteRange(p, [t], 5, 10.005, true);
    expectNoOverlaps(next);
    expect(next.tracks[0].clips).toHaveLength(2);
    expect(next.tracks[0].clips[0].startS).toBeCloseTo(5);
    expect(next.tracks[0].clips[0].durS).toBeCloseTo(9.995);
    expect(next.tracks[0].clips[1].startS).toBeCloseTo(14.995);
    expect(next.tracks[0].clips[1].durS).toBeCloseTo(5);
  });

  it("never overlaps when the cut's leading edge leaves a sub-MIN_CLIP_S sliver of a clip " +
    "(regression: the sliver used to survive whole and overlap the rippled tail)", () => {
    let p = addTrack(createProject(), "B");
    const t = p.tracks[0].id;
    p = addClip(p, t, makeClip("s", 0, 10)); // A: [0, 10]
    p = addClip(p, t, makeClip("s", 10, 5)); // B: [10, 15]
    const next = deleteRange(p, [t], 2, 9.995, true);
    expectNoOverlaps(next);
    expect(next.tracks[0].clips).toHaveLength(2);
    expect(next.tracks[0].clips[0].startS).toBeCloseTo(0);
    expect(next.tracks[0].clips[0].durS).toBeCloseTo(2);
    expect(next.tracks[0].clips[1].startS).toBeCloseTo(2.005);
    expect(next.tracks[0].clips[1].durS).toBeCloseTo(5);
  });
});

describe("deleteRange edge cases", () => {
  it("is a no-op for an empty or inverted range", () => {
    const p = twoLongTracks();
    expect(deleteRange(p, [p.tracks[0].id], 5, 5, true)).toBe(p);
    expect(deleteRange(p, [p.tracks[0].id], 8, 5, true)).toBe(p);
  });

  it("is a no-op when the range misses every clip and ripple is off", () => {
    let p = addTrack(createProject(), "B");
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    expect(deleteRange(p, [p.tracks[0].id], 50, 60, false)).toBe(p);
  });
});
