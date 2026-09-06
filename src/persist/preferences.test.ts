import { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH } from "../lib/panel-layout";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  TRACK_HEIGHTS,
  nextTrackHeight,
  sanitisePreferences,
} from "./preferences";

describe("sanitisePreferences", () => {
  it("returns defaults for junk", () => {
    expect(sanitisePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitisePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
    expect(sanitisePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid values", () => {
    const p = sanitisePreferences({
      pxPerSecond: 120,
      snap: false,
      trackHeightPx: 64,
      lastFormat: "m4a",
      normaliseLufs: -16,
      sidePanelOpen: true,
      sidePanelWidth: 260,
      sidePanelTab: "master",
    });
    expect(p).toEqual({
      pxPerSecond: 120,
      snap: false,
      trackHeightPx: 64,
      lastFormat: "m4a",
      normaliseLufs: -16,
      sidePanelOpen: true,
      sidePanelWidth: 260,
      sidePanelTab: "master",
    });
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

describe("track height presets", () => {
  it("puts the long-standing default in the middle, so nothing moves for existing users", () => {
    expect(TRACK_HEIGHTS[1]).toBe(DEFAULT_PREFERENCES.trackHeightPx);
  });

  it("cycles small -> medium -> large -> small", () => {
    const [s, m, l] = TRACK_HEIGHTS;
    expect(nextTrackHeight(s)).toBe(m);
    expect(nextTrackHeight(m)).toBe(l);
    expect(nextTrackHeight(l)).toBe(s);
  });

  // A height restored from localStorage need not be one of the presets — it may predate them, or
  // have been hand-edited. Snapping to the next larger preset is what keeps the button usable
  // instead of appearing to do nothing.
  it("snaps an off-preset height up to the next preset", () => {
    expect(nextTrackHeight(TRACK_HEIGHTS[0] + 1)).toBe(TRACK_HEIGHTS[1]);
    expect(nextTrackHeight(TRACK_HEIGHTS[1] - 1)).toBe(TRACK_HEIGHTS[1]);
  });

  it("wraps to the smallest from anything at or above the largest", () => {
    expect(nextTrackHeight(TRACK_HEIGHTS[2] + 50)).toBe(TRACK_HEIGHTS[0]);
  });

  it("keeps every preset inside what sanitisePreferences accepts", () => {
    for (const h of TRACK_HEIGHTS) {
      expect(sanitisePreferences({ trackHeightPx: h }).trackHeightPx).toBe(h);
    }
  });
});

describe("normaliseLufs", () => {
  it("defaults to no normalisation, so exports are unchanged unless asked", () => {
    expect(DEFAULT_PREFERENCES.normaliseLufs).toBeNull();
    expect(sanitisePreferences({}).normaliseLufs).toBeNull();
  });

  it("keeps a sane target and rejects anything else", () => {
    expect(sanitisePreferences({ normaliseLufs: -16 }).normaliseLufs).toBe(-16);
    expect(sanitisePreferences({ normaliseLufs: "loud" }).normaliseLufs).toBeNull();
    expect(sanitisePreferences({ normaliseLufs: NaN }).normaliseLufs).toBeNull();
  });

  it("clamps a hand-edited target into range", () => {
    expect(sanitisePreferences({ normaliseLufs: 12 }).normaliseLufs).toBe(0);
    expect(sanitisePreferences({ normaliseLufs: -99 }).normaliseLufs).toBe(-40);
  });

  it("keeps the side panel open by default, and ignores a non-boolean", () => {
    expect(sanitisePreferences({}).sidePanelOpen).toBe(true);
    expect(sanitisePreferences({ sidePanelOpen: "yes" }).sidePanelOpen).toBe(true);
  });

  it("clamps a stored panel width and falls back for junk", () => {
    expect(sanitisePreferences({ sidePanelWidth: 20 }).sidePanelWidth).toBe(MIN_PANEL_WIDTH);
    expect(sanitisePreferences({ sidePanelWidth: "wide" }).sidePanelWidth).toBe(
      DEFAULT_PANEL_WIDTH,
    );
  });

  it("only accepts a tab it knows", () => {
    expect(sanitisePreferences({ sidePanelTab: "track" }).sidePanelTab).toBe("track");
    expect(sanitisePreferences({ sidePanelTab: "master" }).sidePanelTab).toBe("master");
    // "mix" was the old two-tab name; anything unrecognised falls back rather than rendering
    // nothing.
    expect(sanitisePreferences({ sidePanelTab: "mix" }).sidePanelTab).toBe("clip");
    expect(sanitisePreferences({ sidePanelTab: "nope" }).sidePanelTab).toBe("clip");
  });
});

describe("sanitisePreferences: lastFormat", () => {
  it("keeps a format the exporter knows", () => {
    expect(sanitisePreferences({ lastFormat: "mp3" }).lastFormat).toBe("mp3");
  });

  it("falls back for anything else — the value is handed straight to the encoder", () => {
    // A hand-edited or renamed value used to sail past the WAV branch into `formatFor`, which has
    // no default and returns undefined.
    expect(sanitisePreferences({ lastFormat: "flac" }).lastFormat).toBe("wav16");
    expect(sanitisePreferences({ lastFormat: 7 }).lastFormat).toBe("wav16");
  });
});
