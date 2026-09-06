/** Core document model. Plain data only — no AudioBuffer, no sample data, no DOM.
 *  This is what undo snapshots and what project.json serialises. */

export const PROJECT_SAMPLE_RATE = 48000;
/** A clip may never be trimmed shorter than this. Zero would be an invisible draggable edge. */
export const MIN_CLIP_S = 0.01;
export const PEAK_SAMPLES_PER_PAIR = 256;
/** Default depth for background ducking, dB. Mirrors `audio/ducking.ts` — kept here so the
 *  document module has no dependency on the audio layer. */
export const DEFAULT_DUCK_DEPTH_DB = -12;

/** Three fixed-frequency EQ bands per track. Frequencies and Q are NOT adjustable: the point is
 *  to make mismatched sources sit together, which broad strokes do, and sweepable bands would be
 *  the "total overkill" this feature deliberately avoids. Chosen for voice over a bed —
 *  150 Hz catches proximity boom, 1.2 kHz the honk/presence region, 6 kHz air and sibilance. */
export const EQ_LOW_HZ = 150;
export const EQ_MID_HZ = 1200;
export const EQ_MID_Q = 0.8;
export const EQ_HIGH_HZ = 6000;
/** Per band. Wide enough to rescue a bad source, narrow enough that it cannot be used as a fader. */
export const EQ_MAX_DB = 12;

/** Varispeed range, +/- two octaves of pitch. */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

/** Three fixed bands, used for BOTH a track and the master bus — same frequencies, same Q, so
 *  one set of controls and one graph builder serve both. */
export interface EqBands {
  lowDb: number;
  midDb: number;
  highDb: number;
}

export const FLAT_EQ: EqBands = { lowDb: 0, midDb: 0, highDb: 0 };

export function isFlatEq(eq: EqBands): boolean {
  return eq.lowDb === 0 && eq.midDb === 0 && eq.highDb === 0;
}

export type FadeShape = "linear" | "equalPower" | "exponential";

export interface Clip {
  id: string;
  sourceId: string;
  /** Position on the timeline, seconds. */
  startS: number;
  /** Offset into the source buffer, seconds. */
  inS: number;
  /** Length on the TIMELINE, seconds. At `speed` other than 1 this is NOT the length of source
   *  consumed — that is `durS * speed`. Keeping this in timeline seconds is what lets every
   *  overlap check, drag and drawing calculation stay speed-agnostic. */
  durS: number;
  /** Playback rate. Changes speed and pitch together, like tape — there is no independent pitch
   *  shift in the Web Audio API. 1 is unchanged. */
  speed: number;
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
  /** "Background": this track dips while any other track is playing. Like `muted` and unlike
   *  solo, it is part of the document — it changes the mix, so it must reach the export. */
  ducked: boolean;
  /** Three-band tone control. Flat by default, and when flat NO filter nodes are built at all —
   *  the graph stays bit-identical to one without EQ, the same guarantee Glue makes. */
  eq: EqBands;
}

export interface Project {
  name: string;
  tracks: Track[];
  masterGain: number;
  /** "Glue": band-limits and gently compresses the master to cohere sources — see render.ts. */
  glue: boolean;
  /** Master-bus EQ, the same three fixed bands as a track's. Sits between the master fader and
   *  Glue, so the compressor reacts to the shaped signal rather than fighting it. */
  masterEq: EqBands;
  /** How far tracks marked `ducked` dip, in dB. One value for the whole project: the feature is
   *  meant to stay a single toggle plus a single strength, not a per-track mixer. 0 disables it. */
  duckDepthDb: number;
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
  return {
    id: newId("track"),
    name,
    clips: [],
    gain: 1,
    muted: false,
    ducked: false,
    eq: { ...FLAT_EQ },
  };
}

export function createProject(name = "Untitled"): Project {
  return {
    name,
    tracks: [createTrack("Track 1")],
    masterGain: 1,
    glue: false,
    masterEq: { ...FLAT_EQ },
    duckDepthDb: DEFAULT_DUCK_DEPTH_DB,
  };
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

/** Union of every source id referenced by any of `projects`.
 *
 *  Orphan detection must consider the undo history, not just the open document. A source the
 *  current project no longer uses is still needed if any history snapshot references it —
 *  deleting it would let undo restore a document whose audio no longer exists. */
export function referencedSourceIdsAcross(projects: Iterable<Project>): Set<string> {
  const ids = new Set<string>();
  for (const p of projects) for (const t of p.tracks) for (const c of t.clips) ids.add(c.sourceId);
  return ids;
}
