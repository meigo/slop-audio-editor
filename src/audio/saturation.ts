/** Waveshaping curve for the master bus, and the mapping from a 0..1 control to its hardness. */

/** Curve resolution. Finer than 16-bit quantisation, so the shape is never the limiting factor.
 *  ODD on purpose: an even count has no sample at x = 0, so silence maps to an interpolated value
 *  rather than an exact zero. */
export const SATURATION_CURVE_POINTS = 2049;

/**
 * Hardness at full drive, chosen by what it does to LEVEL rather than by the shape of the curve.
 *
 * Peak reduction at full scale, measured: k=1 is -2.37 dB, k=2 is -6.34, k=4 is -12.05, k=8 is
 * -18.06. The first attempt used 8 because `tanh` stops changing shape much above it — but that
 * made a moderate drive of 0.6 take 12.7 dB off a hot mix, which is heavy limiting wearing a
 * saturation label. 2 puts the whole control between untouched and about 6 dB of peak bending,
 * which is the range the effect is actually for.
 */
export const SATURATION_MAX_K = 2;

/**
 * `tanh` waveshaping, normalised so the SLOPE AT ZERO is 1.
 *
 * The normalisation is the whole design. `tanh(k*x)` on its own has a slope of `k` near zero, so
 * turning saturation up would multiply quiet material by `k` — a volume control wearing a
 * different name, which is exactly the failure Glue's trim exists to prevent (see the compressor
 * makeup-gain gotcha). Dividing by `k` leaves small signals untouched and bends only the peaks,
 * which is what saturation is supposed to do.
 *
 * The consequence, deliberately: the output PEAK falls as drive rises. That is the effect, not a
 * bug — the mix keeps its body and loses its spikes.
 *
 * `amount` is 0..1; 0 returns null, because a linear curve is not the same as no node and the
 * caller should build nothing at all.
 */
export function saturationCurve(
  amount: number,
  points: number = SATURATION_CURVE_POINTS,
): Float32Array<ArrayBuffer> | null {
  const a = Math.max(0, Math.min(1, amount));
  if (a === 0) return null;
  const k = a * SATURATION_MAX_K;
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / k;
  }
  return curve;
}
