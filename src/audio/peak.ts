/** Sample-peak metering.
 *
 *  Sample peak, NOT true (inter-sample) peak: it reads the samples as they are, without
 *  oversampling to find peaks that fall between them. A reconstructed analogue waveform can
 *  overshoot the highest sample by a few tenths of a dB, so a file measuring exactly 0.0 dBFS
 *  here may still clip a downstream converter. Oversampling for that last fraction of a dB is
 *  not worth the machinery in this app — but do not relabel this "true peak". */

/** Highest absolute sample across every channel. Values above 1.0 are returned as-is: the graph
 *  runs in float and genuinely can exceed full scale, and the amount of the over is the useful
 *  part. Clamping here would report every clipping mix as an unremarkable 0.0 dBFS. */
export function peakAmplitude(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** Amplitude (1.0 = full scale) as dBFS. Digital silence is -Infinity, not a large negative
 *  number — callers format it, and a sentinel like -100 would print as a real measurement. */
export function amplitudeToDbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}
