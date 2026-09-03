import { SvelteSet } from "svelte/reactivity";
import { AudioEngine } from "../audio/engine";
import { SourcePool, sourceFromFile } from "../audio/pool";
import {
  copyClips, cutClips, pasteClips, type ClipboardData,
} from "../doc/clipboard";
import { createProject, projectDurationS, type Project } from "../doc/document";
import { addClip, makeClip } from "../doc/edits";
import { NO_SELECTION, type Selection } from "../doc/selection";
import { putSource, scheduleDocumentSave } from "../persist/autosave";
import { loadPreferences, savePreferences } from "../persist/preferences";
import { canRedo, canUndo, createHistory, record, redo, undo } from "./history";

export const pool = new SourcePool();
export const engine = new AudioEngine();

// Applied at module init, before any component reads the store.
const prefs = loadPreferences();

/** The single source of truth. `soloed` is a SvelteSet: a plain Set is NOT reactive in runes
 *  mode, so mutating one would silently fail to update the track headers. */
export const state = $state({
  project: createProject(),
  selection: NO_SELECTION as Selection,
  soloed: new SvelteSet<string>(),
  playheadS: 0,
  playing: false,
  loop: false,
  pxPerSecond: prefs.pxPerSecond,
  scrollS: 0,
  trackHeightPx: prefs.trackHeightPx,
  snap: prefs.snap,
  importing: null as { name: string; fraction: number } | null,
  dirty: false,
});

// Module-scope effects need their own root — there is no component owner here.
$effect.root(() => {
  // The document is kilobytes, so a 3 s debounce is free. `$state.snapshot` is essential:
  // IndexedDB cannot structured-clone a $state proxy.
  $effect(() => {
    scheduleDocumentSave($state.snapshot(state.project));
  });

  $effect(() => {
    savePreferences({
      pxPerSecond: state.pxPerSecond,
      snap: state.snap,
      trackHeightPx: state.trackHeightPx,
      lastFormat: prefs.lastFormat,
    });
  });
});

let history = createHistory<Project>();
type GestureKind = "structural" | "mix";

let gestureBase: Project | null = null;
let gestureKind: GestureKind = "structural";
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

/** A continuous gesture (dragging a clip, riding a fader) mutates live via `amend` and produces
 *  ONE history entry when the pointer comes up.
 *
 *  `kind` decides whether the commit reschedules playback. A "structural" gesture (move, trim,
 *  fade handles) changes WHICH audio plays, so the schedule must be rebuilt. A "mix" gesture
 *  (track or master gain) only changes a level that is already a live GainNode — rescheduling it
 *  would stop and restart every source node, producing an audible dropout on every fader
 *  release. That is the whole reason track gain is its own node rather than folded into the
 *  clip's gain. */
export function beginGesture(kind: GestureKind = "structural"): void {
  gestureBase = state.project;
  gestureKind = kind;
}

export function amend(fn: (p: Project) => Project): void {
  state.project = fn(state.project);
}

export function endGesture(): void {
  if (gestureBase && gestureBase !== state.project) {
    history = record(history, gestureBase);
    state.dirty = true;
    if (gestureKind === "structural") restartIfPlaying();
  }
  gestureBase = null;
  gestureKind = "structural";
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
      // Source bytes are immutable and large — written ONCE here, never on the document debounce.
      // Awaited (not `void`) and left to propagate: a quota failure or aborted write must not be
      // silently discarded, since the user has just imported audio they expect to survive a
      // reload. Both callers of `importFiles` — drag-and-drop in App.svelte and the toolbar's
      // "Import audio" button — await it inside a try/catch and surface the failure visibly.
      await putSource({ id: source.id, name: source.name, bytes: source.bytes });
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
