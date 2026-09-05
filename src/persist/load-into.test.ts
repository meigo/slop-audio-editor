import { describe, expect, it, vi } from "vitest";

/** The audio layer is the only reason `loadInto` was previously untestable: it decodes every
 *  source before touching state, which needs a real AudioContext. Stub the decode and the whole
 *  load path becomes reachable in the node environment. */
vi.mock("../audio/pool", () => ({
  decodeSource: async (id: string, name: string, bytes: Uint8Array) => ({
    id, name, bytes, buffer: null, peaks: new Float32Array(0), durationS: 1, loudnessLufs: -20,
  }),
  SourcePool: class {
    #m = new Map<string, unknown>();
    clear() { this.#m.clear(); }
    add(s: { id: string }) { this.#m.set(s.id, s); }
    get(id: string) { return this.#m.get(id); }
    records() { return [...this.#m.values()]; }
  },
}));
vi.mock("./autosave", () => ({
  clearAutosave: async () => {}, putSource: async () => {}, deleteSource: async () => {},
  readAutosave: async () => null, scheduleDocumentSave: () => {},
}));

const { __resetIds, createProject, newId } = await import("../doc/document");
const { addClip, makeClip } = await import("../doc/edits");
const { packProject } = await import("./project-file");
const { openProjectFile } = await import("./project-io.svelte");
const appState = await import("../state/appState.svelte");

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

  it("clears undo history, so undo cannot walk back into the previous document", async () => {
    const p = createProject();
    const bytes = packProject(p, []);
    appState.commit((prev) => ({ ...prev, name: "before load" })); // something to undo
    expect(appState.canUndoNow()).toBe(true);

    await openProjectFile(new File([bytes.slice()], "p.slopaudio"));
    expect(appState.canUndoNow()).toBe(false);
  });
});
