/** Waveshaping curve for the master bus, and the mapping from a 0..1 control to its hardness. */

/** Curve resolution. Finer than 16-bit quantisation, so the shape is never the limiting factor.
 *  ODD on purpose: an even count has no sample at x = 0, so silence maps to an interpolated value
 *  rather than an exact zero. */
export const SATURATION_CURVE_POINTS = 2049;

/**
 * Hardness at full drive.
 *
 * Chosen by what it does to a REALISTIC signal, which took two attempts. 8 was picked first
 * because `tanh` stops changing shape above it — true and irrelevant. 2 was the over-correction:
 * it kept hot material safe but made the whole control inaudible, because slope-at-zero
 * normalisation only bends material approaching full scale, and a mix peaking around -10 dBFS
 * never reaches that part of the curve. At an input of 0.3 the entire range moved the level
 * 0.72 dB and produced about -31 dB of third harmonic — technically present, practically nothing.
 *
 * 6 puts the bend within reach of normal levels. What makes that usable rather than a level drop
 * is `saturationMakeup` below.
 */
export const SATURATION_MAX_K = 6;

/** The level the makeup gain is calibrated for: a sine at -10 dBFS, which is about where a mixed
 *  programme sits. Saturation is level-dependent by nature, so a makeup that holds for every
 *  signal does not exist — this picks the level the control will actually be used at. */
export const SATURATION_REFERENCE_AMPLITUDE = 0.316;

/**
 * Gain that cancels the level a given hardness removes, so DRIVE CHANGES TIMBRE RATHER THAN
 * LOUDNESS.
 *
 * Without this, turning drive up just sounds quieter, which is indistinguishable from "the
 * control does nothing" — the reason the first version of this feature was inaudible. Computed by
 * shaping a reference sine and comparing RMS, so it follows the curve rather than being a table of
 * magic numbers that would drift if the curve ever changed.
 *
 * Two measured consequences, neither of them a surprise once stated. Because the makeup is fixed
 * at one level, drive acts as a gentle LEVELLER around it: at full drive a -20 dBFS sine comes out
 * +3.9 dB, the reference level comes out unchanged, and a -3 dBFS sine comes out -5.6 dB. That is
 * tape-like and wanted. And the shaped curve tops out well below full scale — 0.28 at full drive —
 * so hard drive puts a ceiling near -11 dBFS on the master. It cannot clip; it can make a loud mix
 * quieter, which the export's loudness normalisation then puts back.
 */
export function saturationMakeup(k: number, samples = 4096): number {
  if (k <= 0) return 1;
  const a = SATURATION_REFERENCE_AMPLITUDE;
  let shaped = 0;
  for (let i = 0; i < samples; i++) {
    const x = a * Math.sin((2 * Math.PI * i) / samples);
    const y = Math.tanh(k * x) / k;
    shaped += y * y;
  }
  const shapedRms = Math.sqrt(shaped / samples);
  const dryRms = a / Math.SQRT2;
  return shapedRms > 0 ? dryRms / shapedRms : 1;
}

/**
 * `tanh` waveshaping, normalised so the SLOPE AT ZERO is 1.
 *
 * The normalisation is the whole design. `tanh(k*x)` on its own has a slope of `k` near zero, so
 * turning saturation up would multiply quiet material by `k` — a volume control wearing a
 * different name, which is exactly the failure Glue's trim exists to prevent (see the compressor
 * makeup-gain gotcha). Dividing by `k` leaves small signals untouched and bends only the peaks,
 * which is what saturation is supposed to do.
 *
 * On top of that sits `saturationMakeup`, which restores the level the shaping removes at a
 * reference programme level. Without it, drive is heard as "everything got quieter" rather than
 * as a change of colour.
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
  const makeup = saturationMakeup(k);
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = (Math.tanh(k * x) / k) * makeup;
  }
  return curve;
}
