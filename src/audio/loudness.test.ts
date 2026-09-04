import { describe, expect, it } from "vitest";
import { integratedLoudness } from "./loudness";

const SAMPLE_RATE = 48000;

/** A pure sine tone at the given amplitude (peak), used for BS.1770 calibration checks. */
function sine(freqHz: number, amplitude: number, seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  return out;
}

describe("integratedLoudness", () => {
  it("measures a 997 Hz tone at -20 dBFS RMS as -20 LUFS (the standard calibration point)", () => {
    // amplitude = 0.1 * sqrt(2) => RMS = 0.1 => 20*log10(0.1) = -20 dBFS RMS.
    const tone = sine(997, 0.1 * Math.sqrt(2), 4);
    expect(integratedLoudness([tone], SAMPLE_RATE)).toBeCloseTo(-20, 1);
  });

  it("raises the result by +6.02 dB when the amplitude doubles", () => {
    const base = integratedLoudness([sine(997, 0.1 * Math.sqrt(2), 4)], SAMPLE_RATE);
    const doubled = integratedLoudness([sine(997, 0.2 * Math.sqrt(2), 4)], SAMPLE_RATE);
    expect(doubled - base).toBeCloseTo(6.02, 1);
  });

  it("returns -Infinity for digital silence", () => {
    const silence = new Float32Array(4 * SAMPLE_RATE);
    expect(integratedLoudness([silence], SAMPLE_RATE)).toBe(-Infinity);
  });

  it("returns -Infinity rather than throwing when input is shorter than one 400 ms block", () => {
    const short = sine(997, 0.5, 0.1); // 100 ms, well under the 400 ms block size
    expect(integratedLoudness([short], SAMPLE_RATE)).toBe(-Infinity);
  });

  it("PINNED BS.1770 behavior — sums per-channel power rather than averaging: identical-channel stereo reads 10*log10(2) louder than mono. This gap is real and intentional AT THIS LAYER; pool.ts's computeLoudnessChunked corrects for it one layer up (see its dual-mono upmix), it must not be papered over here", () => {
    // BS.1770 weights L and R at G=1.0 each and SUMS the weighted power across channels, so a
    // stereo signal with the same content in both channels is genuinely louder (not just as loud)
    // as a single mono channel of that content — this is a deliberate, well-documented property of
    // the standard, not an artifact. An implementation that mistakenly averages channels instead of
    // summing them would report the stereo case as equal to the mono case; this test catches that.
    //
    // `integratedLoudness` stays a FAITHFUL, uncorrected BS.1770 meter — that's what its -20 LUFS
    // compliance test above proves. Web Audio's own mono->stereo upmix (duplication, not
    // attenuation) is a playback-context fact this module has no business knowing about; the
    // correction for it lives at the call site that does know, `computeLoudnessChunked` in
    // `pool.ts` (see its "matches its own dual-mono upmix" test). Moving the correction in here
    // would make THIS test wrongly expect equality and would break the -20 LUFS compliance test's
    // claim to be a faithful implementation of the standard.
    const ch = sine(997, 0.1 * Math.sqrt(2), 4);
    const mono = integratedLoudness([ch], SAMPLE_RATE);
    const stereo = integratedLoudness([ch, ch], SAMPLE_RATE);
    expect(stereo - mono).toBeCloseTo(10 * Math.log10(2), 1);
  });

  it("returns -Infinity for an empty channel list", () => {
    expect(integratedLoudness([], SAMPLE_RATE)).toBe(-Infinity);
  });
});
