import { FILTER_OFF, type TrackFilter } from "../doc/document";
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

/** Steps come from a 1-2-5 ladder so ticks land on round numbers. */
const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Labelled ticks prefer WHOLE SECONDS. A label reading `00:02.500` is hard to read against and
 *  looks like a mistake; the tick step can be finer than a second without the labels being. */
const LABEL_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Past this, whole-second labels would be so far apart that a zoomed-in viewport could show
 *  none at all — so above roughly 600 px/s the labels go sub-second rather than disappear. */
const MAX_LABEL_GAP_PX = 600;

export function rulerTicks(
  fromS: number,
  toS: number,
  pxPerSecond: number,
): { s: number; major: boolean }[] {
  if (!(toS > fromS)) return [];
  const targetS = TICK_TARGET_PX / pxPerSecond;
  const step = TICK_STEPS.find((s) => s >= targetS) ?? TICK_STEPS[TICK_STEPS.length - 1];

  // The smallest whole-second interval that is at least as sparse as every-fifth-tick AND lands
  // exactly on ticks, so a label always sits on a tick rather than between two.
  const isMultiple = (c: number): boolean => Math.abs(c / step - Math.round(c / step)) < 1e-9;
  let labelStep =
    LABEL_STEPS_S.find((c) => c >= 5 * step && isMultiple(c)) ??
    LABEL_STEPS_S[LABEL_STEPS_S.length - 1];
  if (labelStep * pxPerSecond > MAX_LABEL_GAP_PX) labelStep = step * 5;
  const everyNth = Math.max(1, Math.round(labelStep / step));

  const out: { s: number; major: boolean }[] = [];
  const first = Math.floor(fromS / step);
  const last = Math.ceil(toS / step);
  for (let i = first; i <= last; i++) {
    out.push({ s: i * step, major: i % everyNth === 0 });
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

/** Starting scale for a fresh session, and the fallback when there is no span to fit. */
export const DEFAULT_PX_PER_S = 60;

/** Breathing room left at each side of a fitted span, so its edges are not flush with the
 *  viewport's own. */
export const FIT_PAD_PX = 12;

/**
 * Scale and scroll that put `fromS`..`toS` across the viewport with `FIT_PAD_PX` to spare at each
 * side.
 *
 * An empty span falls back to the default scale rather than dividing by zero — fitting a
 * zero-length range or an empty project would otherwise land at maximum zoom on nothing.
 *
 * The scroll can never go below 0: there is nothing before t = 0 to show, and `formatTime` renders
 * every negative tick as 00:00.000. When the left pad would fall off that start, its WIDTH is
 * given back to the span rather than simply clamped away — subtracting both pads from the scale
 * and then dropping one of them piles both up as a gap on the right, which is what a fit of the
 * whole project (which always starts at 0) did.
 */
export function fitView(
  fromS: number,
  toS: number,
  viewportWidthPx: number,
): { pxPerSecond: number; scrollS: number } {
  const spanS = toS - fromS;
  if (!(spanS > 0)) {
    return {
      pxPerSecond: DEFAULT_PX_PER_S,
      scrollS: Math.max(0, fromS - FIT_PAD_PX / DEFAULT_PX_PER_S),
    };
  }
  // A viewport narrower than its own pads would ask for a negative width; one pixel keeps the
  // scale finite and the clamp does the rest.
  const bothPads = clampScale(Math.max(1, viewportWidthPx - 2 * FIT_PAD_PX) / spanS);
  const scrollS = fromS - FIT_PAD_PX / bothPads;
  if (scrollS >= 0) return { pxPerSecond: bothPads, scrollS };
  // Pinned to 0, so the visible window is 0..toS and only the RIGHT pad is spent.
  return { pxPerSecond: clampScale(Math.max(1, viewportWidthPx - FIT_PAD_PX) / toS), scrollS: 0 };
}

function clampScale(pxPerSecond: number): number {
  return Math.min(MAX_PX_PER_S, Math.max(MIN_PX_PER_S, pxPerSecond));
}

/** Where the playhead lands after a page flip: a little in from the left edge, so the moment of
 *  the flip is still visible rather than sitting on the border. */
export const PAGE_FLIP_MARGIN_PX = 24;

/** Is a time inside the viewport, edges inclusive? */
export function isInView(
  s: number,
  scrollS: number,
  pxPerSecond: number,
  widthPx: number,
): boolean {
  const px = timeToPx(s, scrollS, pxPerSecond);
  return px >= 0 && px <= widthPx;
}

/**
 * The scroll that keeps a running playhead on screen, or null when nothing should change.
 *
 * PAGE flip, not continuous scroll: the view jumps one screen when the playhead crosses the right
 * edge, and otherwise holds still — cheaper, nothing drifts, and it does not fight the user's own
 * scrolling while they audition. That last part is what `wasInView` carries: the flip only fires
 * when the playhead was in view a moment ago and is now past the right edge, i.e. it CROSSED. A
 * playhead that is off-screen because the user scrolled away stays off-screen — the view is
 * theirs until the playhead comes back to it.
 */
export function pageFlipScroll(
  playheadS: number,
  scrollS: number,
  pxPerSecond: number,
  widthPx: number,
  wasInView: boolean,
): number | null {
  if (!wasInView) return null;
  if (timeToPx(playheadS, scrollS, pxPerSecond) <= widthPx) return null;
  return Math.max(0, playheadS - PAGE_FLIP_MARGIN_PX / pxPerSecond);
}

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

/** The one-knob track filter. Position runs -1 (full high-pass) to +1 (full low-pass), with a
 *  dead zone at the centre meaning bypass — the same idiom as an EQ band's flat detent, and for
 *  the same reason: a filter left at 0.02 is not "off", so it would keep a biquad in the graph
 *  forever. */
export const FILTER_DETENT = 0.04;
/** High-pass sweeps UP from here; low-pass sweeps DOWN from here. Neither goes to the extreme of
 *  hearing — a high-pass at 20 kHz is just silence, and nobody needs it. */
export const FILTER_HP_MIN_HZ = 20;
export const FILTER_HP_MAX_HZ = 2000;
export const FILTER_LP_MIN_HZ = 200;
export const FILTER_LP_MAX_HZ = 20000;

const logMap = (t: number, lo: number, hi: number): number => lo * (hi / lo) ** t;
const logUnmap = (hz: number, lo: number, hi: number): number =>
  Math.log(hz / lo) / Math.log(hi / lo);

/**
 * Knob position to a real filter.
 *
 * The DOCUMENT stores the filter, not the position: "high-pass at 120 Hz" keeps its meaning if
 * this curve is ever retuned, whereas a stored -0.42 would quietly change what a saved project
 * sounds like. This mapping is therefore a UI concern, and its inverse below is what puts the
 * thumb back where the user left it.
 */
export function filterFromPosition(position: number): TrackFilter {
  const p = Math.max(-1, Math.min(1, position));
  if (Math.abs(p) <= FILTER_DETENT) return FILTER_OFF;
  // Re-spread the travel outside the dead zone, so the knob reaches its extremes at +/-1 rather
  // than stopping a detent short.
  const t = (Math.abs(p) - FILTER_DETENT) / (1 - FILTER_DETENT);
  return p < 0
    ? { kind: "highpass", hz: logMap(t, FILTER_HP_MIN_HZ, FILTER_HP_MAX_HZ) }
    : { kind: "lowpass", hz: logMap(1 - t, FILTER_LP_MIN_HZ, FILTER_LP_MAX_HZ) };
}

/** Inverse of `filterFromPosition`, so the slider shows where the stored filter actually sits. */
export function filterPosition(filter: TrackFilter): number {
  if (filter.kind === "off") return 0;
  const t =
    filter.kind === "highpass"
      ? logUnmap(filter.hz, FILTER_HP_MIN_HZ, FILTER_HP_MAX_HZ)
      : 1 - logUnmap(filter.hz, FILTER_LP_MIN_HZ, FILTER_LP_MAX_HZ);
  const p = FILTER_DETENT + Math.max(0, Math.min(1, t)) * (1 - FILTER_DETENT);
  return filter.kind === "highpass" ? -p : p;
}

/** "off", "HP 120 Hz", "LP 4.2 kHz" — the readout beside the knob. */
export function formatFilter(filter: TrackFilter): string {
  if (filter.kind === "off") return "off";
  const label = filter.kind === "highpass" ? "HP" : "LP";
  return filter.hz >= 1000
    ? `${label} ${(filter.hz / 1000).toFixed(1)} kHz`
    : `${label} ${Math.round(filter.hz)} Hz`;
}

/**
 * Equal-power pan law, NORMALISED so the centre is unity.
 *
 * Equal power, not linear: `left^2 + right^2` is constant, so the perceived loudness does not
 * change as a source moves across the image. A linear law dips audibly in the middle.
 *
 * The `sqrt(2)` is what makes it usable HERE. A centred track builds no pan nodes at all — the
 * same "neutral builds nothing" rule the EQ and filter follow — so a centred track renders at
 * unity. The textbook law puts its centre at -3.01 dB, which meant nudging pan off centre dropped
 * the level by 3 dB with an audible step. Scaling the whole law up by sqrt(2) makes the centre
 * agree with the bypass exactly, at the cost of hard-panned material peaking +3.01 dB in the
 * channel it lands in. That is the honest trade: the total power is still constant everywhere, an
 * existing project renders bit-identically, and the peak is visible on the meter and caught by
 * the export's peak check.
 */
export function panGains(pan: number): { left: number; right: number } {
  const x = (Math.max(-1, Math.min(1, pan)) + 1) / 2;
  return {
    left: Math.SQRT2 * Math.cos((x * Math.PI) / 2),
    right: Math.SQRT2 * Math.sin((x * Math.PI) / 2),
  };
}

/** "C", "L50", "R100" — how far off centre, in the units a mixer uses. */
export function formatPan(pan: number): string {
  const p = Math.max(-1, Math.min(1, pan));
  const amount = Math.round(Math.abs(p) * 100);
  if (amount === 0) return "C";
  return `${p < 0 ? "L" : "R"}${amount}`;
}
