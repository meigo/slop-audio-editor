import { beforeEach, describe, expect, it, vi } from "vitest";

/** The audio layer is the only reason `loadInto` was previously untestable: it decodes every
 *  source before touching state, which needs a real AudioContext. Stub the decode and the whole
 *  load path becomes reachable in the node environment. */
vi.mock("../audio/pool", () => ({
  decodeSource: async (id: string, name: string, bytes: Uint8Array) => ({
    id,
    name,
    bytes,
    buffer: null,
    peaks: new Float32Array(0),
    durationS: 1,
    loudnessLufs: -20,
  }),
  SourcePool: class {
    #m = new Map<string, unknown>();
    clear() {
      this.#m.clear();
    }
    add(s: { id: string }) {
      this.#m.set(s.id, s);
    }
    get(id: string) {
      return this.#m.get(id);
    }
    records() {
      return [...this.#m.values()];
    }
  },
}));
/** Records the order of autosave writes and can be told to fail the source write, which is the
 *  failure this path exists to survive: the sources being written are the ones just loaded, so a
 *  quota error here is the likely case, not the exotic one. */
const auto = vi.hoisted(() => ({
  calls: [] as string[],
  failSources: false,
  document: null as unknown,
  existingIds: [] as string[],
  deleted: [] as string[],
}));
vi.mock("./autosave", () => ({
  putSource: async () => {
    auto.calls.push("putSource");
  },
  putSources: async () => {
    auto.calls.push("putSources");
    if (auto.failSources) throw new Error("QuotaExceededError");
  },
  putDocument: async (project: unknown) => {
    auto.calls.push("putDocument");
    auto.document = project;
  },
  listSourceIds: async () => {
    auto.calls.push("listSourceIds");
    return auto.existingIds;
  },
  deleteSource: async (id: string) => {
    auto.calls.push("deleteSource");
    auto.deleted.push(id);
  },
  readAutosave: async () => null,
  scheduleDocumentSave: () => {},
}));

const { __resetIds, createProject, newId } = await import("../doc/document");
const { addClip, makeClip } = await import("../doc/edits");
const { packProject } = await import("./project-file");
const { openProjectFile } = await import("./project-io.svelte");
const appState = await import("../state/appState.svelte");

/** A one-clip project referencing `src-1`, packed as a .slopaudio file. `extraIds` become sources
 *  carried in the file that no clip references — the shape `saveProjectFile` really produces,
 *  since it packs every source in the pool rather than only the reachable ones. */
function packedFile(extraIds: string[] = []): File {
  let p = createProject();
  p = addClip(p, p.tracks[0].id, makeClip("src-1", 0, 1));
  const records = ["src-1", ...extraIds].map((id) => ({
    id,
    name: `${id}.wav`,
    bytes: new Uint8Array([1]),
  }));
  const bytes = packProject(p, records);
  return new File([bytes.slice()], "p.slopaudio");
}

beforeEach(() => {
  auto.calls = [];
  auto.failSources = false;
  auto.document = null;
  auto.existingIds = [];
  auto.deleted = [];
});

describe("loadInto, through openProjectFile", () => {
  it("adopts the loaded ids, so the next mint cannot collide with one already in the project", async () => {
    let p = createProject();
    p = addClip(p, p.tracks[0].id, { ...makeClip("src-1", 0, 1), id: "clip-2" });
    const bytes = packProject(p, [{ id: "src-1", name: "a.wav", bytes: new Uint8Array([1]) }]);

    __resetIds(); // a page reload: the counter is back to 0 while the file still holds src-1/clip-2
    await openProjectFile(new File([bytes.slice()], "p.slopaudio"));

    const minted = [newId("src"), newId("clip")];
    const existing = new Set(["src-1", "clip-2"]);
    expect(minted.filter((id) => existing.has(id))).toEqual([]);
  });

  it("clears the previous document's session state, so it cannot reach the new one's export", async () => {
    // A time-range selection is what `exportWindow` reads. Left over from the previous project it
    // silently truncates an export of this one — and RangeOverlay draws nothing, because its
    // track ids match no track here. Same class as Gotchas 1 and 13.
    appState.state.selection = {
      kind: "range",
      range: { fromS: 2, toS: 4, trackIds: ["track-from-the-old-project"] },
    };
    appState.state.playRange = { fromS: 1, toS: 9 };
    appState.state.soloed.add("track-from-the-old-project");

    await openProjectFile(packedFile());

    expect(appState.state.selection).toEqual({ kind: "none" });
    expect(appState.state.playRange).toBeNull();
    expect(appState.state.soloed.size).toBe(0);
  });

  it("clears undo history, so undo cannot walk back into the previous document", async () => {
    const p = createProject();
    const bytes = packProject(p, []);
    appState.commit((prev) => ({ ...prev, name: "before load" })); // something to undo
    expect(appState.canUndoNow()).toBe(true);

    await openProjectFile(new File([bytes.slice()], "p.slopaudio"));
    expect(appState.canUndoNow()).toBe(false);
  });
});

describe("openProjectFile's autosave rewrite", () => {
  it("stores the sources before the document, so the two stores never describe different projects", async () => {
    await openProjectFile(packedFile());
    expect(auto.calls.indexOf("putSources")).toBeLessThan(auto.calls.indexOf("putDocument"));
  });

  it("leaves the previous autosave intact when the source write fails", async () => {
    auto.existingIds = ["src-old"];
    auto.failSources = true;

    await expect(openProjectFile(packedFile())).rejects.toThrow();

    // Nothing destructive ran: the document still describes the previous session and its audio
    // is still there, so the next launch restores what it would have restored anyway.
    expect(auto.document).toBe(null);
    expect(auto.deleted).toEqual([]);
  });

  it("prunes the replaced session's sources but not the ones it just wrote", async () => {
    // `src-unused` is the trap: stored under the previous session AND carried in the new file,
    // but referenced by no clip. Pruning by reference alone deletes bytes that were just
    // written and that the pool is holding — the document and the store would disagree from
    // the moment the project opened.
    auto.existingIds = ["src-old", "src-unused"];

    await openProjectFile(packedFile(["src-unused"]));

    expect(auto.deleted).toEqual(["src-old"]);
  });
});
