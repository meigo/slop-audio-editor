import { describe, expect, it } from "vitest";
import { clearsDirty, saveRoute } from "./save-target";

const ctx = (over: Partial<Parameters<typeof saveRoute>[0]> = {}) => ({
  canPick: true,
  hasHandle: false,
  saveAs: false,
  ...over,
});

describe("saveRoute", () => {
  it("writes back to a handle the user already chose", () => {
    // The whole point: a second Save overwrites that file rather than adding another copy to
    // Downloads.
    expect(saveRoute(ctx({ hasHandle: true }))).toEqual({ kind: "handle" });
  });

  it("asks for a location the first time", () => {
    expect(saveRoute(ctx())).toEqual({ kind: "picker" });
  });

  it("asks again for Save As, even holding a handle", () => {
    expect(saveRoute(ctx({ hasHandle: true, saveAs: true }))).toEqual({ kind: "picker" });
  });

  it("falls back to a download where the API does not exist", () => {
    // Firefox and Safari. Not an error state — just the old behaviour.
    expect(saveRoute(ctx({ canPick: false }))).toEqual({ kind: "download" });
    expect(saveRoute(ctx({ canPick: false, hasHandle: true }))).toEqual({ kind: "download" });
  });
});

describe("clearsDirty", () => {
  it("trusts a write that reported success", () => {
    expect(clearsDirty({ kind: "handle" })).toBe(true);
    expect(clearsDirty({ kind: "picker" })).toBe(true);
  });

  it("does not trust a download — a cancelled browser dialog looks identical to a save", () => {
    expect(clearsDirty({ kind: "download" })).toBe(false);
  });
});
