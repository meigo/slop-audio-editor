import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, addTrack, deleteRange, makeClip } from "./edits";

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
    const clips = deleteRange(p, [p.tracks[0].id], 5, 8, false).tracks[0].clips;
    expect(clips.map((c) => [c.startS, c.durS])).toEqual([[0, 5], [8, 12]]);
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
    const clips = deleteRange(p, [p.tracks[0].id], 5, 8, true).tracks[0].clips;
    expect(clips.map((c) => [c.startS, c.durS])).toEqual([[0, 5], [5, 12]]);
  });

  it("shifts every later clip, not just the adjacent one", () => {
    let p = addTrack(createProject(), "B");
    const t = p.tracks[0].id;
    p = addClip(p, t, makeClip("s", 0, 2));
    p = addClip(p, t, makeClip("s", 10, 2));
    p = addClip(p, t, makeClip("s", 20, 2));
    const clips = deleteRange(p, [t], 4, 6, true).tracks[0].clips;
    expect(clips.map((c) => c.startS)).toEqual([0, 8, 18]);
  });

  it("NEVER touches tracks outside trackIds — this is what keeps a bed in sync", () => {
    const p = twoLongTracks();
    const next = deleteRange(p, [p.tracks[0].id], 5, 8, true);
    expect(next.tracks[1].clips.map((c) => [c.startS, c.durS])).toEqual([[0, 20]]);
  });

  it("ripples several tracks together when several are selected", () => {
    const p = twoLongTracks();
    const ids = p.tracks.map((t) => t.id);
    const next = deleteRange(p, ids, 5, 8, true);
    expect(next.tracks[0].clips.map((c) => c.startS)).toEqual([0, 5]);
    expect(next.tracks[1].clips.map((c) => c.startS)).toEqual([0, 5]);
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
