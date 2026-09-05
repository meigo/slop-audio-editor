/** Integrated loudness per ITU-R BS.1770 (the algorithm behind LUFS meters). Pure and
 *  synchronous — no Web Audio, no DOM. `integratedLoudness` below does the whole thing in one
 *  call; `createKWeightFilter`, `weightedBlockPower` and `gatedLoudnessFromBlockPowers` are the
 *  same math broken into pieces a caller can spread across chunks (see `computeLoudnessChunked`
 *  in `pool.ts`), so a long import does not block the UI, the way `computePeaksChunked` does for
 *  peaks. */

export const BLOCK_S = 0.4;
export const HOP_S = 0.1; // 400 ms blocks, 75% overlap
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET_LU = 10;

/** K-weighting biquad coefficients for PROJECT_SAMPLE_RATE (48 kHz) only — they are frequency
 *  ratios baked in at design time, not portable to other sample rates. Direct-form transposed II,
 *  applied in series (stage 1 then stage 2), state reset per channel. */
const STAGE1_B = [1.53512485958697, -2.69169618940638, 1.19839281085285];
const STAGE1_A = [1.0, -1.69065929318241, 0.73248077421585];
const STAGE2_B = [1.0, -2.0, 1.0];
const STAGE2_A = [1.0, -1.99004745483398, 0.99007225036621];

/** One biquad's filter memory, mutated in place across calls so a filter can be fed a signal in
 *  pieces and produce exactly the same output as feeding it the whole signal at once. */
type BiquadState = [number, number];

function biquadChunk(
  x: Float32Array,
  b: readonly number[],
  a: readonly number[],
  z: BiquadState,
): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b[0] * xi + z[0];
    z[0] = b[1] * xi + z[1] - a[1] * y;
    z[1] = b[2] * xi - a[2] * y;
    out[i] = y;
  }
  return out;
}

/** A streaming K-weight filter for ONE channel: feed it consecutive chunks of that channel via
 *  `process`, in order, and the concatenated output equals K-weighting the whole channel at once.
 *  Each channel needs its own instance — filter state must never cross channels. */
export function createKWeightFilter(): { process(chunk: Float32Array): Float32Array } {
  const stage1: BiquadState = [0, 0];
  const stage2: BiquadState = [0, 0];
  return {
    process(chunk: Float32Array): Float32Array {
      return biquadChunk(
        biquadChunk(chunk, STAGE1_B, STAGE1_A, stage1),
        STAGE2_B,
        STAGE2_A,
        stage2,
      );
    },
  };
}

function kWeight(x: Float32Array): Float32Array {
  return createKWeightFilter().process(x);
}

/** -0.691 + 10*log10(power), or -Infinity for zero (silent) power. */
function loudnessFromPower(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

/** Sum (not average — see the module-level note on `integratedLoudness`) of per-channel mean
 *  square over `[start, end)` of already K-weighted channels. One "block" of BS.1770. */
export function weightedBlockPower(
  weightedChannels: readonly Float32Array[],
  start: number,
  end: number,
): number {
  let power = 0;
  for (const ch of weightedChannels) {
    let sumSq = 0;
    for (let s = start; s < end; s++) sumSq += ch[s] * ch[s];
    power += sumSq / (end - start); // G_c = 1.0 for mono/stereo
  }
  return power;
}

/** The BS.1770 two-stage gate (absolute -70 LUFS, then relative -10 LU below the surviving mean)
 *  applied to a full set of per-block powers, producing the final integrated loudness. */
export function gatedLoudnessFromBlockPowers(blockPowers: readonly number[]): number {
  const absoluteSurvivors = blockPowers.filter((p) => loudnessFromPower(p) >= ABSOLUTE_GATE_LUFS);
  if (absoluteSurvivors.length === 0) return -Infinity;

  const meanPower = absoluteSurvivors.reduce((a, b) => a + b, 0) / absoluteSurvivors.length;
  const relativeThreshold = loudnessFromPower(meanPower) - RELATIVE_GATE_OFFSET_LU;

  const relativeSurvivors = absoluteSurvivors.filter(
    (p) => loudnessFromPower(p) >= relativeThreshold,
  );
  if (relativeSurvivors.length === 0) return -Infinity;

  const finalMeanPower = relativeSurvivors.reduce((a, b) => a + b, 0) / relativeSurvivors.length;
  return loudnessFromPower(finalMeanPower);
}

/**
 * ITU-R BS.1770 integrated (gated) loudness, in LUFS, computed in one synchronous call.
 *
 * G_c = 1.0 for every channel here (mono and stereo only), so "weighted power" is a plain sum of
 * per-channel mean square, not an average — a stereo signal with identical L/R content is
 * genuinely louder than the mono equivalent by 10*log10(2), which is a property of the standard,
 * not a bug.
 */
export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  if (channels.length === 0) return -Infinity;

  const n = channels[0].length;
  const blockSize = Math.round(BLOCK_S * sampleRate);
  const hop = Math.round(HOP_S * sampleRate);
  if (n < blockSize) return -Infinity;

  const weighted = channels.map(kWeight);
  const numBlocks = Math.floor((n - blockSize) / hop) + 1;

  const blockPowers: number[] = [];
  for (let i = 0; i < numBlocks; i++) {
    const start = i * hop;
    blockPowers.push(weightedBlockPower(weighted, start, start + blockSize));
  }

  return gatedLoudnessFromBlockPowers(blockPowers);
}
