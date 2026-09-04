/** Pure computation of per-clip gains for automatic loudness matching. No DOM, no Web Audio. */

export interface LoudnessEntry {
  clipId: string;
  lufs: number;
}

/** A correction is never allowed to swing a clip by more than this many dB in either direction —
 *  a clip that is wildly quieter or louder than the rest gets pulled toward the target only this
 *  far, rather than amplified into a noise floor or slammed down to near-silence. */
export const MAX_MATCH_DB = 12;

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * The gain (linear) each clip needs to sit at the median loudness of the group, clamped to
 * ±MAX_MATCH_DB. Entries whose `lufs` is not finite (silence, or a clip that was never measured)
 * are skipped entirely — never boosted — and are absent from the result.
 */
export function matchLoudnessGains(
  entries: readonly LoudnessEntry[],
): { clipId: string; gain: number }[] {
  const finite = entries.filter((e) => Number.isFinite(e.lufs));
  if (finite.length === 0) return [];

  const target = median(finite.map((e) => e.lufs));

  return finite.map((e) => {
    const correctionDb = Math.max(-MAX_MATCH_DB, Math.min(MAX_MATCH_DB, target - e.lufs));
    return { clipId: e.clipId, gain: dbToGain(correctionDb) };
  });
}
