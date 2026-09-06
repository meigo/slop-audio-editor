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
  wav16: "wav",
  wav32: "wav",
  mp3: "mp3",
  m4a: "m4a",
  webm: "webm",
};

export const FORMAT_MIME: Record<ExportFormat, string> = {
  wav16: "audio/wav",
  wav32: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  webm: "audio/webm",
};

/** The export range: the time-range selection if there is one, otherwise the whole project.
 *  A CLIP selection is not a time range and does not narrow the export.
 *
 *  A range naming no track that still exists is treated as no range at all. The selection is
 *  session state and outlives the document it was drawn on (`resetSessionState` clears it on
 *  Open and New, and this is the belt to that pair of braces): one carried over from another
 *  project would narrow this export to a window the user cannot even see, since `RangeOverlay`
 *  matches the same dead ids and draws nothing. Resolving id-keyed session state at the point of
 *  USE is the rule `activeSoloed` already follows. */
export function exportWindow(p: Project, selection: Selection): { fromS: number; toS: number } {
  if (selection.kind === "range" && selection.range.trackIds.some((id) => hasTrack(p, id))) {
    return { fromS: selection.range.fromS, toS: selection.range.toS };
  }
  return { fromS: 0, toS: projectDurationS(p) };
}

function hasTrack(p: Project, trackId: string): boolean {
  return p.tracks.some((t) => t.id === trackId);
}

export function exportFilename(projectName: string, ext: string): string {
  const cleaned = projectName.replace(/[/\\:*?"<>|]/g, "-").trim();
  return `${cleaned || "Untitled"}.${ext}`;
}
