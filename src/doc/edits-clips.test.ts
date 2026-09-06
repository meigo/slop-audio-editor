import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import {
  addClip,
  addTrack,
  deleteClips,
  makeClip,
  moveClips,
  setClipSpeed,
  trimClipEnd,
} from "./edits";
import { expectNoOverlaps } from "./test-helpers";

function twoTracks(): Project {
  return addTrack(createProject(), "B");
}

beforeEach(() => __resetIds());

describe("makeClip", () => {
  it("builds a clip at unity gain with no fades", () => {
    expect(makeClip("src-1", 2, 5)).toMatchObject({
      sourceId: "src-1",
      startS: 2,
      durS: 5,
      inS: 0,
      gain: 1,
      fadeInS: 0,
      fadeOutS: 0,
      fadeShape: "linear",
    });
  });
});

describe("addClip", () => {
  it("places a clip on the named track without mutating the input", () => {
    const p = twoTracks();
    const next = addClip(p, p.tracks[1].id, makeClip("s", 0, 3));
    expect(p.tracks[1].clips).toHaveLength(0);
    expect(next.tracks[1].clips).toHaveLength(1);
  });

  it("overwrites what it lands on", () => {
    const p = twoTracks();
    const t = p.tracks[0].id;
    let next = addClip(p, t, makeClip("s", 0, 10));
    next = addClip(next, t, makeClip("s", 4, 2));
    expect(next.tracks[0].clips.map((c) => [c.startS, c.durS])).toEqual([
      [0, 4],
      [4, 2],
      [6, 4],
    ]);
  });

  it("is a no-op for an unknown track", () => {
    const p = twoTracks();
    expect(addClip(p, "nope", makeClip("s", 0, 1))).toBe(p);
  });
});

describe("deleteClips", () => {
  it("removes the named clips and leaves a gap", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    p = addClip(p, p.tracks[0].id, makeClip("s", 5, 2));
    const id = p.tracks[0].clips[0].id;
    const next = deleteClips(p, [id]);
    expect(next.tracks[0].clips.map((c) => c.startS)).toEqual([5]);
  });

  it("removes clips across several tracks in one call", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    p = addClip(p, p.tracks[1].id, makeClip("s", 0, 2));
    const ids = [p.tracks[0].clips[0].id, p.tracks[1].clips[0].id];
    const next = deleteClips(p, ids);
    expect(next.tracks[0].clips).toHaveLength(0);
    expect(next.tracks[1].clips).toHaveLength(0);
  });

  it("is a no-op when no id matches", () => {
    const p = twoTracks();
    expect(deleteClips(p, ["nope"])).toBe(p);
  });
});

describe("moveClips", () => {
  it("shifts a clip in time", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 2, 2));
    const id = p.tracks[0].clips[0].id;
    const next = moveClips(p, [id], 3, 0);
    expect(next.tracks[0].clips[0].startS).toBe(5);
    expectNoOverlaps(next);
  });

  it("clamps at t=0 rather than going negative", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 1, 2));
    const id = p.tracks[0].clips[0].id;
    const next = moveClips(p, [id], -5, 0);
    expect(next.tracks[0].clips[0].startS).toBe(0);
    expectNoOverlaps(next);
  });

  it("moves a clip to another track", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    const id = p.tracks[0].clips[0].id;
    const next = moveClips(p, [id], 0, 1);
    expect(next.tracks[0].clips).toHaveLength(0);
    expect(next.tracks[1].clips).toHaveLength(1);
    expectNoOverlaps(next);
  });

  it("clamps a track move at the ends of the track list", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    const id = p.tracks[0].clips[0].id;
    const next = moveClips(p, [id], 0, -3);
    expect(next.tracks[0].clips).toHaveLength(1);
    expectNoOverlaps(next);
  });

  it("overwrites a clip it lands on", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 4));
    p = addClip(p, p.tracks[0].id, makeClip("s", 10, 4));
    const moving = p.tracks[0].clips[1].id;
    const next = moveClips(p, [moving], -8, 0);
    expect(next.tracks[0].clips.map((c) => [c.startS, c.durS])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expectNoOverlaps(next);
  });

  it("does not let group members overwrite each other", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 4));
    p = addClip(p, p.tracks[0].id, makeClip("s", 4, 4));
    const ids = p.tracks[0].clips.map((c) => c.id);
    const next = moveClips(p, ids, 10, 0);
    expect(next.tracks[0].clips.map((c) => [c.startS, c.durS])).toEqual([
      [10, 4],
      [14, 4],
    ]);
    expectNoOverlaps(next);
  });

  it("preserves relative offsets when the group is clamped at t=0", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 2, 2));
    p = addClip(p, p.tracks[0].id, makeClip("s", 6, 2));
    const ids = p.tracks[0].clips.map((c) => c.id);
    const next = moveClips(p, ids, -10, 0);
    expect(next.tracks[0].clips.map((c) => c.startS)).toEqual([0, 4]);
    expectNoOverlaps(next);
  });
});

describe("a clip already shorter than MIN_CLIP_S", () => {
  // Only a sub-10 ms import can create one, but once it exists the floor used to be applied AFTER
  // the neighbour clamp, so any speed change or tail drag grew it into the next clip. Non-overlap
  // is the invariant everything else stands on; the floor is a courtesy.
  function butted(): Project {
    const base = createProject();
    const t = base.tracks[0].id;
    const p = addClip(base, t, { ...makeClip("s", 0, 0.005), id: "tiny" });
    return addClip(p, t, makeClip("s", 0.005, 1));
  }

  it("does not overlap its neighbour when its speed changes", () => {
    const next = setClipSpeed(butted(), "tiny", 0.5);
    expectNoOverlaps(next);
  });

  it("does not overlap its neighbour when its tail is dragged", () => {
    const next = trimClipEnd(butted(), "tiny", 1, 10);
    expectNoOverlaps(next);
  });
});
