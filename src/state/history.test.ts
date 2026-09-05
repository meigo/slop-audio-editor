import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, canRedo, canUndo, createHistory, record, redo, undo } from "./history";

describe("createHistory", () => {
  it("starts empty with nothing to undo or redo", () => {
    const h = createHistory<string>();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });
});

describe("record / undo / redo", () => {
  it("undo returns the recorded previous state and the current state becomes redoable", () => {
    let h = createHistory<string>();
    h = record(h, "a");
    const u = undo(h, "b")!;
    expect(u.state).toBe("a");
    expect(canRedo(u.history)).toBe(true);

    const r = redo(u.history, "a")!;
    expect(r.state).toBe("b");
  });

  it("walks back through several entries in order", () => {
    let h = createHistory<string>();
    h = record(h, "a");
    h = record(h, "b");
    const first = undo(h, "c")!;
    expect(first.state).toBe("b");
    expect(undo(first.history, "b")!.state).toBe("a");
  });

  it("returns null when there is nothing to undo or redo", () => {
    const h = createHistory<string>();
    expect(undo(h, "a")).toBeNull();
    expect(redo(h, "a")).toBeNull();
  });

  it("clears the redo stack on a new edit", () => {
    let h = createHistory<string>();
    h = record(h, "a");
    const u = undo(h, "b")!;
    expect(canRedo(u.history)).toBe(true);
    expect(canRedo(record(u.history, "a"))).toBe(false);
  });

  it("never mutates the history it is given", () => {
    const h = createHistory<string>();
    record(h, "a");
    expect(h.past).toHaveLength(0);
  });

  it("caps the past at HISTORY_LIMIT, dropping the oldest", () => {
    let h = createHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = record(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(10);
  });
});
