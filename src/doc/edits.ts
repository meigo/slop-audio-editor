/** Every editing operation, as a pure function `(project, ...) => Project`.
 *  No DOM, no Web Audio, no $state. This module is the heart of the test suite. */

import {
  EQ_MAX_DB,
  MAX_SPEED,
  MIN_CLIP_S,
  MIN_SPEED,
  projectDurationS,
  clipEndS,
  createTrack,
  findClip,
  newId,
  type Clip,
  type FadeShape,
  type Project,
  type Track,
  type EqBands,
  type TrackFilter,
} from "./document";
import { clampFades, insertClip, sliceClip } from "./overlap";

/** Replace one track by id. Returns the SAME project object when the id is unknown or the
 *  callback is a no-op, so callers can cheaply detect "nothing changed". */
export function mapTrack(p: Project, trackId: string, fn: (t: Track) => Track): Project {
  const i = p.tracks.findIndex((t) => t.id === trackId);
  if (i < 0) return p;
  const next = fn(p.tracks[i]);
  if (next === p.tracks[i]) return p;
  const tracks = p.tracks.slice();
  tracks[i] = next;
  return { ...p, tracks };
}

export function addTrack(p: Project, name?: string): Project {
  return { ...p, tracks: [...p.tracks, createTrack(name ?? `Track ${p.tracks.length + 1}`)] };
}

/** A project always has at least one track, so removing the last one is a no-op. */
export function removeTrack(p: Project, trackId: string): Project {
  if (p.tracks.length <= 1) return p;
  const tracks = p.tracks.filter((t) => t.id !== trackId);
  return tracks.length === p.tracks.length ? p : { ...p, tracks };
}

export function renameTrack(p: Project, trackId: string, name: string): Project {
  return mapTrack(p, trackId, (t) => (t.name === name ? t : { ...t, name }));
}

export function reorderTrack(p: Project, trackId: string, toIndex: number): Project {
  const from = p.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return p;
  const to = Math.max(0, Math.min(toIndex, p.tracks.length - 1));
  if (to === from) return p;
  const tracks = p.tracks.slice();
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  return { ...p, tracks };
}

export function setTrackGain(p: Project, trackId: string, gain: number): Project {
  const g = Math.max(0, gain);
  return mapTrack(p, trackId, (t) => (t.gain === g ? t : { ...t, gain: g }));
}

export function setTrackMuted(p: Project, trackId: string, muted: boolean): Project {
  return mapTrack(p, trackId, (t) => (t.muted === muted ? t : { ...t, muted }));
}

/** Each EQ band is clamped to +/-EQ_MAX_DB. */
const clampEqDb = (v: number): number => Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, v));

/**
 * Set a clip's playback rate, keeping the SOURCE REGION and rescaling the timeline length.
 *
 * Speeding a clip up makes it shorter, which is what tape does and what the gesture means: the
 * same audio, played faster. The alternative — a fixed timeline length that eats more source —
 * would make a clip trimmed to the whole file impossible to speed up at all.
 *
 * Growing (slowing down) is clamped against the next clip exactly as `trimClipEnd` is, so the
 * non-overlap invariant holds without the caller thinking about it. The clamp costs the tail of
 * the source, the same way trimming does.
 */
export function setClipSpeed(p: Project, clipId: string, speed: number): Project {
  const next = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
  return mapClip(p, clipId, (c, t) => {
    if (next === c.speed) return c;
    const i = t.clips.indexOf(c);
    const nextStart = i < t.clips.length - 1 ? t.clips[i + 1].startS : Infinity;
    const wanted = (c.durS * c.speed) / next;
    const durS = Math.max(MIN_CLIP_S, Math.min(wanted, nextStart - c.startS));
    return clampFades({ ...c, speed: next, durS });
  });
}

export function setTrackEq(p: Project, trackId: string, patch: Partial<EqBands>): Project {
  return mapTrack(p, trackId, (t) => {
    const next: EqBands = {
      lowDb: clampEqDb(patch.lowDb ?? t.eq.lowDb),
      midDb: clampEqDb(patch.midDb ?? t.eq.midDb),
      highDb: clampEqDb(patch.highDb ?? t.eq.highDb),
    };
    const same =
      next.lowDb === t.eq.lowDb && next.midDb === t.eq.midDb && next.highDb === t.eq.highDb;
    return same ? t : { ...t, eq: next };
  });
}

