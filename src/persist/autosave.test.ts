import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../doc/document";

/** There is no IndexedDB in the node environment, so a save that actually RUNS reaches `open()`,
 *  throws, and is swallowed into a `console.warn` by the timer callback. That warning is the
 *  observable difference between "the debounce fired" and "the debounce did not" — which is the
 *  whole behaviour under test. The first test is the control that proves it fires at all.
 *
 *  Each test imports the module fresh: whether saves are disabled is module-level state with no
 *  way back (by design — only a reload makes autosave meaningful again), so a shared instance
 *  would make every test after the first one pass for free. */
let warn: ReturnType<typeof vi.spyOn>;

async function freshAutosave(): Promise<typeof import("./autosave")> {
  vi.resetModules();
  return import("./autosave");
}

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  warn.mockRestore();
});

describe("scheduleDocumentSave", () => {
  it("writes on the debounce", async () => {
    const { scheduleDocumentSave } = await freshAutosave();
    scheduleDocumentSave(createProject());

    await vi.runAllTimersAsync();

    expect(warn).toHaveBeenCalled(); // it tried, and only the missing IndexedDB stopped it
  });
});

describe("the shared connection", () => {
  it("does not cache a failed open — the next save tries again", async () => {
    // A fake `indexedDB` whose `open` always throws, so the observable is how many times it is
    // ASKED: a memoised rejection would be reused by the second tick and ask once. (The warning
    // count cannot tell the two apart — a cached rejection still warns on every tick.)
    const openSpy = vi.fn(() => {
      throw new Error("no IndexedDB here");
    });
    vi.stubGlobal("indexedDB", { open: openSpy });
    try {
      const { scheduleDocumentSave } = await freshAutosave();
      scheduleDocumentSave(createProject());
      await vi.runAllTimersAsync();
      scheduleDocumentSave(createProject());
      await vi.runAllTimersAsync();
      expect(openSpy).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("pauseDocumentSaves / resumeDocumentSaves", () => {
  it("holds a queued save until the replacement is fully written", async () => {
    // `loadInto` installs the new document before `openProjectFile` persists anything, so the
    // debounce is already ticking while the SOURCES are being written. That write is hundreds of
    // megabytes; if it outruns the 3 s debounce, the doc store ends up describing the new project
    // while the source store still holds the old one's audio.
    const { pauseDocumentSaves, resumeDocumentSaves, scheduleDocumentSave } = await freshAutosave();
    scheduleDocumentSave(createProject());
    pauseDocumentSaves();

    await vi.runAllTimersAsync();
    expect(warn).not.toHaveBeenCalled(); // nothing ran

    resumeDocumentSaves();
    scheduleDocumentSave(createProject());
    await vi.runAllTimersAsync();
    expect(warn).toHaveBeenCalled(); // ...and saving works again afterwards
  });

  it("cannot resurrect saves that a failed source write disabled for good", async () => {
    const { disableDocumentSaves, resumeDocumentSaves, scheduleDocumentSave } =
      await freshAutosave();
    disableDocumentSaves();
    resumeDocumentSaves();
    scheduleDocumentSave(createProject());

    await vi.runAllTimersAsync();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("disableDocumentSaves", () => {
  it("cancels a save that was already queued", async () => {
    const { disableDocumentSaves, scheduleDocumentSave } = await freshAutosave();
    scheduleDocumentSave(createProject()); // queued by loadInto's swap
    disableDocumentSaves(); // ...and then the source write failed

    await vi.runAllTimersAsync();

    // The queued write is the dangerous one: it would replace a good backup with a document
    // whose audio was never stored.
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores saves scheduled afterwards", async () => {
    const { disableDocumentSaves, scheduleDocumentSave } = await freshAutosave();
    disableDocumentSaves();
    scheduleDocumentSave(createProject()); // the user keeps editing

    await vi.runAllTimersAsync();

    expect(warn).not.toHaveBeenCalled();
  });
});
