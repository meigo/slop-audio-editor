import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";

function ascii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("encodeWav header", () => {
  const buf = encodeWav([new Float32Array(4), new Float32Array(4)], 48000, 16);
  const v = new DataView(buf);

  it("writes RIFF/WAVE/fmt/data chunk ids", () => {
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(ascii(v, 36, 4)).toBe("data");
  });

  it("declares the sample rate, channel count and byte rates", () => {
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(48000); // sample rate
    expect(v.getUint32(28, true)).toBe(48000 * 2 * 2); // byte rate
    expect(v.getUint16(32, true)).toBe(4); // block align
    expect(v.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("declares format 1 (PCM) at 16 bit and 3 (float) at 32 bit", () => {
    expect(v.getUint16(20, true)).toBe(1);
    expect(new DataView(encodeWav([new Float32Array(4)], 48000, 32)).getUint16(20, true)).toBe(3);
  });

  it("sizes the RIFF and data chunks to the payload", () => {
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2); // 4 frames, 2ch, 2 bytes
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  });
});

describe("encodeWav samples", () => {
  // These two are about interleaving and clipping, not noise, and 16-bit output is now dithered:
  // two randoms at 0.5 sum to a triangular value of exactly 0, which removes dither from the
  // picture and keeps the assertions exact. With real `Math.random` they would pass only most of
  // the time, since dither legitimately moves a full-scale sample by up to an LSB.
  const noDither = () => 0.5;

  it("interleaves channels", () => {
    const l = new Float32Array([1, 0]);
    const r = new Float32Array([-1, 0]);
    const v = new DataView(encodeWav([l, r], 48000, 16, noDither));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });

  it("clips out-of-range samples instead of wrapping", () => {
    const v = new DataView(encodeWav([new Float32Array([2, -2])], 48000, 16, noDither));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });

  it("round-trips float samples exactly at 32 bit", () => {
    const v = new DataView(encodeWav([new Float32Array([0.25, -0.5])], 48000, 32));
    expect(v.getFloat32(44, true)).toBe(0.25);
    expect(v.getFloat32(48, true)).toBe(-0.5);
  });

  it("handles mono and an empty buffer", () => {
    expect(new DataView(encodeWav([new Float32Array(0)], 48000, 16)).getUint32(40, true)).toBe(0);
    expect(encodeWav([new Float32Array([0.5])], 48000, 16).byteLength).toBe(46);
  });
});

/** A deterministic stand-in for `Math.random`, so the dither tests assert exact codes instead of
 *  statistics with loose bounds — a suite that fails one run in fifty is worse than no test. */
function fixedRandom(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("16-bit dither", () => {
  const LSB_POS = 1 / 0x7fff;

  // Two 0.5s sum to a triangular value of exactly 0 — the RNG that adds nothing, so this isolates
  // rounding from dither.
  const noDither = () => fixedRandom(0.5);

  it("rounds to the nearest code instead of truncating toward zero", () => {
    // 0.6 LSB. Truncation collapses this to 0; rounding keeps it as code 1, which is the whole
    // difference between a deadband around silence and a usable quiet passage.
    const v = new DataView(encodeWav([new Float32Array([0.6 * LSB_POS])], 48000, 16, noDither()));
    expect(v.getInt16(44, true)).toBe(1);
  });

  it("dithers a level that would otherwise sit on one code forever", () => {
    // A third of an LSB: without dither every sample quantises to 0 and the passage is silent.
    const input = new Float32Array(64).fill(0.34 * LSB_POS);
    // Alternating extremes: triangular values of exactly -1 and +1 LSB, so 0.34 lands on -0.66
    // and 1.34 and the codes straddle the input rather than collapsing onto one.
    const v = new DataView(encodeWav([input], 48000, 16, fixedRandom(0, 0, 1, 1)));
    const codes = new Set<number>();
    for (let i = 0; i < 64; i++) codes.add(v.getInt16(44 + i * 2, true));
    expect([...codes].sort((a, b) => a - b)).toEqual([-1, 1]);
  });

  it("stays within one LSB — the noise it adds is bounded", () => {
    const input = new Float32Array(32).fill(0.5);
    const undithered = 0.5 * 0x7fff;
    const v = new DataView(encodeWav([input], 48000, 16, fixedRandom(0, 1, 1, 0, 0.25, 0.75)));
    for (let i = 0; i < 32; i++) {
      expect(Math.abs(v.getInt16(44 + i * 2, true) - undithered)).toBeLessThanOrEqual(1);
    }
  });

  it("still clamps at full scale, so dither cannot wrap a peak into a click", () => {
    // The clamp only matters in the direction that overflows, so each end needs the RNG that
    // pushes it OUTWARD: both randoms at 1 add a whole LSB, both at 0 subtract one. (Dither
    // moving a full-scale sample the other way, to ±32767, is correct and not clamped.)
    const top = new DataView(encodeWav([new Float32Array([1])], 48000, 16, fixedRandom(1)));
    expect(top.getInt16(44, true)).toBe(32767);

    const bottom = new DataView(encodeWav([new Float32Array([-1])], 48000, 16, fixedRandom(0)));
    expect(bottom.getInt16(44, true)).toBe(-32768);
  });

  it("leaves digital silence exactly silent", () => {
    // The RNG must produce a NON-ZERO offset, or the test passes whether or not silence is
    // guarded: both randoms at 1 is +1 LSB, so an unguarded encode writes code 1 everywhere.
    const v = new DataView(encodeWav([new Float32Array(16)], 48000, 16, fixedRandom(1)));
    for (let i = 0; i < 16; i++) expect(v.getInt16(44 + i * 2, true)).toBe(0);
  });

  it("does not dither 32-bit float — there is no quantisation to decorrelate", () => {
    const input = new Float32Array([0.25, -0.5]);
    const a = new Uint8Array(encodeWav([input], 48000, 32, fixedRandom(0, 1)));
    const b = new Uint8Array(encodeWav([input], 48000, 32, fixedRandom(1, 0)));
    expect([...a]).toEqual([...b]);
  });
});
