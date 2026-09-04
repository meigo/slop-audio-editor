import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject } from "../doc/document";
import { addClip, addTrack, makeClip } from "../doc/edits";
import { referencedSourceIds } from "./project-io.svelte";

beforeEach(() => __resetIds());

describe("referencedSourceIds", () => {
  it("returns empty set for a project with no clips", () => {
    const p = createProject();
    const ids = referencedSourceIds(p);
    expect(ids).toEqual(new Set());
    expect(ids.size).toBe(0);
  });

  it("returns every distinct sourceId across multiple tracks", () => {
    let p = createProject();
    p = addTrack(p, "Track 2");
    p = addTrack(p, "Track 3");

    // Add clips with different source IDs across different tracks
    p = addClip(p, p.tracks[0].id, makeClip("source-a", 0, 2));
    p = addClip(p, p.tracks[0].id, makeClip("source-b", 3, 2));
    p = addClip(p, p.tracks[1].id, makeClip("source-c", 0, 2));
    p = addClip(p, p.tracks[2].id, makeClip("source-d", 0, 2));

    const ids = referencedSourceIds(p);
    expect(ids).toEqual(new Set(["source-a", "source-b", "source-c", "source-d"]));
    expect(ids.size).toBe(4);
  });

  it("returns a Set with each source appearing once, even if used by multiple clips", () => {
    let p = createProject();

    // Same source used by multiple clips
    p = addClip(p, p.tracks[0].id, makeClip("source-x", 0, 2));
    p = addClip(p, p.tracks[0].id, makeClip("source-x", 4, 2));
    p = addClip(p, p.tracks[0].id, makeClip("source-x", 8, 2));

    const ids = referencedSourceIds(p);
    expect(ids).toEqual(new Set(["source-x"]));
    expect(ids.size).toBe(1);
  });

  it("handles a mix of tracks with and without clips", () => {
    let p = createProject();
    // First track (from createProject) stays empty
    p = addTrack(p, "Track with clips");

    // Add clips only to the second track, leave first empty
    p = addClip(p, p.tracks[1].id, makeClip("source-1", 0, 2));
    p = addClip(p, p.tracks[1].id, makeClip("source-2", 3, 2));

    const ids = referencedSourceIds(p);
    expect(ids).toEqual(new Set(["source-1", "source-2"]));
    expect(ids.size).toBe(2);
  });

  it("excludes source IDs not referenced by any clip", () => {
    let p = createProject();

    // Add clips with certain sources
    p = addClip(p, p.tracks[0].id, makeClip("referenced-1", 0, 2));
    p = addClip(p, p.tracks[0].id, makeClip("referenced-2", 3, 2));

    const ids = referencedSourceIds(p);

    // Verify that only the referenced sources are in the set
    expect(ids).toEqual(new Set(["referenced-1", "referenced-2"]));
    expect(ids.has("referenced-1")).toBe(true);
    expect(ids.has("referenced-2")).toBe(true);
    expect(ids.has("unreferenced-source")).toBe(false);
    expect(ids.size).toBe(2);
  });
});
