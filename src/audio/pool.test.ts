import { describe, expect, it } from "vitest";
import { SourcePool, type Source } from "./pool";

function fakeSource(id: string, name: string): Source {
  return {
    id, name, bytes: new Uint8Array([1, 2]),
    buffer: null as unknown as AudioBuffer, // the pool never touches the buffer
    peaks: new Float32Array([0, 0]), durationS: 1.5,
  };
}

describe("SourcePool", () => {
  it("stores and retrieves by id", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    expect(pool.get("a")?.name).toBe("a.wav");
    expect(pool.get("nope")).toBeUndefined();
  });

  it("lists everything it holds", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    pool.add(fakeSource("b", "b.mp3"));
    expect(pool.all().map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("produces SourceRecords carrying only what a project file needs", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    expect(pool.records()).toEqual([
      { id: "a", name: "a.wav", bytes: new Uint8Array([1, 2]) },
    ]);
  });

  it("clears on project open", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    pool.clear();
    expect(pool.all()).toEqual([]);
  });

  it("replaces a source added twice under the same id", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "old.wav"));
    pool.add(fakeSource("a", "new.wav"));
    expect(pool.all()).toHaveLength(1);
    expect(pool.get("a")?.name).toBe("new.wav");
  });
});
