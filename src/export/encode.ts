import {
  AudioBufferSource, BufferTarget, canEncodeAudio, Mp3OutputFormat, Mp4OutputFormat, Output,
  WebMOutputFormat,
} from "mediabunny";
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import { FORMAT_MIME, type ExportFormat } from "./formats";
import { encodeWav } from "./wav";

// WebCodecs has no MP3 encoder; mediabunny's official extension package supplies one. Registering
// at module load is idempotent and costs nothing when MP3 is never exported.
registerMp3Encoder();

const EXPORT_BITRATE = 192_000;

type MediabunnyFormat = Exclude<ExportFormat, "wav16" | "wav32">;

const CONTAINERS: Record<MediabunnyFormat, { format: () => Mp3OutputFormat | Mp4OutputFormat | WebMOutputFormat; codec: "mp3" | "aac" | "opus" }> = {
  mp3: { format: () => new Mp3OutputFormat(), codec: "mp3" },
  m4a: { format: () => new Mp4OutputFormat(), codec: "aac" },
  webm: { format: () => new WebMOutputFormat(), codec: "opus" },
};

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
  return out;
}

/** Only offer what this browser can actually produce — a format that is listed and then fails is
 *  worse than one that was never listed. The two WAV entries are always present: they use the
 *  in-repo encoder and need no codec support at all. */
export async function availableFormats(): Promise<ExportFormat[]> {
  const formats: ExportFormat[] = ["wav16", "wav32"];
  for (const key of ["mp3", "m4a", "webm"] as MediabunnyFormat[]) {
    if (await canEncodeAudio(CONTAINERS[key].codec, { numberOfChannels: 2, sampleRate: 48000 })) {
      formats.push(key);
    }
  }
  return formats;
}

export async function encodeBuffer(buffer: AudioBuffer, format: ExportFormat): Promise<Blob> {
  if (format === "wav16" || format === "wav32") {
    const bits = format === "wav16" ? 16 : 32;
    return new Blob([encodeWav(channelsOf(buffer), buffer.sampleRate, bits)], {
      type: FORMAT_MIME[format],
    });
  }

  const spec = CONTAINERS[format];
  const output = new Output({ format: spec.format(), target: new BufferTarget() });
  const source = new AudioBufferSource({ codec: spec.codec, bitrate: EXPORT_BITRATE });
  output.addAudioTrack(source);
  await output.start();
  await source.add(buffer);
  source.close();
  await output.finalize();

  const bytes = (output.target as BufferTarget).buffer;
  if (!bytes) throw new Error(`${format} export produced no data`);
  return new Blob([bytes], { type: FORMAT_MIME[format] });
}
