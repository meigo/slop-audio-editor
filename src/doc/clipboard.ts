import { newId, type Clip, type Project } from "./document";
import { addClip, deleteClips } from "./edits";

export interface ClipboardEntry {
  /** `startS` is RELATIVE to the earliest copied clip, so a paste is just `atS + startS`. */
  clip: Clip;
  /** Tracks below the topmost copied track, so a multi-track copy keeps its shape. */
  trackOffset: number;
}

export interface ClipboardData {
  entries: ClipboardEntry[];
}

export function copyClips(p: Project, clipIds: readonly string[]): ClipboardData {
  const ids = new Set(clipIds);
  const found: { clip: Clip; trackIndex: number; trackId: string }[] = [];
  p.tracks.forEach((t, trackIndex) => {
    for (const clip of t.clips)
      if (ids.has(clip.id)) found.push({ clip, trackIndex, trackId: t.id });
  });
  if (found.length === 0) return { entries: [] };

  const baseTime = Math.min(...found.map((f) => f.clip.startS));
  const baseTrack = Math.min(...found.map((f) => f.trackIndex));
  return {
    entries: found.map((f) => ({
      clip: { ...f.clip, startS: f.clip.startS - baseTime },
      trackOffset: f.trackIndex - baseTrack,
    })),
  };
}

export function cutClips(
  p: Project,
  clipIds: readonly string[],
): { project: Project; clipboard: ClipboardData } {
  return { project: deleteClips(p, clipIds), clipboard: copyClips(p, clipIds) };
}

/** Paste at `atS` on `trackId`, spilling multi-track copies onto the tracks below (clamped at the
 *  last track). Every pasted clip gets a fresh id, so pasting onto the source track is safe. */
export function pasteClips(p: Project, data: ClipboardData, trackId: string, atS: number): Project {
  if (data.entries.length === 0) return p;
  const baseIndex = p.tracks.findIndex((t) => t.id === trackId);
  if (baseIndex < 0) return p;

  let next = p;
  for (const entry of data.entries) {
    const target = next.tracks[Math.min(baseIndex + entry.trackOffset, next.tracks.length - 1)];
    next = addClip(next, target.id, {
      ...entry.clip,
      id: newId("clip"),
      startS: atS + entry.clip.startS,
    });
  }
  return next;
}
