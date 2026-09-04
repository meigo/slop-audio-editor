import { projectDurationS, type Project } from "../doc/document";
import type { Selection } from "../doc/selection";

export type ExportFormat = "wav16" | "wav32" | "mp3" | "m4a" | "webm";

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  wav16: "WAV — 16-bit",
  wav32: "WAV — 32-bit float",
  mp3: "MP3 — 192 kbps",
  m4a: "M4A — AAC",
  webm: "WebM — Opus",
};

export const FORMAT_EXT: Record<ExportFormat, string> = {
  wav16: "wav", wav32: "wav", mp3: "mp3", m4a: "m4a", webm: "webm",
};

export const FORMAT_MIME: Record<ExportFormat, string> = {
  wav16: "audio/wav", wav32: "audio/wav",
  mp3: "audio/mpeg", m4a: "audio/mp4", webm: "audio/webm",
};

/** The export range: the time-range selection if there is one, otherwise the whole project.
 *  A CLIP selection is not a time range and does not narrow the export. */
export function exportWindow(p: Project, selection: Selection): { fromS: number; toS: number } {
  if (selection.kind === "range") {
    return { fromS: selection.range.fromS, toS: selection.range.toS };
  }
  return { fromS: 0, toS: projectDurationS(p) };
}

export function exportFilename(projectName: string, ext: string): string {
  const cleaned = projectName.replace(/[/\\:*?"<>|]/g, "-").trim();
  return `${cleaned || "Untitled"}.${ext}`;
}
