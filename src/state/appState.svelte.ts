import { SvelteSet } from "svelte/reactivity";
import { AudioEngine } from "../audio/engine";
import { SourcePool, sourceFromFile } from "../audio/pool";
import { copyClips, cutClips, pasteClips, type ClipboardData } from "../doc/clipboard";
import { createProject, projectDurationS, resolveTrackId, type Project } from "../doc/document";
import { addClip, deleteClips, deleteRange, makeClip, setClipGain } from "../doc/edits";
import { matchLoudnessGains, type LoudnessEntry } from "../doc/loudness-match";
import { setIn, setOut, type PlayRange } from "../doc/play-range";
import { NO_SELECTION, type Selection } from "../doc/selection";
import { putSource, scheduleDocumentSave } from "../persist/autosave";
import { loadPreferences, nextTrackHeight, savePreferences } from "../persist/preferences";
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
  /** In/out play-range markers. Session state, like `soloed`: NOT in the document, NOT saved,
   *  NOT undoable — this is what keeps it from ever reaching an export. */
  playRange: null as PlayRange | null,
  /** The track the user last touched (clicked a header, a clip, or started a range drag on a
   *  lane). Session state, exactly like `soloed` and `playRange`: NOT in the document, NOT saved,
   *  NOT undoable. Read it through `currentTrackId()`, never directly — this field alone can name
   *  a track that no longer exists. */
  currentTrackId: null as string | null,
  pxPerSecond: prefs.pxPerSecond,
  scrollS: 0,
  trackHeightPx: prefs.trackHeightPx,
  snap: prefs.snap,
  /** Export settings live in session state and persist through `preferences` — they are a
   *  property of how you work, not of the document. */
  lastFormat: prefs.lastFormat,
  normaliseLufs: prefs.normaliseLufs,
  masterPanelOpen: prefs.masterPanelOpen,
  importing: null as { name: string; fraction: number } | null,
  /** Context menu position in viewport pixels, or null when closed. Session state because two
   *  unrelated components open it (a clip and the lane behind it) and neither owns it. */
  contextMenu: null as { x: number; y: number } | null,
  /** Keyboard-shortcut overlay. Session state: two unrelated components open it (the `?` key and
   *  the toolbar button), so it lives here rather than being drilled through props. */
  helpOpen: false,
  dirty: false,
  /** Set when a source write to IndexedDB has failed, which makes autosave unsafe for the rest
   *  of the session: `openProjectFile` swaps the in-memory session BEFORE it persists (so a bad
   *  file cannot destroy the open one), so a failed write leaves the app showing a project whose
   *  audio was never stored. Continuing to autosave the document would replace a consistent
   *  backup with one whose clips resolve to nothing — the failure this whole path exists to
   *  avoid. Session state, cleared by a reload.
   *
   *  This flag is what the UI reads; the mechanism that actually stops the writes is
   *  `disableDocumentSaves` in `autosave.ts`, so the two are set together. */
  autosaveBroken: false,
});

/** Set once `restoreAutosave` (or its failure) has settled, from `App.svelte`'s `finally`. Until
 *  then the debounced save below must not fire: it runs at module init with `state.project` still
 *  the empty `createProject()`, and restoring decodes every source before assigning the real
 *  project — a slow decode (or a failed restore) would otherwise let the 3 s debounce write that
 *  empty document over the autosave the user is trying to recover, permanently. */
let restoreSettled = false;

export function markRestoreSettled(): void {
  restoreSettled = true;
}

// Module-scope effects need their own root — there is no component owner here.
$effect.root(() => {
  // The document is kilobytes, so a 3 s debounce is free. `$state.snapshot` is essential:
  // IndexedDB cannot structured-clone a $state proxy.
  $effect(() => {
    // Read unconditionally, even while gated below, so this effect stays subscribed to
    // `state.project` and fires again (this time past the gate) on the next change once the
    // restore has settled.
    const snapshot = $state.snapshot(state.project);
    if (!restoreSettled || state.importing !== null) return;
    scheduleDocumentSave(snapshot);
  });

  $effect(() => {
    savePreferences({
      pxPerSecond: state.pxPerSecond,
      snap: state.snap,
      trackHeightPx: state.trackHeightPx,
      lastFormat: state.lastFormat,
      masterPanelOpen: state.masterPanelOpen,
      normaliseLufs: state.normaliseLufs,
    });
  });
});

