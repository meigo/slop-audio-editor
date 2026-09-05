import { beforeEach, describe, expect, it } from "vitest";
import { EQ_MAX_DB, __resetIds, createProject, findTrack } from "./document";
import {
  addTrack, removeTrack, renameTrack, reorderTrack, setDuckDepth, setGlue, setMasterEq,
  setMasterGain, setTrackEq, setTrackGain, setTrackMuted,
} from "./edits";

beforeEach(() => __resetIds());

describe("addTrack", () => {
  it("appends a track without mutating the input project", () => {
    const p = createProject();
    const next = addTrack(p, "Music");
    expect(p.tracks).toHaveLength(1);
    expect(next.tracks).toHaveLength(2);
    expect(next.tracks[1].name).toBe("Music");
  });

  it("auto-names from the new track count when no name is given", () => {
    expect(addTrack(createProject()).tracks[1].name).toBe("Track 2");
  });
});

describe("removeTrack", () => {
  it("removes the named track", () => {
    const p = addTrack(createProject(), "Music");
    const id = p.tracks[0].id;
    expect(findTrack(removeTrack(p, id), id)).toBeUndefined();
  });

  it("refuses to remove the last track — a project always has at least one", () => {
    const p = createProject();
    expect(removeTrack(p, p.tracks[0].id)).toBe(p);
  });
});

describe("renameTrack", () => {
  it("renames without touching other fields", () => {
    const p = createProject();
    const t = renameTrack(p, p.tracks[0].id, "VO").tracks[0];
    expect(t).toMatchObject({ name: "VO", gain: 1, muted: false });
  });
});

describe("reorderTrack", () => {
  it("moves a track to the given index", () => {
    let p = addTrack(addTrack(createProject(), "B"), "C");
    const names = () => p.tracks.map((t) => t.name);
    expect(names()).toEqual(["Track 1", "B", "C"]);
    p = reorderTrack(p, p.tracks[2].id, 0);
    expect(names()).toEqual(["C", "Track 1", "B"]);
  });

  it("clamps an out-of-range index instead of throwing", () => {
    const p = addTrack(createProject(), "B");
    expect(reorderTrack(p, p.tracks[0].id, 99).tracks.map((t) => t.name)).toEqual(["B", "Track 1"]);
  });
});

describe("gain and mute", () => {
  it("sets track gain, clamped to >= 0", () => {
    const p = createProject();
    expect(setTrackGain(p, p.tracks[0].id, 0.5).tracks[0].gain).toBe(0.5);
    expect(setTrackGain(p, p.tracks[0].id, -3).tracks[0].gain).toBe(0);
  });

  it("sets mute", () => {
    const p = createProject();
    expect(setTrackMuted(p, p.tracks[0].id, true).tracks[0].muted).toBe(true);
  });

  it("sets master gain, clamped to >= 0", () => {
    expect(setMasterGain(createProject(), 2).masterGain).toBe(2);
    expect(setMasterGain(createProject(), -1).masterGain).toBe(0);
  });

  it("sets glue, and is a same-object no-op when the value doesn't change", () => {
    const p = createProject();
    expect(setGlue(p, true).glue).toBe(true);
    expect(setGlue(p, false)).toBe(p);
  });
});

describe("unknown ids", () => {
  it("return the project unchanged rather than throwing", () => {
    const p = createProject();
    expect(renameTrack(p, "nope", "x")).toBe(p);
    expect(setTrackGain(p, "nope", 0.5)).toBe(p);
    expect(reorderTrack(p, "nope", 0)).toBe(p);
  });
});

describe("setDuckDepth", () => {
  it("clamps to a sane range so the control cannot mute the bed or boost it", () => {
    expect(setDuckDepth(createProject("p"), -100).duckDepthDb).toBe(-40);
    expect(setDuckDepth(createProject("p"), 12).duckDepthDb).toBe(0);
  });

  it("returns the same project for a no-op, so no undo entry is created", () => {
    const p = createProject("p");
    expect(setDuckDepth(p, p.duckDepthDb)).toBe(p);
  });
});

describe("setTrackEq", () => {
  const track = (p: ReturnType<typeof createProject>) => p.tracks[0];

  it("starts flat", () => {
    expect(track(createProject("p")).eq).toEqual({ lowDb: 0, midDb: 0, highDb: 0 });
  });

  it("clamps each band to the allowed range", () => {
    const base = createProject("p");
    const id = base.tracks[0].id;
    expect(track(setTrackEq(base, id, { lowDb: 99 })).eq.lowDb).toBe(EQ_MAX_DB);
    expect(track(setTrackEq(base, id, { highDb: -99 })).eq.highDb).toBe(-EQ_MAX_DB);
  });

  it("keeps the untouched bands when patching one", () => {
    const base = createProject("p");
    const id = base.tracks[0].id;
    const once = setTrackEq(base, id, { lowDb: 4 });
    const twice = setTrackEq(once, id, { highDb: -2 });
    expect(track(twice).eq).toEqual({ lowDb: 4, midDb: 0, highDb: -2 });
  });

  it("returns the same project for a no-op, so no undo entry is created", () => {
    const base = createProject("p");
    expect(setTrackEq(base, base.tracks[0].id, { lowDb: 0 })).toBe(base);
  });
});

describe("setMasterEq", () => {
  it("sets a band and leaves the others alone", () => {
    const p = setMasterEq(createProject(), { midDb: -6 });
    expect(p.masterEq).toEqual({ lowDb: 0, midDb: -6, highDb: 0 });
  });

  it("clamps to the same range as a track's bands", () => {
    expect(setMasterEq(createProject(), { lowDb: 99 }).masterEq.lowDb).toBe(EQ_MAX_DB);
    expect(setMasterEq(createProject(), { lowDb: -99 }).masterEq.lowDb).toBe(-EQ_MAX_DB);
  });

  // The no-op guard is what stops a fader that lands back on its old value pushing an undo entry.
  it("returns the same project when nothing changes", () => {
    const p = createProject();
    expect(setMasterEq(p, { lowDb: 0 })).toBe(p);
  });

  it("does not touch track EQ", () => {
    const p = setMasterEq(createProject(), { highDb: 4 });
    expect(p.tracks[0].eq).toEqual({ lowDb: 0, midDb: 0, highDb: 0 });
  });
});
