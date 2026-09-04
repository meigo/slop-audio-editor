import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, adoptIds, createProject, newId } from "../doc/document";
import { addClip, addTrack, makeClip } from "../doc/edits";
import { packProject, unpackProject, type SourceRecord } from "./project-file";
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

describe("id adoption on load (regression)", () => {
  // Reproduces the real bug: a project round-tripped through a .slopaudio file (or autosave, same
  // shape) still holds ids minted in an earlier session, but the id counter resets to 0 on every
  // page load. `loadInto` (project-io.svelte.ts) must adopt every id the loaded data contains
  // before anything is installed — this test exercises that same id-collection logic against the
  // actual shape `unpackProject` hands back, without needing a browser to decode audio.
  //
  // `idCounter` is a single counter shared across all prefixes, so after a reset the Nth newId()
  // call — whatever its prefix — always mints number N. To deterministically prove this test would
  // catch a regression (not just happen to pass), the loaded document's ids are pinned to "src-1"
  // and "clip-2" — exactly the ids the two `newId` calls below mint on a bare reset, matching call
  // order (src, then clip). Without adopting first, this is a guaranteed collision, not a lucky one.
  it("adopting every track/clip/source id from a round-tripped project prevents the next mint from colliding", () => {
    let p = createProject();
    const srcA: SourceRecord = { id: "src-1", name: "a.wav", bytes: new Uint8Array([1]) };
    const clipA = { ...makeClip(srcA.id, 0, 1), id: "clip-2" };
    p = addClip(p, p.tracks[0].id, clipA);

    const bytes = packProject(p, [srcA]);
    const { project: loaded, sources: loadedSources } = unpackProject(bytes);

    // Simulate a page reload: the counter resets, but the ids above were minted before that.
    __resetIds();

    // What `loadInto` does before installing the pool/project: adopt every id the loaded data
    // contains — every track id, every clip id on every track, and every source id.
    const loadedIds: string[] = [];
    for (const t of loaded.tracks) {
      loadedIds.push(t.id);
      for (const c of t.clips) loadedIds.push(c.id);
    }
    for (const s of loadedSources) loadedIds.push(s.id);
    adoptIds(loadedIds);

    // A subsequent import mints a new source id, then a new clip id, the way the app does.
    const newSrcId = newId("src");
    const newClipId = newId("clip");

    const existingIds = new Set(loadedIds);
    expect(existingIds.has(newSrcId)).toBe(false);
    expect(existingIds.has(newClipId)).toBe(false);
  });
});
