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
