import { describe, expect, it } from "vitest";
import { MIN_PLAY_RANGE_S, setIn, setOut, type PlayRange } from "./play-range";

describe("setIn", () => {
  it("creates a range from null: [atS, projectEndS]", () => {
    expect(setIn(null, 3, 10)).toEqual({ fromS: 3, toS: 10 });
  });

  it("refuses to create a degenerate range when the playhead is at or past the end", () => {
    expect(setIn(null, 10, 10)).toBeNull();
    expect(setIn(null, 12, 10)).toBeNull();
  });

  it("moves fromS only on an existing range", () => {
    const range: PlayRange = { fromS: 2, toS: 5 };
    expect(setIn(range, 3, 10)).toEqual({ fromS: 3, toS: 5 });
  });

  it("clamps fromS when pushing IN past OUT, never swapping the ends", () => {
    const range: PlayRange = { fromS: 1, toS: 2 };
    const next = setIn(range, 5, 10)!;
    expect(next.fromS).toBeCloseTo(2 - MIN_PLAY_RANGE_S);
    expect(next.toS).toBe(2);
    expect(next.fromS).toBeLessThan(next.toS);
  });

  it("clamps to 0 at the low end", () => {
    expect(setIn(null, -5, 10)).toEqual({ fromS: 0, toS: 10 });
    const range: PlayRange = { fromS: 3, toS: 8 };
    expect(setIn(range, -5, 10)).toEqual({ fromS: 0, toS: 8 });
  });

  it("clamps to projectEndS at the high end", () => {
    const range: PlayRange = { fromS: 3, toS: 8 };
    expect(setIn(range, 100, 10)!.fromS).toBeCloseTo(8 - MIN_PLAY_RANGE_S);
  });

  it("returns the SAME object when the move is a no-op", () => {
    const range: PlayRange = { fromS: 2, toS: 5 };
    expect(setIn(range, 2, 10)).toBe(range);
  });
});

describe("setOut", () => {
  it("creates a range from null: [0, atS]", () => {
    expect(setOut(null, 7, 10)).toEqual({ fromS: 0, toS: 7 });
  });

  it("refuses to create a degenerate range when the playhead is at or before the start", () => {
    expect(setOut(null, 0, 10)).toBeNull();
    expect(setOut(null, -3, 10)).toBeNull();
  });

  it("moves toS only on an existing range", () => {
    const range: PlayRange = { fromS: 2, toS: 5 };
    expect(setOut(range, 6, 10)).toEqual({ fromS: 2, toS: 6 });
  });

  it("clamps toS when pushing OUT past IN, never swapping the ends", () => {
    const range: PlayRange = { fromS: 1, toS: 2 };
    const next = setOut(range, -5, 10)!;
    expect(next.toS).toBeCloseTo(1 + MIN_PLAY_RANGE_S);
    expect(next.fromS).toBe(1);
    expect(next.fromS).toBeLessThan(next.toS);
  });

  it("clamps to projectEndS at the high end", () => {
    expect(setOut(null, 100, 10)).toEqual({ fromS: 0, toS: 10 });
    const range: PlayRange = { fromS: 2, toS: 5 };
    expect(setOut(range, 100, 10)).toEqual({ fromS: 2, toS: 10 });
  });

  it("floors fromS at 0 and clamps toS at the low end against fromS + MIN", () => {
    const range: PlayRange = { fromS: 3, toS: 8 };
    expect(setOut(range, -5, 10)!.toS).toBeCloseTo(3 + MIN_PLAY_RANGE_S);
  });

  it("returns the SAME object when the move is a no-op", () => {
    const range: PlayRange = { fromS: 2, toS: 5 };
    expect(setOut(range, 5, 10)).toBe(range);
  });
});
