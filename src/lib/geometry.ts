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

/** Target spacing between ruler ticks. 80 px put a tick every ~1.3 s at the default zoom and a
 *  LABEL only every ~600 px, which reads as an empty strip with three numbers on it. 40 px gives
 *  twice the ticks and a label roughly every 300 px — still far wider than a `00:00.000` label,
 *  so nothing crowds. */
const TICK_TARGET_PX = 40;

/** Steps come from a 1-2-5 ladder so the labels are always round numbers. Every fifth tick is
 *  major (labelled). */
const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function rulerTicks(
  fromS: number,
  toS: number,
  pxPerSecond: number,
): { s: number; major: boolean }[] {
  if (!(toS > fromS)) return [];
  const targetS = TICK_TARGET_PX / pxPerSecond;
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
 *  enough that the inline SVG stays small — the audio curve uses `FADE_CURVE_POINTS` (128). */
export const FADE_MASK_POINTS = 24;

/** Bottom of the master meter's scale, dBFS. A narrow range keeps the part where mixing decisions
 *  actually happen — the top few dozen dB — from being squeezed into a sliver of the bar. */
export const METER_FLOOR_DB = -48;

/** Meter fill for a level in dBFS, as a percentage of the track. Silence (`-Infinity`) and
 *  anything at or below the floor read empty; an over pegs at 100 rather than overflowing. */
export function meterFillPct(db: number, floorDb: number = METER_FLOOR_DB): number {
  if (db === -Infinity) return 0;
  return Math.max(0, Math.min(1, (db - floorDb) / -floorDb)) * 100;
}

/** CSS `polygon()` shading how much an arbitrary gain envelope takes away across a clip, given
 *  breakpoints in seconds from the clip's start. Same convention as the fade curves — the
 *  shaded region is the area under `1 - gain` — but for irregularly spaced points rather than an
 *  evenly sampled curve. Returns "" when there is nothing to draw. */
export function envelopeXY(
  points: readonly { t: number; gain: number }[],
  durS: number,
): { x: number; y: number }[] {
  if (points.length === 0 || !(durS > 0)) return [];
  const xy = points.map((p) => ({
    x: Math.max(0, Math.min(100, (p.t / durS) * 100)),
    y: (1 - p.gain) * 100,
  }));
  // The envelope holds its final value to the end of the clip; without this the shading would
  // stop partway and read as the level coming back up when it does not.
  const last = xy[xy.length - 1];
  if (last.x < 100) xy.push({ x: 100, y: last.y });
  return xy;
}

/** The same, as SVG `points`: the envelope's edge, and the region it removes closed along the
 *  top. Ducking draws these exactly as a fade draws its curve — one convention for both. */
export function envelopeCurvePoints(
  points: readonly { t: number; gain: number }[],
  durS: number,
): string {
  return envelopeXY(points, durS)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

export function envelopeAreaPoints(
  points: readonly { t: number; gain: number }[],
  durS: number,
): string {
  const edge = envelopeCurvePoints(points, durS);
  return edge === "" ? "" : `0,0 100,0 ${edge.split(" ").reverse().join(" ")}`;
}


/** Timeline scale limits, shared by the wheel handler and the pinch gesture. */
export const MIN_PX_PER_S = 2;
export const MAX_PX_PER_S = 2000;

export interface PinchStart {
  pxPerSecond: number;
  scrollS: number;
  /** Midpoint between the two pointers, in viewport-local pixels, at gesture start. */
  centerPx: number;
  /** Distance between the two pointers at gesture start. */
  spreadPx: number;
}

/**
 * New scale and scroll for a two-finger gesture.
 *
 * Pinch and pan are the SAME gesture: the spread ratio sets the scale, the centre sets what time
 * sits under the fingers. Handling them separately would need a mode switch and a threshold to
 * decide which one the user meant — this way a gesture that both spreads and slides just works.
 *
 * Everything is computed from the values captured at gesture START, never from the previous
 * frame, for the same reason `clip-drag` computes from `base`: applying successive deltas to a
 * moving target compounds, and the timeline would drift out from under the fingers.
 */
export function pinchUpdate(
  start: PinchStart,
  now: { centerPx: number; spreadPx: number },
): { pxPerSecond: number; scrollS: number } {
  const anchorS = start.scrollS + start.centerPx / start.pxPerSecond;
  const ratio = start.spreadPx > 0 ? now.spreadPx / start.spreadPx : 1;
  const pxPerSecond = Math.min(MAX_PX_PER_S, Math.max(MIN_PX_PER_S, start.pxPerSecond * ratio));
  return { pxPerSecond, scrollS: Math.max(0, anchorS - now.centerPx / pxPerSecond) };
}

/** How close to flat an EQ band must be before it snaps there. */
export const BAND_DETENT_DB = 0.5;

/** Snap an EQ band to exactly flat near the centre. Landing on 0.00 by hand is otherwise close to
 *  impossible, and it matters here beyond tidiness: `renderPlan` builds NO filter nodes for a flat
 *  EQ, so a band left at -0.07 dB silently keeps three biquads in the graph forever. */
export function snapBandDb(db: number, detentDb: number = BAND_DETENT_DB): number {
  return Math.abs(db) <= detentDb ? 0 : db;
}

/** A band's value for display: signed, one decimal, with a real minus sign (U+2212) to match the
 *  rest of the app's dB readouts. */
export function formatSignedDb(db: number): string {
  if (db === 0) return "0.0 dB";
  return `${db > 0 ? "+" : "−"}${Math.abs(db).toFixed(1)} dB`;
}

/** The fade's gain curve as points in a 0-100 box: x across the fade, y as the amount the fade
 *  TAKES AWAY (`1 - gain`), so y=0 is untouched and y=100 is silence.
 *
 *  Shared by the shaded area and the stroked edge drawn over it, so the two cannot disagree about
 *  where the curve runs. */
export function fadeCurveXY(curve: Float32Array): { x: number; y: number }[] {
  const n = curve.length;
  return Array.from(curve, (g, i) => ({
    x: n === 1 ? 0 : (i / (n - 1)) * 100,
    y: (1 - g) * 100,
  }));
}

/** `points` for an SVG polyline: the curve edge alone. */
export function fadeCurvePoints(curve: Float32Array): string {
  return fadeCurveXY(curve)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

/** `points` for an SVG polygon: the region the fade removes, closed along the top edge. */
export function fadeAreaPoints(curve: Float32Array): string {
  const xy = fadeCurveXY(curve);
  return `0,0 100,0 ${xy
    .slice()
    .reverse()
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ")}`;
}
