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

export type FilterKind = "off" | "highpass" | "lowpass";
export interface TrackFilter {
  kind: FilterKind;
  hz: number;
}
export const FILTER_OFF: TrackFilter = { kind: "off", hz: 0 };
/**
 * Resonance for the sweepable filter, in DECIBELS — not a quality factor.
 *
 * The Web Audio spec is surprising here: for `lowpass` and `highpass`, `BiquadFilterNode.Q` is
 * interpreted in dB and converted internally as `Q_linear = 10^(Q_dB/20)`. Setting it to the
 * textbook Butterworth 0.707 therefore asks for 0.7 dB of RESONANCE, which measures +0.71 dB at
 * the corner and +1.25 dB just above it — a bump sitting exactly where a high-pass is supposed to
 * be cleaning up. Butterworth (linear Q = 0.7071) is `20*log10(0.7071)` = -3.01 dB.
 *
 * Measured with `getFrequencyResponse` at an 80 Hz corner: -3.01 dB at 80, then -0.97 / -0.26 /
 * -0.02 at 113 / 160 / 320 Hz — monotonic, no bump — and -24.1 dB at 20 Hz.
 *
 * Peaking and shelf types (the EQ) take a real quality factor, which is why `EQ_MID_Q` is 0.8 and
 * this is not.
 */
export const FILTER_Q = -3.0103;

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
  /** Stereo position, -1 hard left to 1 hard right. 0 builds no nodes at all. */
  pan: number;
  /** One-knob sweepable filter. A shelf PLATEAUS — a low shelf at its limit still leaves rumble
   *  only 12 dB down — while a high-pass keeps falling at 12 dB/octave, which is the thing the
   *  three-band EQ structurally cannot do. `{ kind: "off" }` builds no node at all. */
  filter: TrackFilter;
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
  /** Master-bus filter, the same one knob a track has. Independent of Glue's FIXED band-limit:
   *  that one is part of what Glue is, this one is a control. */
  masterFilter: TrackFilter;
  /** Master-bus saturation, 0 (off, and no node at all) to 1. */
  saturation: number;
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
    pan: 0,
    filter: { ...FILTER_OFF },
  };
}

export function createProject(name = "Untitled"): Project {
  return {
    name,
    tracks: [createTrack("Track 1")],
    masterGain: 1,
    glue: false,
    masterEq: { ...FLAT_EQ },
    masterFilter: { ...FILTER_OFF },
    saturation: 0,
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
