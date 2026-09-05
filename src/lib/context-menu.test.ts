import { describe, expect, it } from "vitest";
import { NO_SELECTION } from "../doc/selection";
import { clampMenuPosition, contextItems } from "./context-menu";

const clips = (n: number) => ({
  kind: "clips" as const,
  clipIds: Array.from({ length: n }, (_, i) => `c${i}`),
});
const range = {
  kind: "range" as const,
  range: { fromS: 1, toS: 2, trackIds: ["t1"] },
};
const byId = (sel: Parameters<typeof contextItems>[0], clip: boolean) =>
  Object.fromEntries(contextItems(sel, clip).map((i) => [i.id, i.enabled]));

describe("contextItems", () => {
  it("always offers the same five rows, so the menu never changes shape", () => {
    const shape = (sel: Parameters<typeof contextItems>[0], c: boolean) =>
      contextItems(sel, c).map((i) => i.id);
    expect(shape(NO_SELECTION, false)).toEqual(shape(clips(2), true));
    expect(shape(range, true)).toEqual(shape(NO_SELECTION, false));
  });

  it("enables the clipboard actions only for a clip selection", () => {
    expect(byId(clips(1), true)).toMatchObject({ cut: true, copy: true, duplicate: true });
    expect(byId(NO_SELECTION, true)).toMatchObject({ cut: false, copy: false, duplicate: false });
  });

  // A time range can be deleted but not copied: the clipboard holds whole clips.
  it("lets a time range be deleted but not cut or copied", () => {
    expect(byId(range, true)).toMatchObject({ delete: true, cut: false, copy: false });
  });

  it("enables paste from the clipboard alone, whatever is selected", () => {
    expect(byId(NO_SELECTION, true).paste).toBe(true);
    expect(byId(clips(3), false).paste).toBe(false);
  });

  it("disables delete when nothing is selected", () => {
    expect(byId(NO_SELECTION, false).delete).toBe(false);
    expect(byId({ kind: "clips", clipIds: [] }, false).delete).toBe(false);
  });
});

describe("clampMenuPosition", () => {
  const size = { width: 160, height: 200 };
  const viewport = { width: 1000, height: 800 };

  it("leaves a menu with room where it was opened", () => {
    expect(clampMenuPosition(100, 100, size, viewport)).toEqual({ x: 100, y: 100 });
  });

  it("flips to the other side of the pointer rather than sliding along the edge", () => {
    // Sliding would leave the menu covering the very clip that was clicked.
    expect(clampMenuPosition(900, 100, size, viewport).x).toBe(900 - 160);
    expect(clampMenuPosition(100, 700, size, viewport).y).toBe(700 - 200);
  });

  it("never goes off the top or left, even when flipping would", () => {
    const p = clampMenuPosition(20, 20, { width: 400, height: 400 }, { width: 300, height: 300 });
    expect(p.x).toBeGreaterThanOrEqual(4);
    expect(p.y).toBeGreaterThanOrEqual(4);
  });
});
