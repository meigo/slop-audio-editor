import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, sanitisePreferences } from "./preferences";

describe("sanitisePreferences", () => {
  it("returns defaults for junk", () => {
    expect(sanitisePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitisePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
    expect(sanitisePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid values", () => {
    const p = sanitisePreferences({
      pxPerSecond: 120, snap: false, trackHeightPx: 64, lastFormat: "m4a",
    });
    expect(p).toEqual({ pxPerSecond: 120, snap: false, trackHeightPx: 64, lastFormat: "m4a" });
  });

  it("clamps out-of-range numbers rather than trusting them", () => {
    expect(sanitisePreferences({ pxPerSecond: 1e9 }).pxPerSecond).toBe(2000);
    expect(sanitisePreferences({ pxPerSecond: -5 }).pxPerSecond).toBe(2);
    expect(sanitisePreferences({ trackHeightPx: 5 }).trackHeightPx).toBe(40);
  });

  it("ignores fields of the wrong type", () => {
    expect(sanitisePreferences({ snap: "yes" }).snap).toBe(DEFAULT_PREFERENCES.snap);
  });
});
