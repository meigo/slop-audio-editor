import { clampPanelWidth, DEFAULT_PANEL_WIDTH } from "../lib/panel-layout";
const KEY = "slop-audio-editor.prefs";

export interface Preferences {
  pxPerSecond: number;
  snap: boolean;
  trackHeightPx: number;
  lastFormat: string;
  /** Loudness target for export, LUFS. `null` means no normalisation. */
  normaliseLufs: number | null;
  /** Side panel expanded, its width in px, and which tab is showing. Working preferences, not
   *  document state — the same reason zoom and snap live here. */
  sidePanelOpen: boolean;
  sidePanelWidth: number;
  sidePanelTab: "clip" | "mix";
}

export const DEFAULT_PREFERENCES: Preferences = {
  pxPerSecond: 60,
  snap: true,
  trackHeightPx: 88,
  lastFormat: "wav16",
  normaliseLufs: null,
  sidePanelOpen: true,
  sidePanelWidth: DEFAULT_PANEL_WIDTH,
  sidePanelTab: "clip",
};

/** The three track heights the UI offers. The MIDDLE one is the long-standing default, so the
 *  feature arrives without moving anyone's timeline. Kept inside `sanitisePreferences`'s 40–300
 *  range, which is pinned by a test. */
export const TRACK_HEIGHTS = [56, 88, 140] as const;

/** The next preset above `current`, wrapping at the top.
 *
 *  Works from an arbitrary height, not just a preset: a value restored from localStorage may
 *  predate the presets or have been hand-edited, and a strict index lookup would leave the button
 *  doing nothing at all. */
export function nextTrackHeight(current: number): number {
  return TRACK_HEIGHTS.find((h) => h > current) ?? TRACK_HEIGHTS[0];
}

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}

/** localStorage is user-writable and survives across app versions, so nothing from it is trusted. */
export function sanitisePreferences(raw: unknown): Preferences {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    pxPerSecond: clamp(r.pxPerSecond, 2, 2000, DEFAULT_PREFERENCES.pxPerSecond),
    snap: typeof r.snap === "boolean" ? r.snap : DEFAULT_PREFERENCES.snap,
    trackHeightPx: clamp(r.trackHeightPx, 40, 300, DEFAULT_PREFERENCES.trackHeightPx),
    lastFormat: typeof r.lastFormat === "string" ? r.lastFormat : DEFAULT_PREFERENCES.lastFormat,
    normaliseLufs:
      typeof r.normaliseLufs === "number" && Number.isFinite(r.normaliseLufs)
        ? Math.max(-40, Math.min(0, r.normaliseLufs))
        : null,
    sidePanelOpen:
      typeof r.sidePanelOpen === "boolean" ? r.sidePanelOpen : DEFAULT_PREFERENCES.sidePanelOpen,
    // Clamped against a nominal wide viewport, not the real one: this runs before layout, and the
    // panel re-clamps itself against the actual window on mount and on resize.
    sidePanelWidth: clampPanelWidth(
      typeof r.sidePanelWidth === "number" && Number.isFinite(r.sidePanelWidth)
        ? r.sidePanelWidth
        : DEFAULT_PANEL_WIDTH,
      Number.MAX_SAFE_INTEGER,
    ),
    sidePanelTab: r.sidePanelTab === "mix" ? "mix" : DEFAULT_PREFERENCES.sidePanelTab,
  };
}

export function loadPreferences(): Preferences {
  try {
    return sanitisePreferences(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private browsing or a full quota — preferences are a convenience, never a hard failure.
  }
}
