import { NORMALISE_CEILING_DBFS } from "./normalise";

/** How far ahead the gain starts coming down. Also the attack: the reduction ramps in over
 *  exactly this long, so it is fully applied on the peak's first sample rather than catching up
 *  after it. Offline rendering makes this free — a real-time limiter would need a delay line of
 *  the same length, and would pay its latency. */
export const LIMITER_LOOKAHEAD_S = 0.002;

/** Slow enough not to pump on speech. Asymmetric with the attack on purpose, the same reason
 *  ducking's ramps are asymmetric: symmetric gain movement sounds mechanical. */
export const LIMITER_RELEASE_S = 0.1;

export interface LimitResult {
  /** Deepest reduction applied anywhere, in dB. 0 means the limiter did nothing at all. A dB or
   *  two is transparent; 8 dB is audible squashing, which is why the export dialog shows it
   *  rather than just handing over a file. */
  maxReductionDb: number;
}

/**
 * Brick-wall peak limiter over a finished mixdown, applied IN PLACE.
 *
 * Not a `DynamicsCompressorNode`: that has a knee, a soft ratio and spec-defined internal makeup
 * gain, and no lookahead, so it cannot guarantee a ceiling — the same trap that made Glue's trim
 * necessary. This runs offline on a buffer we already hold, so it can simply read ahead.
 *
 * The ceiling is guaranteed by construction rather than by hoping the smoothing behaves:
 *   `req[i]`    the gain sample `i` needs on its own.
 *   `winMin[i]` the minimum of `req` over `[i, i+L]` — so a coming peak pulls the gain down early.
 *   `gain[i]`   a trailing average of `winMin` over `L`, which ramps instead of stepping.
 * Every term of that trailing average is a `winMin` whose own window contains `i`, so every term
 * is `<= req[i]`, and therefore so is their mean. The release only ever moves the gain UP toward
 * that envelope and never past it, so it cannot break the bound either.
 */
export function limitPeaks(
  channels: readonly Float32Array[],
  sampleRate: number,
  ceilingDbfs: number = NORMALISE_CEILING_DBFS,
): LimitResult {
  const n = channels[0]?.length ?? 0;
  if (n === 0 || channels.length === 0) return { maxReductionDb: 0 };

  const ceiling = 10 ** (ceilingDbfs / 20);
  const lookahead = Math.max(1, Math.round(LIMITER_LOOKAHEAD_S * sampleRate));

  // One envelope from the loudest channel at each instant, applied to all of them. Per-channel
  // gain would duck only the side that peaked and swing the stereo image with the transients.
  const req = new Float32Array(n);
  let anyReduction = false;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of channels) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    if (peak > ceiling) {
      req[i] = ceiling / peak;
      anyReduction = true;
    } else {
      req[i] = 1;
    }
  }
  // Nothing to do — and "nothing" must mean bit-exact, not a multiply by 0.99999.
  if (!anyReduction) return { maxReductionDb: 0 };

  // Sliding minimum over [i, i+lookahead], via a monotonic deque so the cost is O(n) rather than
  // O(n·lookahead).
  const winMin = new Float32Array(n);
  const deque = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && req[deque[tail - 1]] >= req[i]) tail--;
    deque[tail++] = i;
    while (deque[head] > i + lookahead) head++;
    winMin[i] = req[deque[head]];
  }

  // Trailing average of the window minima: the gain slides down over `lookahead` samples instead
  // of stepping, and a step in gain is itself a click.
  const gain = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += winMin[i];
    if (i >= lookahead) sum -= winMin[i - lookahead];
    gain[i] = sum / Math.min(i + 1, lookahead);
  }

  // Release: recover toward the envelope, never faster than it, and never above it.
  const releaseCoef = Math.exp(-1 / (LIMITER_RELEASE_S * sampleRate));
  let g = 1;
  let deepest = 1;
  for (let i = 0; i < n; i++) {
    const target = gain[i];
    // The release branch cannot overshoot: `target >= g` there, so `target + (g - target) * coef`
    // lands at or below `target`, and the envelope's bound carries through untouched.
    g = target < g ? target : target + (g - target) * releaseCoef;
    gain[i] = g;
    if (g < deepest) deepest = g;
  }

  for (const ch of channels) {
    for (let i = 0; i < n; i++) ch[i] *= gain[i];
  }
  return { maxReductionDb: -20 * Math.log10(deepest) };
}

/** `limitPeaks` over a rendered buffer, in place. `getChannelData` hands back a live view, so
 *  writing through it writes the buffer — the same way `applyGain` works in `normalise.ts`. The
 *  Float32Array core stays separate so it is testable without a Web Audio context. */
export function limitBuffer(buffer: AudioBuffer, ceilingDbfs?: number): LimitResult {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return limitPeaks(channels, buffer.sampleRate, ceilingDbfs);
}
