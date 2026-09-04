import { FORMAT_MIME, type ExportFormat } from "./formats";
import { encodeWav } from "./wav";

const EXPORT_BITRATE = 192_000;

type MediabunnyFormat = Exclude<ExportFormat, "wav16" | "wav32">;

const CODECS: Record<MediabunnyFormat, "mp3" | "aac" | "opus"> = {
  mp3: "mp3",
  m4a: "aac",
  webm: "opus",
};

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
  return out;
}

/** mediabunny is ~megabytes and is needed ONLY when the user exports. Loading it lazily keeps it
 *  out of the initial bundle, so opening the editor stays fast and the cost is paid when the
 *  export dialog is first opened instead. Memoised so the module and the MP3 encoder registration
 *  happen exactly once. */
let mediabunnyPromise: Promise<typeof import("mediabunny")> | null = null;

function loadMediabunny(): Promise<typeof import("mediabunny")> {
  mediabunnyPromise ??= (async () => {
    const [mb, mp3] = await Promise.all([
      import("mediabunny"),
      import("@mediabunny/mp3-encoder"),
    ]);
    // WebCodecs ships no MP3 encoder; this extension supplies one. Idempotent, and now paid for
    // only by users who export.
    mp3.registerMp3Encoder();
    return mb;
  })();
  return mediabunnyPromise;
}

function formatFor(
  mb: Awaited<ReturnType<typeof loadMediabunny>>,
  format: MediabunnyFormat,
): InstanceType<typeof mb.Mp3OutputFormat | typeof mb.Mp4OutputFormat | typeof mb.WebMOutputFormat> {
  switch (format) {
    case "mp3": return new mb.Mp3OutputFormat();
    case "m4a": return new mb.Mp4OutputFormat();
    case "webm": return new mb.WebMOutputFormat();
  }
}

/** Only offer what this browser can actually produce — a format that is listed and then fails is
 *  worse than one that was never listed. The two WAV entries are always present: they use the
 *  in-repo encoder and need no codec support at all. */
export async function availableFormats(): Promise<ExportFormat[]> {
  const formats: ExportFormat[] = ["wav16", "wav32"];
  const mb = await loadMediabunny();
  for (const key of ["mp3", "m4a", "webm"] as MediabunnyFormat[]) {
    if (await mb.canEncodeAudio(CODECS[key], { numberOfChannels: 2, sampleRate: 48000 })) {
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

  const mb = await loadMediabunny();
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: formatFor(mb, format), target });
  const source = new mb.AudioBufferSource({ codec: CODECS[format], bitrate: EXPORT_BITRATE });
  output.addAudioTrack(source);
  await output.start();
  await source.add(buffer);
  source.close();
  await output.finalize();

  const bytes = target.buffer;
  if (!bytes) throw new Error(`${format} export produced no data`);
  return new Blob([bytes], { type: FORMAT_MIME[format] });
}