/** Master-bus EQ. Same clamp as a track's — the bands are the same bands. */
export function setMasterEq(p: Project, patch: Partial<EqBands>): Project {
  const next: EqBands = {
    lowDb: clampEqDb(patch.lowDb ?? p.masterEq.lowDb),
    midDb: clampEqDb(patch.midDb ?? p.masterEq.midDb),
    highDb: clampEqDb(patch.highDb ?? p.masterEq.highDb),
  };
  const cur = p.masterEq;
  if (next.lowDb === cur.lowDb && next.midDb === cur.midDb && next.highDb === cur.highDb) return p;
  return { ...p, masterEq: next };
}

export function setTrackDucked(p: Project, trackId: string, ducked: boolean): Project {
  return mapTrack(p, trackId, (t) => (t.ducked === ducked ? t : { ...t, ducked }));
}

export function setMasterGain(p: Project, gain: number): Project {
  const g = Math.max(0, gain);
  return g === p.masterGain ? p : { ...p, masterGain: g };
}

/** Project-wide ducking depth in dB; 0 turns ducking off without clearing any track's D flag. */
export function setDuckDepth(p: Project, db: number): Project {
  const d = Math.max(-40, Math.min(0, db));
  return p.duckDepthDb === d ? p : { ...p, duckDepthDb: d };
}

export function setGlue(p: Project, glue: boolean): Project {
  return glue === p.glue ? p : { ...p, glue };
}

export function makeClip(sourceId: string, startS: number, durS: number, inS = 0): Clip {
  return {
    id: newId("clip"),
    sourceId,
    startS,
    inS,
    durS,
    speed: 1,
    gain: 1,
    fadeInS: 0,
    fadeOutS: 0,
    fadeShape: "linear",
  };
}

export function addClip(p: Project, trackId: string, clip: Clip): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, clips: insertClip(t.clips, clip) }));
}

export function deleteClips(p: Project, clipIds: readonly string[]): Project {
  const ids = new Set(clipIds);
  if (ids.size === 0) return p;
  let changed = false;
  const tracks = p.tracks.map((t) => {
    const clips = t.clips.filter((c) => !ids.has(c.id));
    if (clips.length === t.clips.length) return t;
    changed = true;
    return { ...t, clips };
  });
  return changed ? { ...p, tracks } : p;
}

/**
 * Move a set of clips by `deltaS` seconds and `deltaTrackIndex` tracks.
 *
 * Every moved clip is REMOVED FIRST from every track and only then re-inserted. If we inserted
 * as we went, a clip sliding past its own selected sibling could overwrite that sibling before
 * the sibling itself gets a chance to move (insertClip resolves overlaps by deleting whatever is
 * already there).
 *
 * The time delta is clamped ONCE for the whole group, not per clip: clamping each clip
 * independently at t=0 would let the leading clip stop at 0 while trailing clips keep sliding
 * left underneath it, collapsing the group's internal spacing. Clamping the single shared delta
 * against the earliest clip's start keeps every clip's offset from the others intact.
 */
export function moveClips(
  p: Project,
  clipIds: readonly string[],
  deltaS: number,
  deltaTrackIndex: number,
): Project {
  const ids = new Set(clipIds);
  if (ids.size === 0) return p;

  const moving: { clip: Clip; fromTrackIndex: number }[] = [];
  p.tracks.forEach((t, i) => {
    for (const c of t.clips) if (ids.has(c.id)) moving.push({ clip: c, fromTrackIndex: i });
  });
  if (moving.length === 0) return p;

  const minStart = Math.min(...moving.map((m) => m.clip.startS));
  const dt = Math.max(deltaS, -minStart);
  const minTrack = Math.min(...moving.map((m) => m.fromTrackIndex));
  const maxTrack = Math.max(...moving.map((m) => m.fromTrackIndex));
  const dTrack = Math.max(-minTrack, Math.min(deltaTrackIndex, p.tracks.length - 1 - maxTrack));
  if (dt === 0 && dTrack === 0) return p;

  // Strip the movers out of every track first.
  const tracks: Track[] = p.tracks.map((t) => ({
    ...t,
    clips: t.clips.filter((c) => !ids.has(c.id)),
  }));
  for (const { clip, fromTrackIndex } of moving) {
    const target = tracks[fromTrackIndex + dTrack];
    target.clips = insertClip(target.clips, { ...clip, startS: clip.startS + dt });
  }
  return { ...p, tracks };
}

/** Replace one clip in place, by id, keeping the track sorted. */
function mapClip(p: Project, clipId: string, fn: (c: Clip, t: Track) => Clip): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const next = fn(found.clip, found.track);
  if (next === found.clip) return p;
  return mapTrack(p, found.track.id, (t) => ({
    ...t,
    clips: t.clips.map((c) => (c.id === clipId ? next : c)).sort((a, b) => a.startS - b.startS),
  }));
}

