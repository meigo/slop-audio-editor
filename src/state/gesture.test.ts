import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audio/pool", () => ({
  sourceFromFile: async () => {
    throw new Error("not used here");
  },
  decodeSource: async () => {
    throw new Error("not used here");
  },
  SourcePool: class {
    get() {
      return undefined;
    }
    add() {}
    all() {
      return [];
    }
    records() {
      return [];
    }
    clear() {}
  },
}));
vi.mock("../persist/autosave", () => ({
  putSource: async () => {},
  scheduleDocumentSave: () => {},
}));

const { __resetIds, createProject } = await import("../doc/document");
const { addTrack, renameTrack } = await import("../doc/edits");
const appState = await import("./appState.svelte");

beforeEach(() => {
  __resetIds();
  appState.resetHistory();
  appState.state.project = createProject();
});

const name = () => appState.state.project.tracks[0].name;
const tracks = () => appState.state.project.tracks.length;

describe("a commit while a gesture is open", () => {
  it("keeps undo in chronological order", () => {
    // Dragging a clip and pressing Delete mid-drag: the keyboard edit commits while the drag's
    // gesture is still open. Recording the drag's base AFTER the edit put history out of order —
    // the first undo restored the pre-drag state and the second undid the edit into a mid-drag
    // snapshot. The gesture is closed before the commit and reopened after it, so the remainder of
    // the drag is still one entry of its own.
    const t = appState.state.project.tracks[0].id;
    appState.beginGesture();
    appState.amend((p) => renameTrack(p, t, "mid-drag"));
    appState.commit((p) => addTrack(p, "B"));
    appState.amend((p) => renameTrack(p, t, "end-of-drag"));
    appState.endGesture();

    expect([name(), tracks()]).toEqual(["end-of-drag", 2]);
    appState.undoEdit();
    expect([name(), tracks()]).toEqual(["mid-drag", 2]); // the rest of the drag
    appState.undoEdit();
    expect([name(), tracks()]).toEqual(["mid-drag", 1]); // the keyboard edit
    appState.undoEdit();
    expect([name(), tracks()]).toEqual(["Track 1", 1]); // the first part of the drag
    expect(appState.canUndoNow()).toBe(false);
  });
});
