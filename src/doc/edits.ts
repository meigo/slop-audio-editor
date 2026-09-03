/** Every editing operation, as a pure function `(project, ...) => Project`.
 *  No DOM, no Web Audio, no $state. This module is the heart of the test suite. */

import { createTrack, type Project, type Track } from "./document";

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

export function setMasterGain(p: Project, gain: number): Project {
  const g = Math.max(0, gain);
  return g === p.masterGain ? p : { ...p, masterGain: g };
}
