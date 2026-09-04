import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetIds, adoptIds, clipEndS, createProject, createTrack, findClip, findTrack,
  newId, projectDurationS, referencedSourceIdsAcross, resolveTrackId, trackDurationS,
  type Clip, type Project,
} from "./document";
import { addClip, addTrack, makeClip, removeTrack } from "./edits";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: newId("clip"), sourceId: "src-1", startS: 0, inS: 0, durS: 1,
    gain: 1, fadeInS: 0, fadeOutS: 0, fadeShape: "linear", ...over,
  };
}

beforeEach(() => __resetIds());

describe("newId", () => {
  it("is unique and prefixed", () => {
    expect(newId("clip")).toBe("clip-1");
    expect(newId("clip")).toBe("clip-2");
    expect(newId("track")).toBe("track-3");
  });
});

describe("createProject", () => {
  it("starts with one empty track and unity master gain", () => {
    const p = createProject();
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].clips).toEqual([]);
    expect(p.masterGain).toBe(1);
  });
});

describe("createTrack", () => {
  it("is unmuted at unity gain with no clips", () => {
    const t = createTrack("VO");
    expect(t).toMatchObject({ name: "VO", gain: 1, muted: false, clips: [] });
  });
});

describe("clipEndS", () => {
  it("is startS + durS", () => {
    expect(clipEndS(clip({ startS: 2.5, durS: 1.25 }))).toBe(3.75);
  });
});

describe("trackDurationS", () => {
  it("is 0 for an empty track", () => {
    expect(trackDurationS(createTrack("x"))).toBe(0);
  });

  it("is the end of the last clip", () => {
    const t = createTrack("x");
    t.clips = [clip({ startS: 0, durS: 1 }), clip({ startS: 5, durS: 2 })];
    expect(trackDurationS(t)).toBe(7);
  });
});

describe("projectDurationS", () => {
  it("is the maximum track duration, not the sum", () => {
    const p = createProject();
    p.tracks[0].clips = [clip({ startS: 0, durS: 3 })];
    p.tracks.push(createTrack("b"));
    p.tracks[1].clips = [clip({ startS: 0, durS: 10 })];
    expect(projectDurationS(p)).toBe(10);
  });

  it("is 0 for a project with no clips", () => {
    expect(projectDurationS(createProject())).toBe(0);
  });
});

describe("id collision after a simulated reload (regression)", () => {
  it("newId mints ids that collide with a previously-restored project, unless adopted", () => {
    // Session 1: build a project the way the app would.
    let p = createProject();
    p = addTrack(p, "Track 2");
    p = addClip(p, p.tracks[0].id, makeClip("src-1", 0, 1));
    p = addClip(p, p.tracks[1].id, makeClip("src-1", 2, 1));

    const existingIds = new Set<string>([
      ...p.tracks.map((t) => t.id),
      ...p.tracks.flatMap((t) => t.clips.map((c) => c.id)),
      "src-1",
    ]);

    // Simulate a page reload: the module-level id counter resets to 0, but the project
    // restored from autosave/a project file still holds ids minted in the earlier session.
    __resetIds();
    adoptIds(existingIds);

    // Import a new file the way the app would: mint a source id, then a clip id.
    const newSrcId = newId("src");
    const newClipId = newId("clip");

    expect(existingIds.has(newSrcId)).toBe(false);
    expect(existingIds.has(newClipId)).toBe(false);
  });
});

describe("adoptIds", () => {
  it("advances the counter past the highest numeric suffix seen", () => {
    adoptIds(["clip-7", "track-2"]);
    expect(newId("clip")).toBe("clip-8");
  });

  it("ignores ids with no numeric suffix", () => {
    adoptIds(["source-file", "clip-"]);
    expect(newId("clip")).toBe("clip-1");
  });

  it("never rewinds the counter for a lower number", () => {
    adoptIds(["clip-10"]);
    adoptIds(["clip-3"]);
    expect(newId("clip")).toBe("clip-11");
  });
});

describe("lookups", () => {
  it("finds a track and a clip, and returns undefined for unknown ids", () => {
    const p = createProject();
    const c = clip();
    p.tracks[0].clips = [c];
    expect(findTrack(p, p.tracks[0].id)).toBe(p.tracks[0]);
    expect(findTrack(p, "nope")).toBeUndefined();
    expect(findClip(p, c.id)).toEqual({ track: p.tracks[0], clip: c });
    expect(findClip(p, "nope")).toBeUndefined();
  });
});

describe("resolveTrackId", () => {
  it("returns the preferred id when it exists", () => {
    let p = createProject();
    p = addTrack(p, "Track 2");
    const wanted = p.tracks[1].id;
    expect(resolveTrackId(p, wanted)).toBe(wanted);
  });

  it("falls back to the first track when the preferred id is unknown", () => {
    const p = createProject();
    expect(resolveTrackId(p, "nope")).toBe(p.tracks[0].id);
  });

  it("falls back to the first track when preferredId is null", () => {
    const p = createProject();
    expect(resolveTrackId(p, null)).toBe(p.tracks[0].id);
  });

  it("falls back to the first track when the preferred track was the one removed", () => {
    let p = createProject();
    p = addTrack(p, "Track 2");
    const removedId = p.tracks[0].id;
    p = removeTrack(p, removedId);
    expect(resolveTrackId(p, removedId)).toBe(p.tracks[0].id);
  });
});

describe("referencedSourceIdsAcross", () => {
  const projWith = (...sourceIds: string[]): Project => {
    let p = createProject("p");
    for (const sid of sourceIds) {
      p = {
        ...p,
        tracks: [
          {
            ...p.tracks[0],
            clips: [
              ...p.tracks[0].clips,
              { id: newId("clip"), sourceId: sid, startS: 0, inS: 0, durS: 1,
                gain: 1, fadeInS: 0, fadeOutS: 0, fadeShape: "linear" as const },
            ],
          },
        ],
      };
    }
    return p;
  };

  it("unions the sources of every project it is given", () => {
    const ids = referencedSourceIdsAcross([projWith("a", "b"), projWith("b", "c")]);
    expect([...ids].sort()).toEqual(["a", "b", "c"]);
  });

  it("is empty for no projects", () => {
    expect(referencedSourceIdsAcross([]).size).toBe(0);
  });

  // The point of the whole function: a source only the undo history still references is NOT
  // an orphan. Pruning it would leave undo able to restore a document whose audio is gone.
  it("keeps a source that only a history snapshot references", () => {
    const current = projWith("kept");
    const historic = projWith("only-in-history");
    const ids = referencedSourceIdsAcross([current, historic]);
    expect(ids.has("only-in-history")).toBe(true);
  });
});
