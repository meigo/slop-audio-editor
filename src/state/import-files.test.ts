import { beforeEach, describe, expect, it, vi } from "vitest";

/** The decode is the slow, yielding part of an import — the whole reason the target track can
 *  disappear before the clip is committed. The mock resolves on demand so the test can delete the
 *  track while the "decode" is still pending. */
const pending = vi.hoisted(() => ({ resolve: null as null | (() => void) }));
vi.mock("../audio/pool", () => ({
  sourceFromFile: async (file: File) => {
    await new Promise<void>((r) => {
      pending.resolve = r;
    });
    return {
      id: "src-new",
      name: file.name,
      bytes: new Uint8Array([1]),
      buffer: null,
      peaks: new Float32Array(0),
      durationS: 2,
      loudnessLufs: -20,
    };
  },
  decodeSource: async () => {
    throw new Error("not used here");
  },
  SourcePool: class {
    #m = new Map<string, unknown>();
    add(s: { id: string }) {
      this.#m.set(s.id, s);
    }
    get(id: string) {
      return this.#m.get(id);
    }
    all() {
      return [...this.#m.values()];
    }
    records() {
      return [];
    }
    clear() {
      this.#m.clear();
    }
  },
}));
vi.mock("../persist/autosave", () => ({
  putSource: async () => {},
  scheduleDocumentSave: () => {},
}));

const { __resetIds, createProject } = await import("../doc/document");
const { addTrack, removeTrack } = await import("../doc/edits");
const appState = await import("./appState.svelte");

beforeEach(() => {
  __resetIds();
  pending.resolve = null;
});

describe("importFiles", () => {
  it("still lands the clip when the target track was deleted during the decode", async () => {
    appState.state.project = addTrack(createProject(), "B");
    const target = appState.state.project.tracks[1].id;

    const done = appState.importFiles([new File([new Uint8Array([1])], "a.wav")], target, 0);
    // The decode is pending; the user deletes the track it was aimed at.
    await Promise.resolve();
    appState.commit((p) => removeTrack(p, target));
    pending.resolve!();
    await done;

    // Resolved at commit time to a live track, rather than silently dropped — the source had
    // already been written and would otherwise sit as an orphan with no clip anywhere.
    const clips = appState.state.project.tracks.flatMap((t) => t.clips);
    expect(clips.map((c) => c.sourceId)).toEqual(["src-new"]);
  });
});
