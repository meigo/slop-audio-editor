import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, addTrack, makeClip } from "./edits";
import {
  clipsInRange,
  editPoints,
  fitSpan,
  isClipSelected,
  liveRange,
  nextEditPoint,
  NO_SELECTION,
  prevEditPoint,
} from "./selection";

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
    expect(
      editPoints(
        p,
        p.tracks.map((t) => t.id),
      ),
    ).toEqual([0, 2, 3, 4, 5, 8]);
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

describe("fitSpan", () => {
  it("spans the selected clips, from the earliest start to the latest end", () => {
    const p = scene();
    const [a] = p.tracks[0].clips; // 0-2
    const b = p.tracks[1].clips[0]; // 3-4
    expect(fitSpan(p, { kind: "clips", clipIds: [b.id, a.id] })).toEqual({ fromS: 0, toS: 4 });
  });

  it("ignores ids that name no clip", () => {
    const p = scene();
    const a = p.tracks[0].clips[0]; // 0-2
    expect(fitSpan(p, { kind: "clips", clipIds: [a.id, "gone"] })).toEqual({ fromS: 0, toS: 2 });
  });

  it("spans the range itself, not the clips it covers", () => {
    // The range is what the user drew; a clip it only partly covers must not stretch the view.
    const p = scene();
    const range = { fromS: 1, toS: 6, trackIds: [p.tracks[0].id] };
    expect(fitSpan(p, { kind: "range", range })).toEqual({ fromS: 1, toS: 6 });
  });

  it("falls back to the whole project when nothing is selected", () => {
    const p = scene();
    expect(fitSpan(p, NO_SELECTION)).toEqual({ fromS: 0, toS: 8 });
  });

  it("falls back to the whole project when the selection resolves to no clips", () => {
    // A stale id is the same situation as no selection: there is nothing to frame.
    const p = scene();
    expect(fitSpan(p, { kind: "clips", clipIds: ["gone"] })).toEqual({ fromS: 0, toS: 8 });
  });
});

describe("isClipSelected", () => {
  it("selects a clip the range only partly covers — it moves and deletes in full", () => {
    const p = scene();
    const a = p.tracks[0].clips[0]; // 0-2
    const range = { fromS: 1, toS: 6, trackIds: [p.tracks[0].id] };
    expect(isClipSelected({ kind: "range", range }, p.tracks[0].id, a)).toBe(true);
  });

  it("ignores a clip on a track the range does not cover", () => {
    const p = scene();
    const b = p.tracks[1].clips[0]; // 3-4 on track B
    const range = { fromS: 0, toS: 10, trackIds: [p.tracks[0].id] };
    expect(isClipSelected({ kind: "range", range }, p.tracks[1].id, b)).toBe(false);
  });

  it("does not select a clip that merely touches the range's edge", () => {
    const p = scene();
    const a = p.tracks[0].clips[0]; // 0-2
    const range = { fromS: 2, toS: 6, trackIds: [p.tracks[0].id] };
    expect(isClipSelected({ kind: "range", range }, p.tracks[0].id, a)).toBe(false);
  });

  it("agrees with clipsInRange, which is the set the edits act on", () => {
    const p = scene();
    const range = { fromS: 1, toS: 6, trackIds: p.tracks.map((t) => t.id) };
    const viaSet = new Set(clipsInRange(p, range));
    for (const t of p.tracks) {
      for (const c of t.clips) {
        expect(isClipSelected({ kind: "range", range }, t.id, c)).toBe(viaSet.has(c.id));
      }
    }
  });

  it("falls back to plain id membership for a clip selection, and never selects for none", () => {
    const p = scene();
    const a = p.tracks[0].clips[0];
    expect(isClipSelected({ kind: "clips", clipIds: [a.id] }, p.tracks[0].id, a)).toBe(true);
    expect(isClipSelected({ kind: "clips", clipIds: [] }, p.tracks[0].id, a)).toBe(false);
    expect(isClipSelected(NO_SELECTION, p.tracks[0].id, a)).toBe(false);
  });
});

describe("liveRange", () => {
  it("returns the range while any of its tracks still exists", () => {
    const p = scene();
    const range = { fromS: 1, toS: 2, trackIds: [p.tracks[0].id, "gone"] };
    expect(liveRange(p, { kind: "range", range })).toBe(range);
  });

  it("returns null for a range none of whose tracks exist — it is no window at all", () => {
    // Session state outlives the track it was drawn on. Three readers used to decide this
    // separately: the export ignored such a range, the status line still called it the export
    // window, and the dialog still said "Selection".
    const range = { fromS: 1, toS: 2, trackIds: ["gone"] };
    expect(liveRange(scene(), { kind: "range", range })).toBeNull();
  });

  it("returns null for a clip selection or none", () => {
    expect(liveRange(scene(), { kind: "clips", clipIds: ["x"] })).toBeNull();
    expect(liveRange(scene(), NO_SELECTION)).toBeNull();
  });
});
