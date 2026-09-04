/** Core document model. Plain data only — no AudioBuffer, no sample data, no DOM.
 *  This is what undo snapshots and what project.json serialises. */

export const PROJECT_SAMPLE_RATE = 48000;
/** A clip may never be trimmed shorter than this. Zero would be an invisible draggable edge. */
export const MIN_CLIP_S = 0.01;
export const PEAK_SAMPLES_PER_PAIR = 256;

export type FadeShape = "linear" | "equalPower" | "exponential";

export interface Clip {
  id: string;
  sourceId: string;
  /** Position on the timeline, seconds. */
  startS: number;
  /** Offset into the source buffer, seconds. */
  inS: number;
  /** Length on the timeline == length of source consumed, seconds. */
  durS: number;
  /** Linear. */
  gain: number;
  fadeInS: number;
  fadeOutS: number;
  fadeShape: FadeShape;
}

export interface Track {
  id: string;
  name: string;
  /** INVARIANT: sorted by startS, non-overlapping. */
  clips: Clip[];
  /** Linear; the fader displays dB. */
  gain: number;
  /** Affects EXPORT. Solo does not live here — it is view state (see the spec, §3). */
  muted: boolean;
}

export interface Project {
  name: string;
  tracks: Track[];
  masterGain: number;
  /** "Glue": band-limits and gently compresses the master to cohere sources — see render.ts. */
  glue: boolean;
}

let idCounter = 0;

export function newId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

/** Test-only: makes ids deterministic per test. Never called by app code. */
export function __resetIds(): void {
  idCounter = 0;
}

/** Advance the id counter past every id in `ids`.
 *
 *  `idCounter` resets to 0 on every page load, but a document loaded from autosave or a project
 *  file carries ids minted in an EARLIER session. Without this, the next import would mint
 *  `src-1`/`clip-1` all over again: the pool's `Map.set` would REPLACE an existing source (so an
 *  unrelated clip starts playing the newly imported audio), and two clips would share an id (so
 *  selecting or moving one moves both). Both corruptions then persist into the saved file. */
export function adoptIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const match = /-(\d+)$/.exec(id);
    if (!match) continue;
    const n = Number(match[1]);
    if (n > idCounter) idCounter = n;
  }
}

export function createTrack(name: string): Track {
  return { id: newId("track"), name, clips: [], gain: 1, muted: false };
}

export function createProject(name = "Untitled"): Project {
  return { name, tracks: [createTrack("Track 1")], masterGain: 1, glue: false };
}

export function clipEndS(c: Clip): number {
  return c.startS + c.durS;
}

export function trackDurationS(t: Track): number {
  let end = 0;
  for (const c of t.clips) end = Math.max(end, clipEndS(c));
  return end;
}

/** The project's length is the LAST clip end across all tracks — computed, never stored. */
export function projectDurationS(p: Project): number {
  let end = 0;
  for (const t of p.tracks) end = Math.max(end, trackDurationS(t));
  return end;
}

export function findTrack(p: Project, trackId: string): Track | undefined {
  return p.tracks.find((t) => t.id === trackId);
}

export function findClip(p: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

/** Resolves a preferred track id against the project, falling back to the first track when
 *  `preferredId` is null or names a track that no longer exists (e.g. it was deleted). A project
 *  always has at least one track, so this always returns something usable — callers never need to
 *  null-check. */
export function resolveTrackId(p: Project, preferredId: string | null): string {
  if (preferredId !== null && findTrack(p, preferredId)) return preferredId;
  return p.tracks[0].id;
}
