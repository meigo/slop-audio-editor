import { SvelteSet } from "svelte/reactivity";
import { AudioEngine } from "../audio/engine";
import { SourcePool, sourceFromFile } from "../audio/pool";
import {
  copyClips, cutClips, pasteClips, type ClipboardData,
} from "../doc/clipboard";
import { createProject, projectDurationS, type Project } from "../doc/document";
import { addClip, makeClip } from "../doc/edits";
import { NO_SELECTION, type Selection } from "../doc/selection";
import { canRedo, canUndo, createHistory, record, redo, undo } from "./history";

export const pool = new SourcePool();
export const engine = new AudioEngine();

/** The single source of truth. `soloed` is a SvelteSet: a plain Set is NOT reactive in runes
 *  mode, so mutating one would silently fail to update the track headers. */
export const state = $state({
  project: createProject(),
  selection: NO_SELECTION as Selection,
  soloed: new SvelteSet<string>(),
  playheadS: 0,
  playing: false,
  loop: false,
  pxPerSecond: 60,
  scrollS: 0,
  trackHeightPx: 88,
  snap: true,
  importing: null as { name: string; fraction: number } | null,
  dirty: false,
});

let history = createHistory<Project>();
let gestureBase: Project | null = null;
let clipboard: ClipboardData = { entries: [] };

export function canUndoNow(): boolean {
  return canUndo(history);
}

export function canRedoNow(): boolean {
  return canRedo(history);
}

/** One edit, one history entry. */
export function commit(fn: (p: Project) => Project): void {
  const prev = state.project;
  const next = fn(prev);
  if (next === prev) return;
  history = record(history, prev);
  state.project = next;
  state.dirty = true;
  restartIfPlaying();
}

/** A continuous gesture (dragging a clip, dragging a fade handle) mutates live via `amend` and
 *  produces ONE history entry when the pointer comes up. */
export function beginGesture(): void {
  gestureBase = state.project;
}

export function amend(fn: (p: Project) => Project): void {
  state.project = fn(state.project);
}

export function endGesture(): void {
  if (gestureBase && gestureBase !== state.project) {
    history = record(history, gestureBase);
    state.dirty = true;
    restartIfPlaying();
  }
  gestureBase = null;
}

export function undoEdit(): void {
  const r = undo(history, state.project);
  if (!r) return;
  history = r.history;
  state.project = r.state;
  state.dirty = true;
  restartIfPlaying();
}

export function redoEdit(): void {
  const r = redo(history, state.project);
  if (!r) return;
  history = r.history;
  state.project = r.state;
  state.dirty = true;
  restartIfPlaying();
}

/** Structural edits invalidate the schedule, so playback restarts from where it had got to.
 *  Mix changes do NOT go through here — they are applied live on the engine's retained nodes. */
function restartIfPlaying(): void {
  if (!state.playing) return;
  const at = engine.positionS();
  engine.stop();
  engine.play(state.project, pool, at, playEndS(), state.soloed);
}

function playEndS(): number {
  return state.selection.kind === "range" && state.loop
    ? state.selection.range.toS
    : projectDurationS(state.project);
}

export function togglePlay(): void {
  if (state.playing) {
    engine.stop();
    state.playing = false;
    state.playheadS = engine.positionS();
    return;
  }
  const from =
    state.loop && state.selection.kind === "range" ? state.selection.range.fromS : state.playheadS;
  engine.onEnded = () => {
    if (state.loop) {
      state.playheadS = from;
      engine.play(state.project, pool, from, playEndS(), state.soloed);
      return;
    }
    state.playing = false;
  };
  engine.play(state.project, pool, from, playEndS(), state.soloed);
  state.playheadS = from;
  state.playing = true;
}

export function seekTo(s: number): void {
  const clamped = Math.max(0, s);
  state.playheadS = clamped;
  if (state.playing) {
    engine.stop();
    engine.play(state.project, pool, clamped, playEndS(), state.soloed);
  }
}

export function toggleSolo(trackId: string): void {
  if (state.soloed.has(trackId)) state.soloed.delete(trackId);
  else state.soloed.add(trackId);
  restartIfPlaying(); // solo changes which clips are scheduled, unlike a gain change
}

/** The tracks an edit applies to: the range selection's tracks, or every track when there is
 *  no range. This is what keeps ripple scoped (spec §4). */
export function selectedTrackIds(): string[] {
  return state.selection.kind === "range"
    ? state.selection.range.trackIds
    : state.project.tracks.map((t) => t.id);
}

export async function importFiles(
  files: FileList | File[],
  trackId: string,
  atS: number,
): Promise<void> {
  let at = atS;
  for (const file of Array.from(files)) {
    state.importing = { name: file.name, fraction: 0 };
    try {
      const source = await sourceFromFile(file, (f) => {
        state.importing = { name: file.name, fraction: f };
      });
      pool.add(source);
      commit((p) => addClip(p, trackId, makeClip(source.id, at, source.durationS)));
      at += source.durationS;
    } finally {
      state.importing = null;
    }
  }
}

export function copySelection(): void {
  if (state.selection.kind !== "clips") return;
  clipboard = copyClips(state.project, state.selection.clipIds);
}

export function cutSelection(): void {
  if (state.selection.kind !== "clips") return;
  const ids = state.selection.clipIds;
  const result = cutClips(state.project, ids);
  clipboard = result.clipboard;
  commit(() => result.project);
  state.selection = NO_SELECTION;
}

export function pasteAtPlayhead(trackId: string): void {
  commit((p) => pasteClips(p, clipboard, trackId, state.playheadS));
}
