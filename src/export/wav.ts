/** Minimal WAV writer. No dependencies, works in every browser — the guaranteed export path when
 *  WebCodecs has no encoder for what the user asked for. */

function writeAscii(v: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
}

export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: 16 | 32,
): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);

  writeAscii(v, 0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(v, 8, "WAVE");
  writeAscii(v, 12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitDepth, true);
  writeAscii(v, 36, "data");
  v.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const raw = channels[c]?.[i] ?? 0;
      if (bitDepth === 32) {
        v.setFloat32(offset, raw, true);
      } else {
        const s = Math.max(-1, Math.min(1, raw));
        v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      offset += bytesPerSample;
    }
  }
  return buf;
}