/**
 * Drag the HEAD handle by `deltaS` (positive = trim more off the front).
 *
 * `startS` and `inS` move by the SAME delta on purpose: the two changes cancel in timeline terms,
 * so the audio you KEEP stays under the same timeline position it was already under. You trim a
 * head because the sync is already right — a head trim that re-syncs the clip is a bug.
 *
 * The DELTA is clamped, not the fields, so the two can never be clamped by different amounts and
 * break the invariant this function exists to hold.
 */
export function trimClipStart(p: Project, clipId: string, deltaS: number): Project {
  return mapClip(p, clipId, (c, t) => {
    const i = t.clips.indexOf(c);
    const prevEnd = i > 0 ? clipEndS(t.clips[i - 1]) : 0;
    // `deltaS` is TIMELINE seconds; the in-point moves by `deltaS * speed` source seconds, so the
    // in-point floor converts the other way. At speed 1 this is the original `-c.inS`.
    const lo = Math.max(-c.inS / c.speed, prevEnd - c.startS);
    const hi = c.durS - MIN_CLIP_S;
    const d = Math.max(lo, Math.min(deltaS, hi));
    if (d === 0) return c;
    // ONE clamped delta drives both fields, scaled for each — clamping them separately lets the
    // position on the timeline and the offset into the source drift apart.
    return clampFades({
      ...c,
      startS: c.startS + d,
      inS: c.inS + d * c.speed,
      durS: c.durS - d,
    });
  });
}

/** Drag the TAIL handle by `deltaS` (positive = longer). `sourceDurS` is the whole source's
 *  duration — the tail can never run past the end of the audio it came from. */
export function trimClipEnd(
  p: Project,
  clipId: string,
  deltaS: number,
  sourceDurS: number,
): Project {
  return mapClip(p, clipId, (c, t) => {
    const i = t.clips.indexOf(c);
    const nextStart = i < t.clips.length - 1 ? t.clips[i + 1].startS : Infinity;
    const lo = MIN_CLIP_S - c.durS;
    // Source remaining, expressed in TIMELINE seconds — one timeline second eats `speed` of them.
    const hi = Math.min((sourceDurS - c.inS) / c.speed - c.durS, nextStart - clipEndS(c));
    const d = Math.max(lo, Math.min(deltaS, hi));
    if (d === 0) return c;
    return clampFades({ ...c, durS: c.durS + d });
  });
}

/** Split every clip crossing `atS` on the given tracks. A split that would produce a piece shorter
 *  than MIN_CLIP_S is refused outright rather than producing a sliver. */
export function splitAt(p: Project, trackIds: readonly string[], atS: number): Project {
  let next = p;
  for (const trackId of trackIds) {
    next = mapTrack(next, trackId, (t) => {
      let changed = false;
      const clips: Clip[] = [];
      for (const c of t.clips) {
        if (c.startS >= atS || clipEndS(c) <= atS) {
          clips.push(c);
          continue;
        }
        const head = sliceClip(c, -Infinity, atS);
        const tail = sliceClip(c, atS, Infinity);
        if (!head || !tail) {
          clips.push(c);
          continue;
        }
        clips.push(head, { ...tail, id: newId("clip") });
        changed = true;
      }
      return changed ? { ...t, clips } : t;
    });
  }
  return next;
}

/**
 * Cut `[fromS, toS)` out of the given tracks, and — if `ripple` — close the gap by shifting
 * everything after it left.
 *
 * Each clip is handled directly with `sliceClip` rather than by routing through `splitAt`:
 * `splitAt` REFUSES a split that would leave a sub-`MIN_CLIP_S` sliver, which for a cut would mean
 * leaving the whole original clip in place — overlapping both the clips kept before it and the
 * ones rippled left over the top of it. A cut must drop slivers, not preserve the clip they came
 * from, so `sliceClip` (which already returns null for a sub-`MIN_CLIP_S` fragment) is used
 * directly on each clip that overlaps the range.
 *
 * `trackIds` scopes the ripple. It is NEVER global: sliding every track would pull a music bed out
 * of sync with the narration you were editing. The caller passes the tracks the time-range
 * selection covers, so an edit on one track leaves its neighbours where they are.
 */
