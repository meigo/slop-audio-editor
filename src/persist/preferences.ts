const KEY = "slop-audio-editor.prefs";

export interface Preferences {
  pxPerSecond: number;
  snap: boolean;
  trackHeightPx: number;
  lastFormat: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  pxPerSecond: 60,
  snap: true,
  trackHeightPx: 88,
  lastFormat: "wav16",
};

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
    lastFormat:
      typeof r.lastFormat === "string" ? r.lastFormat : DEFAULT_PREFERENCES.lastFormat,
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
