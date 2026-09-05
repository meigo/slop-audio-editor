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