/** `$state`, not a plain `let`. `canUndoNow`/`canRedoNow` are read straight into the toolbar's
 *  `disabled` bindings, and Svelte tracks what an expression READS: a plain module variable is
 *  invisible to it, so those effects had no dependencies at all and never re-ran. The buttons
 *  latched to their value at first render — permanently disabled, since history starts empty —
 *  while ⌘Z kept working, because the keyboard path calls `undoEdit` without asking first. */
let history = $state(createHistory<Project>());
type GestureKind = "structural" | "mix";

let gestureBase: Project | null = null;
let gestureKind: GestureKind = "structural";
/** `$state`, for the same reason `history` is: `canPaste()` is read inside a component's
 *  `$derived`, and Svelte tracks what an expression READS. As a plain module variable it was
 *  invisible to the tracker, so the context menu's Paste row stayed greyed out after a copy until
 *  something else happened to invalidate the derived. Any module-level value a component reads
 *  THROUGH A FUNCTION has to be `$state`. */
let clipboard: ClipboardData = $state({ entries: [], sourceTrackId: null });

/** Every document reachable through undo or redo, plus the open one.
 *
 *  Orphan pruning consults this: a source is only an orphan when NO document the user can still
 *  reach references it. See `pruneUnreferencedSources`. */
export function reachableProjects(): Project[] {
  return [state.project, ...history.past, ...history.future];
}

/** Drop all undo/redo history. Called when the open document is REPLACED wholesale — opening a
 *  project file, restoring an autosave — never for an edit.
 *
 *  History belongs to one document. Without this, undo walks straight out of the project the user
 *  just opened and into the previous one, whose sources the pool no longer holds: every clip
 *  resolves to nothing, and an export of that state renders silence while reporting success. */
export function resetHistory(): void {
  history = createHistory<Project>();
}

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
  engine.play(state.project, pool, at, playEndS(), activeSoloed());
}

/** The play range bounds playback whether or not looping is on — loop only controls whether
 *  playback restarts once it gets there. */
function playEndS(): number {
  return state.playRange ? state.playRange.toS : projectDurationS(state.project);
}

/** Where a loop restarts: the IN marker when a play range is set, otherwise the START OF THE
 *  PROJECT — never wherever playback happened to begin.
 *
 *  A loop cycles a region you can SEE, which is what every DAW does: the in/out markers are drawn
 *  on the ruler, and the whole project is self-evident. Restarting at the press-play position
 *  made the loop point invisible state that silently moved every time playback started somewhere
 *  new, with nothing on screen to say where it would jump back to. */
function loopStartS(): number {
  return state.playRange ? state.playRange.fromS : 0;
}

export function togglePlay(): void {
  if (state.playing) {
    engine.stop();
    state.playing = false;
    state.playheadS = engine.positionS();
    return;
  }
  const range = state.playRange;
  const from = range
    ? Math.max(range.fromS, Math.min(state.playheadS, range.toS))
    : state.playheadS;
  engine.onEnded = () => {
    const restartAt = loopStartS();
    // The window check is what stops an empty project (or a zero-length play range) from
    // restarting instantly and spinning: `engine.play` reports an empty window by calling
    // `onEnded` on a zero-delay timer, which would land straight back here forever.
    if (state.loop && playEndS() > restartAt) {
      state.playheadS = restartAt;
      engine.play(state.project, pool, restartAt, playEndS(), activeSoloed());
      return;
    }
    state.playing = false;
  };
  engine.play(state.project, pool, from, playEndS(), activeSoloed());
  state.playheadS = from;
  state.playing = true;
}

/** Move (or create) the IN marker to `atS` (the playhead by default — the shortcut calls this
 *  with no argument; `Ruler`'s drag passes the pointer position instead). Reschedules if playing,
 *  so a marker moved mid-playback takes effect immediately rather than only on the next play. */
export function setPlayIn(atS: number = state.playheadS): void {
  state.playRange = setIn(state.playRange, atS, projectDurationS(state.project));
  restartIfPlaying();
}

/** Move (or create) the OUT marker to `atS`. See `setPlayIn`. */
export function setPlayOut(atS: number = state.playheadS): void {
  state.playRange = setOut(state.playRange, atS, projectDurationS(state.project));
  restartIfPlaying();
}

