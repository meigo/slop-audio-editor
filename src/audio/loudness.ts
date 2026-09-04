/** Integrated loudness per ITU-R BS.1770 (the algorithm behind LUFS meters). Pure and
 *  synchronous — no Web Audio, no DOM. Callers doing this on a whole imported file should chunk
 *  the work themselves, the way `computePeaksChunked` does for peaks. */

const BLOCK_S = 0.4;
const HOP_S = 0.1; // 400 ms blocks, 75% overlap
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET_LU = 10;

/** K-weighting biquad coefficients for PROJECT_SAMPLE_RATE (48 kHz) only — they are frequency
 *  ratios baked in at design time, not portable to other sample rates. Direct-form transposed II,
 *  applied in series (stage 1 then stage 2), state reset per channel. */
const STAGE1_B = [1.53512485958697, -2.69169618940638, 1.19839281085285];
const STAGE1_A = [1.0, -1.69065929318241, 0.73248077421585];
const STAGE2_B = [1.0, -2.0, 1.0];
const STAGE2_A = [1.0, -1.99004745483398, 0.99007225036621];

function biquad(x: Float32Array, b: readonly number[], a: readonly number[]): Float32Array {
  const out = new Float32Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b[0] * xi + z1;
    z1 = b[1] * xi + z2 - a[1] * y;
    z2 = b[2] * xi - a[2] * y;
    out[i] = y;
  }
  return out;
}

function kWeight(x: Float32Array): Float32Array {
  return biquad(biquad(x, STAGE1_B, STAGE1_A), STAGE2_B, STAGE2_A);
}

/** -0.691 + 10*log10(power), or -Infinity for zero (silent) power. */
function loudnessFromPower(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

/**
 * ITU-R BS.1770 integrated (gated) loudness, in LUFS.
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
    const end = start + blockSize;
    let power = 0;
    for (const ch of weighted) {
      let sumSq = 0;
      for (let s = start; s < end; s++) sumSq += ch[s] * ch[s];
      power += sumSq / blockSize; // G_c = 1.0 for mono/stereo
    }
    blockPowers.push(power);
  }

  const absoluteSurvivors = blockPowers.filter((p) => loudnessFromPower(p) >= ABSOLUTE_GATE_LUFS);
  if (absoluteSurvivors.length === 0) return -Infinity;

  const meanPower = absoluteSurvivors.reduce((a, b) => a + b, 0) / absoluteSurvivors.length;
  const relativeThreshold = loudnessFromPower(meanPower) - RELATIVE_GATE_OFFSET_LU;

  const relativeSurvivors = absoluteSurvivors.filter((p) => loudnessFromPower(p) >= relativeThreshold);
  if (relativeSurvivors.length === 0) return -Infinity;

  const finalMeanPower = relativeSurvivors.reduce((a, b) => a + b, 0) / relativeSurvivors.length;
  return loudnessFromPower(finalMeanPower);
}