export function deleteRange(
  p: Project,
  trackIds: readonly string[],
  fromS: number,
  toS: number,
  ripple: boolean,
): Project {
  if (!(toS > fromS)) return p;
  const span = toS - fromS;
  let next = p;

  for (const trackId of trackIds) {
    next = mapTrack(next, trackId, (t) => {
      let changed = false;
      const clips: Clip[] = [];
      for (const c of t.clips) {
        if (clipEndS(c) <= fromS) {
          // Entirely before the cut — untouched.
          clips.push(c);
          continue;
        }
        if (c.startS >= toS) {
          // Entirely after the cut — shift left to close the gap if rippling.
          if (ripple) {
            clips.push({ ...c, startS: c.startS - span });
            changed = true;
          } else {
            clips.push(c);
          }
          continue;
        }
        // Overlaps the cut range: keep only what survives outside it.
        changed = true;
        const head = sliceClip(c, -Infinity, fromS);
        const tail = sliceClip(c, toS, Infinity);
        if (head) clips.push(head);
        if (tail) {
          const shifted = ripple ? { ...tail, startS: tail.startS - span } : tail;
          // A fresh id only when a head ALSO survived (a genuine split into two pieces),
          // matching insertClip's rule.
          clips.push(head ? { ...shifted, id: newId("clip") } : shifted);
        }
      }
      if (!changed) return t;
      clips.sort((a, b) => a.startS - b.startS);
      return { ...t, clips };
    });
  }
  return next;
}

export function setClipGain(p: Project, clipId: string, gain: number): Project {
  const g = Math.max(0, gain);
  return mapClip(p, clipId, (c) => (c.gain === g ? c : { ...c, gain: g }));
}

/** Patch a clip's fades. `clampFades` decides what happens when they collide: the pair is scaled
 *  to fill exactly the clip, so dragging one handle past the other pushes the other back instead
 *  of rejecting the drag. */
export function setClipFade(
  p: Project,
  clipId: string,
  patch: { fadeInS?: number; fadeOutS?: number; fadeShape?: FadeShape },
): Project {
  return mapClip(p, clipId, (c) => {
    const next: Clip = {
      ...c,
      fadeInS: patch.fadeInS ?? c.fadeInS,
      fadeOutS: patch.fadeOutS ?? c.fadeOutS,
      fadeShape: patch.fadeShape ?? c.fadeShape,
    };
    const clamped = clampFades(next);
    return clamped.fadeInS === c.fadeInS &&
      clamped.fadeOutS === c.fadeOutS &&
      clamped.fadeShape === c.fadeShape
      ? c
      : clamped;
  });
}

/** Set a track's one-knob filter. `{ kind: "off" }` is the bypass, and the no-op guard is what
 *  stops a sweep that lands back where it started pushing a junk undo entry. */
export function setTrackFilter(p: Project, trackId: string, filter: TrackFilter): Project {
  const next: TrackFilter =
    filter.kind === "off" ? { kind: "off", hz: 0 } : { kind: filter.kind, hz: filter.hz };
  return mapTrack(p, trackId, (t) =>
    t.filter.kind === next.kind && t.filter.hz === next.hz ? t : { ...t, filter: next },
  );
}

/** Stereo position for a track, clamped to [-1, 1]. The no-op guard keeps a sweep that lands back
 *  at its starting point from pushing a history entry. */
export function setTrackPan(p: Project, trackId: string, pan: number): Project {
  const next = Math.max(-1, Math.min(1, pan));
  return mapTrack(p, trackId, (t) => (t.pan === next ? t : { ...t, pan: next }));
}

/** Master-bus filter. Same shape as `setTrackFilter`, including the no-op guard. */
export function setMasterFilter(p: Project, filter: TrackFilter): Project {
  const next: TrackFilter =
    filter.kind === "off" ? { kind: "off", hz: 0 } : { kind: filter.kind, hz: filter.hz };
  const cur = p.masterFilter;
  return cur.kind === next.kind && cur.hz === next.hz ? p : { ...p, masterFilter: next };
}

/** Master-bus saturation, clamped to 0..1. */
export function setSaturation(p: Project, amount: number): Project {
  const next = Math.max(0, Math.min(1, amount));
  return p.saturation === next ? p : { ...p, saturation: next };
}

/** Fade-in on the whole mix, in seconds, from t = 0. Its anchor needs no decision at all — a
 *  project always starts at zero, where the end moves whenever the last clip does. */
export function setMasterFadeIn(p: Project, seconds: number): Project {
  const next = Math.max(0, Math.min(seconds, projectDurationS(p)));
  return p.fadeInS === next ? p : { ...p, fadeInS: next };
}

/** Fade-out on the whole mix, in seconds. Clamped to the project's own length — a fade longer than
 *  the material would start before anything is playing. */
export function setMasterFadeOut(p: Project, seconds: number): Project {
  const next = Math.max(0, Math.min(seconds, projectDurationS(p)));
  return p.fadeOutS === next ? p : { ...p, fadeOutS: next };
}