export function clearPlayRange(): void {
  if (state.playRange === null) return;
  state.playRange = null;
  restartIfPlaying();
}

export function seekTo(s: number): void {
  const clamped = Math.max(0, s);
  state.playheadS = clamped;
  if (state.playing) {
    engine.stop();
    engine.play(state.project, pool, clamped, playEndS(), activeSoloed());
  }
}

/** Step the track height to the next preset. View state, like zoom: not in the document, not
 *  undoable, but persisted through `preferences` so it survives a reload. */
export function cycleTrackHeight(): void {
  state.trackHeightPx = nextTrackHeight(state.trackHeightPx);
}

/** The soloed ids that still name a live track.
 *
 *  `soloed` is the one piece of session state with no resolve step, and `planSchedule` drops every
 *  track when the set is non-empty and none of it matches: soloing a track and then deleting it
 *  (or starting a new project) silenced the whole timeline, with no `S` lit anywhere to explain
 *  it and no way out but a reload. Filtering at the point of USE fixes every route in one place —
 *  delete, New project, and opening a file — exactly as `currentTrackId()` does for its field. */
export function activeSoloed(): ReadonlySet<string> {
  const live = new Set(state.project.tracks.map((t) => t.id));
  const out = new Set<string>();
  for (const id of state.soloed) if (live.has(id)) out.add(id);
  return out;
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

/** The current track, resolved against the live project so a deleted track never leaks out. */
export function currentTrackId(): string {
  return resolveTrackId(state.project, state.currentTrackId);
}

/** A track becomes current when the user touches it: clicking its header, pointer-down on one of
 *  its clips, or starting a range drag on its lane. */
export function setCurrentTrack(trackId: string): void {
  state.currentTrackId = trackId;
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

/** Sets every clip's gain so all clips sit at the same perceived loudness (median of what's
 *  measured), in one undo step. Loudness is measured once per SOURCE at import time (`pool`),
 *  not per clip, so every clip sharing a source gets the same correction. Clips whose source is
 *  missing (never decoded, or decode failed) are skipped rather than left ungained. */
export function matchLoudness(): void {
  const entries: LoudnessEntry[] = [];
  for (const track of state.project.tracks) {
    for (const clip of track.clips) {
      const source = pool.get(clip.sourceId);
      if (source) entries.push({ clipId: clip.id, lufs: source.loudnessLufs });
    }
  }
  const gains = matchLoudnessGains(entries);
  commit((p) => gains.reduce((proj, g) => setClipGain(proj, g.clipId, g.gain), p));
}

/** Pastes onto the track the copy came from when that track still exists, falling back to the
 *  resolved current track otherwise. */
/** Paste lands on the CURRENT track — the one you last touched — not back on the track the clips
 *  were copied from.
 *
 *  Preferring the source track made clicking a track header silently inert for the one operation
 *  where it matters most: copying a phrase and then choosing where to put it. A multi-track copy
 *  keeps its relative track offsets, so the current track becomes the topmost of the group. */
export function pasteAtPlayhead(): void {
  commit((p) => pasteClips(p, clipboard, currentTrackId(), state.playheadS));
}

/** Is there anything on the clipboard? The clipboard itself is module-private, so a menu that
 *  wants to grey out Paste cannot see it any other way. */
export function canPaste(): boolean {
  return clipboard.entries.length > 0;
}

/** Delete whatever is selected — clips, or a time range across tracks.
 *
 *  Lives HERE rather than inside the keyboard handler because the context menu deletes too, and
 *  two copies of "delete the selection" would drift. `ripple` closes the gap the deletion leaves;
 *  only the range form can ripple, since clip deletion has no single gap to close. */
export function deleteSelection(ripple = false): void {
  if (state.selection.kind === "clips") {
    const ids = state.selection.clipIds;
    state.selection = NO_SELECTION;
    commit((p) => deleteClips(p, ids));
    return;
  }
  if (state.selection.kind === "range") {
    const r = state.selection.range;
    commit((p) => deleteRange(p, r.trackIds, r.fromS, r.toS, ripple));
  }
}

/** Copy, then paste at the playhead on the current track. Two undo entries, because that is what
 *  the two operations genuinely are — and the paste is the one worth undoing. */
export function duplicateSelection(): void {
  copySelection();
  pasteAtPlayhead();
}
