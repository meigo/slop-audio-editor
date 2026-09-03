import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, addTrack, makeClip } from "./edits";
import { clipsInRange, editPoints, nextEditPoint, prevEditPoint } from "./selection";

/** Track A: 0–2 and 5–8. Track B: 3–4. */
function scene(): Project {
  let p = addTrack(createProject(), "B");
  p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
  p = addClip(p, p.tracks[0].id, makeClip("s", 5, 3));
  p = addClip(p, p.tracks[1].id, makeClip("s", 3, 1));
  return p;
}

beforeEach(() => __resetIds());

describe("clipsInRange", () => {
  it("includes clips that merely overlap the range", () => {
    const p = scene();
    const ids = clipsInRange(p, { fromS: 1, toS: 6, trackIds: [p.tracks[0].id] });
    expect(ids).toEqual(p.tracks[0].clips.map((c) => c.id));
  });

  it("excludes clips on tracks not in the range", () => {
    const p = scene();
    const ids = clipsInRange(p, { fromS: 0, toS: 100, trackIds: [p.tracks[1].id] });
    expect(ids).toEqual([p.tracks[1].clips[0].id]);
  });

  it("treats a touching edge as no overlap", () => {
    const p = scene();
    expect(clipsInRange(p, { fromS: 2, toS: 5, trackIds: [p.tracks[0].id] })).toEqual([]);
  });

  it("is empty for an inverted or zero-length range", () => {
    const p = scene();
    expect(clipsInRange(p, { fromS: 5, toS: 5, trackIds: [p.tracks[0].id] })).toEqual([]);
    expect(clipsInRange(p, { fromS: 6, toS: 2, trackIds: [p.tracks[0].id] })).toEqual([]);
  });
});

describe("editPoints", () => {
  it("collects sorted unique boundaries across the given tracks, starting at 0", () => {
    const p = scene();
    expect(editPoints(p, p.tracks.map((t) => t.id))).toEqual([0, 2, 3, 4, 5, 8]);
  });

  it("only looks at the tracks it is given", () => {
    const p = scene();
    expect(editPoints(p, [p.tracks[1].id])).toEqual([0, 3, 4]);
  });

  it("is just [0] for an empty project", () => {
    const p = createProject();
    expect(editPoints(p, [p.tracks[0].id])).toEqual([0]);
  });
});

describe("nextEditPoint / prevEditPoint", () => {
  const points = [0, 2, 3, 4, 5, 8];

  it("finds the next point strictly after the time", () => {
    expect(nextEditPoint(points, 2)).toBe(3);
    expect(nextEditPoint(points, 2.5)).toBe(3);
  });

  it("returns null past the last point", () => {
    expect(nextEditPoint(points, 8)).toBeNull();
    expect(nextEditPoint(points, 99)).toBeNull();
  });

  it("finds the previous point strictly before the time", () => {
    expect(prevEditPoint(points, 3)).toBe(2);
    expect(prevEditPoint(points, 2.5)).toBe(2);
  });

  it("returns null before the first point", () => {
    expect(prevEditPoint(points, 0)).toBeNull();
    expect(prevEditPoint(points, -1)).toBeNull();
  });
});
