export function timeToPx(s: number, scrollS: number, pxPerSecond: number): number {
  return (s - scrollS) * pxPerSecond;
}

export function pxToTime(px: number, scrollS: number, pxPerSecond: number): number {
  return px / pxPerSecond + scrollS;
}

/** Snap `s` to the nearest candidate within `thresholdPx` ON SCREEN. The threshold is in pixels,
 *  not seconds, so snapping stays equally forgiving to the hand at every zoom level. */
export function snapTime(
  s: number,
  candidates: readonly number[],
  pxPerSecond: number,
  thresholdPx = 8,
): number {
  let best = s;
  let bestDist = thresholdPx / pxPerSecond;
  for (const c of candidates) {
    const d = Math.abs(c - s);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

export function formatTime(s: number): string {
  // Round to milliseconds FIRST, then decompose — rounding after splitting lets 59.9999 carry
  // into "00:60.000".
  const totalMs = Math.round(Math.max(0, s) * 1000);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(Math.floor(totalMs / 60000), 2)}:${pad(Math.floor((totalMs % 60000) / 1000), 2)}.${pad(totalMs % 1000, 3)}`;
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Fader taper breakpoints — piecewise-linear in dB, so the useful range near unity gets most of
 *  the travel instead of a straight dB-per-pixel line burying it in the bottom half. `position`
 *  0 is a special case (handled outside this table): exact silence, -Infinity dB. The `db: -60`
 *  entry here is the limit the curve approaches as position -> 0 from above, not the value AT 0. */
const FADER_BREAKPOINTS: readonly { position: number; db: number }[] = [
  { position: 0, db: -60 },
  { position: 0.25, db: -30 },
  { position: 0.5, db: -12 },
  { position: 0.75, db: 0 },
  { position: 1, db: 12 },
];

/** Fader position (0..1) to dB. Piecewise-linear in dB so the useful range gets most of the
 *  travel. Position 0 is exact silence, -Infinity dB. */
export function positionToDb(position: number): number {
  if (position <= 0) return -Infinity;
  const p = Math.min(1, position);
  for (let i = 1; i < FADER_BREAKPOINTS.length; i++) {
    const a = FADER_BREAKPOINTS[i - 1];
    const b = FADER_BREAKPOINTS[i];
    if (p <= b.position) {
      const t = (p - a.position) / (b.position - a.position);
      return a.db + t * (b.db - a.db);
    }
  }
  return FADER_BREAKPOINTS[FADER_BREAKPOINTS.length - 1].db;
}

export function dbToPosition(db: number): number {
  const lo = FADER_BREAKPOINTS[0];
  const hi = FADER_BREAKPOINTS[FADER_BREAKPOINTS.length - 1];
  if (db <= lo.db) return lo.position;
  if (db >= hi.db) return hi.position;
  for (let i = 1; i < FADER_BREAKPOINTS.length; i++) {
    const a = FADER_BREAKPOINTS[i - 1];
    const b = FADER_BREAKPOINTS[i];
    if (db <= b.db) {
      const t = (db - a.db) / (b.db - a.db);
      return a.position + t * (b.position - a.position);
    }
  }
  return hi.position;
}

export function formatDb(gain: number): string {
  const db = gainToDb(gain);
  if (!Number.isFinite(db)) return "−∞ dB";
  const sign = db > 0.05 ? "+" : db < -0.05 ? "−" : "";
  return `${sign}${Math.abs(db).toFixed(1)} dB`;
}

/** Roughly one tick per 80 px, chosen from a 1-2-5 ladder so the labels are always round numbers.
 *  Every fifth tick is major (labelled). */
const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function rulerTicks(
  fromS: number,
  toS: number,
  pxPerSecond: number,
): { s: number; major: boolean }[] {
  if (!(toS > fromS)) return [];
  const targetS = 80 / pxPerSecond;
  const step = TICK_STEPS.find((s) => s >= targetS) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const out: { s: number; major: boolean }[] = [];
  const first = Math.floor(fromS / step);
  const last = Math.ceil(toS / step);
  for (let i = first; i <= last; i++) {
    out.push({ s: i * step, major: i % 5 === 0 });
  }
  return out;
}

/** Points sampled into a fade's `clip-path`. Enough that equal-power's bow reads as a curve, few
 *  enough that the inline style stays small — the audio curve uses `FADE_CURVE_POINTS` (128). */
export const FADE_MASK_POINTS = 24;

/** CSS `polygon()` shading the part of a clip a fade attenuates: the region under `1 - gain`.
 *
 *  Takes the gain curve rather than a shape name so the overlay is sampled from the SAME function
 *  the engine hands to `setValueCurveAtTime` — the picture cannot drift from the audio, the way
 *  preview and export cannot drift because both run `planSchedule`. A linear fade reduces to the
 *  plain triangle this replaced, so that case is unchanged by construction. */
export function fadeMaskPolygon(curve: Float32Array): string {
  const n = curve.length;
  const pts = ["0% 0%", "100% 0%"];
  for (let i = n - 1; i >= 0; i--) {
    const x = n === 1 ? 0 : (i / (n - 1)) * 100;
    pts.push(`${x.toFixed(2)}% ${((1 - curve[i]) * 100).toFixed(2)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}
