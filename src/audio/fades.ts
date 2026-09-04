import type { FadeShape } from "../doc/document";

/** Points per curve handed to `setValueCurveAtTime`. Enough for a smooth ramp at any fade length. */
export const FADE_CURVE_POINTS = 128;

/** Gain at normalised position `t` (0 = fade start, 1 = fade end) for a RISING fade. */
function shapeAt(shape: FadeShape, t: number): number {
  switch (shape) {
    case "equalPower":
      return Math.sin((t * Math.PI) / 2); // constant perceived loudness
    case "exponential":
      return t * t; // slow start, fast finish — for ducking a bed under speech
    case "linear":
    default:
      return t;
  }
}

function sample(shape: FadeShape, n: number, fromT: number, toT: number, rising: boolean) {
  const out = new Float32Array(n);
  const span = toT - fromT;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? fromT : fromT + (span * i) / (n - 1);
    out[i] = shapeAt(shape, rising ? t : 1 - t);
  }
  return out;
}

/**
 * Gain rising 0 → 1 across the fade.
 *
 * `fromT`/`toT` sample a SUB-RANGE of the fade in normalised fade time. That is how a fade the
 * playback window started partway through is handled: the engine schedules the remainder rather
 * than dropping the fade or restarting it.
 */
export function fadeInCurve(
  shape: FadeShape,
  n: number = FADE_CURVE_POINTS,
  fromT = 0,
  toT = 1,
): Float32Array {
  return sample(shape, n, fromT, toT, true);
}

/** Gain falling 1 → 0 across the fade. The exact mirror of `fadeInCurve`. */
export function fadeOutCurve(
  shape: FadeShape,
  n: number = FADE_CURVE_POINTS,
  fromT = 0,
  toT = 1,
): Float32Array {
  return sample(shape, n, fromT, toT, false);
}
