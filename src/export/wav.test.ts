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
  it("interleaves channels", () => {
    const l = new Float32Array([1, 0]);
    const r = new Float32Array([-1, 0]);
    const v = new DataView(encodeWav([l, r], 48000, 16));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });

  it("clips out-of-range samples instead of wrapping", () => {
    const v = new DataView(encodeWav([new Float32Array([2, -2])], 48000, 16));
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
