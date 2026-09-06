/** Minimal WAV writer. No dependencies, works in every browser — the guaranteed export path when
 *  WebCodecs has no encoder for what the user asked for. */

function writeAscii(v: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
}

/** Is every sample exactly zero? A wholly silent export is left bit-exact rather than filled with
 *  dither noise — the theory says dither silence too, but a file that should be empty coming back
 *  as hiss is the kind of surprise this app avoids. Checked over the WHOLE buffer, never per
 *  sample: skipping quiet samples individually would reintroduce precisely the correlation
 *  between signal and error that dither exists to remove. */
function isSilent(channels: readonly Float32Array[]): boolean {
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) if (ch[i] !== 0) return false;
  }
  return true;
}

/** Where the samples start in a 32-bit float file: a 44-byte PCM-style header plus the 2-byte
 *  `cbSize` the non-PCM fmt chunk carries and a 12-byte fact chunk. 16-bit stays at 44. */
export const FLOAT_DATA_OFFSET = 58;

export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: 16 | 32,
  /** Injectable so the dither tests can assert exact codes rather than statistics. */
  random: () => number = Math.random,
): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  // IEEE float is a NON-PCM format, and for those the spec wants an 18-byte fmt chunk (a zero
  // `cbSize` after the bit depth) plus a fact chunk carrying the frame count. Most readers shrug
  // at the PCM-style 16-byte header; strict ones refuse the file. PCM keeps the plain 44 bytes.
  const isFloat = bitDepth === 32;
  const fmtSize = isFloat ? 18 : 16;
  const headerBytes = isFloat ? FLOAT_DATA_OFFSET : 44;
  const buf = new ArrayBuffer(headerBytes + dataBytes);
  const v = new DataView(buf);

  writeAscii(v, 0, "RIFF");
  v.setUint32(4, headerBytes - 8 + dataBytes, true);
  writeAscii(v, 8, "WAVE");
  writeAscii(v, 12, "fmt ");
  v.setUint32(16, fmtSize, true);
  v.setUint16(20, isFloat ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitDepth, true);
  let at = 36;
  if (isFloat) {
    v.setUint16(at, 0, true); // cbSize: no extension bytes follow
    at += 2;
    writeAscii(v, at, "fact");
    v.setUint32(at + 4, 4, true);
    v.setUint32(at + 8, frames, true);
    at += 12;
  }
  writeAscii(v, at, "data");
  v.setUint32(at + 4, dataBytes, true);

  // 16 bit is the only path that quantises, so it is the only one that needs dither; adding noise
  // to a float export would be noise for nothing.
  const dither = bitDepth === 16 && !isSilent(channels);

  let offset = headerBytes;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const raw = channels[c]?.[i] ?? 0;
      if (bitDepth === 32) {
        v.setFloat32(offset, raw, true);
      } else {
        const s = Math.max(-1, Math.min(1, raw));
        const scaled = s < 0 ? s * 0x8000 : s * 0x7fff;
        // TPDF: two independent uniforms summed give a TRIANGULAR distribution over ±1 LSB, which
        // decorrelates the quantisation error completely — what was distortion tracking the signal
        // becomes a flat noise floor around -93 dBFS. A single uniform value would not: its error
        // still varies with the signal.
        const dithered = dither ? scaled + (random() + random() - 1) : scaled;
        // ROUND, not truncate. `setInt16` truncates toward zero on its own, which biased every
        // sample toward silence by up to a full LSB and collapsed everything below one LSB to
        // code 0 — a deadband that is the same defect dither exists to fix.
        // The final clamp is not optional: dither on a full-scale sample would otherwise push
        // past 32767 and wrap, turning a peak into a click.
        const q = Math.round(dithered);
        v.setInt16(offset, q < -0x8000 ? -0x8000 : q > 0x7fff ? 0x7fff : q, true);
      }
      offset += bytesPerSample;
    }
  }
  return buf;
}
