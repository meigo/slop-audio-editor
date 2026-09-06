import { SvelteSet } from "svelte/reactivity";
import { AudioEngine } from "../audio/engine";
import { SourcePool, sourceFromFile } from "../audio/pool";
import { copyClips, cutClips, pasteClips, type ClipboardData } from "../doc/clipboard";
import { createProject, projectDurationS, resolveTrackId, type Project } from "../doc/document";
import { addClip, deleteClips, deleteRange, makeClip, setClipGain } from "../doc/edits";
import { matchLoudnessGains, type LoudnessEntry } from "../doc/loudness-match";
import { setIn, setOut, type PlayRange } from "../doc/play-range";
import { fitSpan, NO_SELECTION, type Selection } from "../doc/selection";
import { putSource, scheduleDocumentSave } from "../persist/autosave";
import {
  loadPreferences,
  nextTrackHeight,
  savePreferences,
  type SidePanelTab,
} from "../persist/preferences";
import { fitView } from "../lib/geometry";
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
  /** Width of the timeline viewport in CSS pixels, published by `App` so the zoom-to-fit action
   *  can be reached from the keyboard, the toolbar and the context menu without three of them
   *  drilling the same measurement through props. */
  timelineWidthPx: 0,
  trackHeightPx: prefs.trackHeightPx,
  snap: prefs.snap,
  /** Export settings live in session state and persist through `preferences` — they are a
   *  property of how you work, not of the document. */
  lastFormat: prefs.lastFormat,
  normaliseLufs: prefs.normaliseLufs,
  sidePanelOpen: prefs.sidePanelOpen,
  sidePanelWidth: prefs.sidePanelWidth,
  sidePanelTab: prefs.sidePanelTab,
  importing: null as { name: string; fraction: number } | null,
  /** Context menu position in viewport pixels, or null when closed. Session state because two
   *  unrelated components open it (a clip and the lane behind it) and neither owns it. */
  contextMenu: null as { x: number; y: number } | null,
  /** Keyboard-shortcut overlay. Session state: two unrelated components open it (the `?` key and
   *  the toolbar button), so it lives here rather than being drilled through props. */
  helpOpen: false,
  /** Export dialog. Here rather than local to the toolbar so `KeyboardShortcuts` can see that a
   *  modal is open — typing behind a dialog used to edit the document underneath it. */
  exportOpen: false,
  /** Whatever went wrong loading, opening or importing a file. Shown as an out-of-flow banner:
   *  it used to be a `<span>` in the TOOLBAR's flow, so an error shoved every control to its
   *  right — and, since nothing cleared it, left them there for the rest of the session. */
  fileError: null as string | null,
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
      sidePanelOpen: state.sidePanelOpen,
      sidePanelWidth: state.sidePanelWidth,
      sidePanelTab: state.sidePanelTab,
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
let clipboard: ClipboardData = $state({ entries: [] });

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

/** One edit, one history entry.
 *
 *  A commit can land INSIDE an open gesture — Delete pressed mid-drag. Recording the drag's base
 *  after the edit put history out of order: the first undo restored the pre-drag state and the
 *  second undid the edit into a mid-drag snapshot. The gesture is closed first, so what the drag
 *  had done so far is its own entry, and reopened after, so the rest of the drag is another. */
export function commit(fn: (p: Project) => Project): void {
  const reopen = gestureBase !== null ? gestureKind : null;
  if (reopen !== null) endGesture();
  const prev = state.project;
  const next = fn(prev);
  if (next !== prev) {
    history = record(history, prev);
    state.project = next;
    state.dirty = true;
    restartIfPlaying();
  }
  if (reopen !== null) beginGesture(reopen);
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
    // A "mix" gesture never reschedules — unless it turned something on that the graph has no
    // node for. Neutral builds nothing (a flat EQ, a centred pan, a filter that is off, zero
    // drive), so sweeping away from neutral while playing had nowhere to write and was inaudible
    // until the next play: from the user's seat, a knob that did nothing. One rebuild on release
    // is the cost; the sweep itself stays dropout-free.
    if (gestureKind === "structural" || engine.needsRebuild(state.project)) restartIfPlaying();
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
      // `looping`: the restart takes the shorter schedule lead, since here the lead is silence at
      // the seam and is paid on every cycle.
      engine.play(state.project, pool, restartAt, playEndS(), activeSoloed(), true);
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
export function setPlayIn(atS: number = state.playheadS, restart = true): void {
  state.playRange = setIn(state.playRange, atS, projectDurationS(state.project));
  if (restart) restartIfPlaying();
}

/** Move (or create) the OUT marker to `atS`. See `setPlayIn`.
 *
 *  `restart = false` is for a DRAG: the ruler calls this on every pointermove, and rescheduling
 *  per move rebuilt the whole graph — each rebuild with its 50 ms lead — so dragging a marker
 *  during playback stuttered for the length of the drag. The drag reschedules once, on release,
 *  through `reschedulePlayback`. */
export function setPlayOut(atS: number = state.playheadS, restart = true): void {
  state.playRange = setOut(state.playRange, atS, projectDurationS(state.project));
  if (restart) restartIfPlaying();
}

/** Rebuild the playback graph from the current position, if playing. For a gesture that changed
 *  the schedule without rescheduling per step — a marker drag. */
export function reschedulePlayback(): void {
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
      // Resolved at COMMIT time, not captured: decoding yields for seconds and the UI stays live,
      // so the target track can be deleted while the banner is up. `addClip` on a dead id was a
      // silent no-op — the source was already stored, the clip never appeared, and the bytes sat
      // as an orphan until the next restore pruned them.
      commit((p) =>
        addClip(p, resolveTrackId(p, trackId), makeClip(source.id, at, source.durationS)),
      );
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

/**
 * Scale the timeline so a span fills the viewport horizontally.
 *
 * `"selection"` frames the selected clips or the drawn range and falls back to the whole project
 * when nothing is selected (see `fitSpan`); `"project"` always frames everything, so a fit is
 * reachable without first clearing a selection.
 *
 * Lives here for the same reason `deleteSelection` does: the keyboard, the toolbar button and the
 * context menu all fit, and three copies of the arithmetic would drift.
 */
export function zoomToFit(scope: "project" | "selection"): void {
  const span =
    scope === "project"
      ? { fromS: 0, toS: projectDurationS(state.project) }
      : fitSpan(state.project, state.selection);
  const next = fitView(span.fromS, span.toS, state.timelineWidthPx);
  state.pxPerSecond = next.pxPerSecond;
  state.scrollS = next.scrollS;
}

/**
 * Drop every piece of session state that belonged to the PREVIOUS document.
 *
 * Selection, in/out markers, solo, the playhead and the running graph are all keyed to a document
 * that no longer exists. The selection is the dangerous one: `exportWindow` reads a time-range
 * selection and nothing else, so a range left over from project A silently truncated an export of
 * project B — while `RangeOverlay` drew nothing, because the range's track ids matched no track in
 * B. That is the Gotcha 1/13 failure exactly: a wrong mixdown reported as a success.
 *
 * Called by `loadInto` (Open, and restoring an autosave) and by New project.
 */
export function resetSessionState(): void {
  engine.stop();
  state.playing = false;
  state.playheadS = 0;
  state.selection = NO_SELECTION;
  state.playRange = null;
  state.soloed.clear();
  state.currentTrackId = null;
}

/** Copy, then paste at the playhead on the current track. Two undo entries, because that is what
 *  the two operations genuinely are — and the paste is the one worth undoing.
 *
 *  The guard matches `copySelection`'s: without it, ⌘D on a time range (or on nothing) copied
 *  nothing and pasted whatever was last on the clipboard — an edit the user never asked for, with
 *  an undo entry to match. The context menu already disabled Duplicate for those selections; the
 *  keyboard path did not. */
export function duplicateSelection(): void {
  if (state.selection.kind !== "clips" || state.selection.clipIds.length === 0) return;
  copySelection();
  pasteAtPlayhead();
}

/**
 * Point the side panel at what the user just touched.
 *
 * ONE rule, no exceptions: a clip shows Clip, a track (its header, or empty lane space) shows
 * Track, and Master is only reached by asking for it. Touching a clip or a track leaves Master,
 * which costs a click when mastering while auditioning — accepted, because "the panel shows what
 * you last touched" is worth more than one workflow's convenience, and mastering is mostly
 * pressing Space rather than clicking clips.
 *
 * Deliberately NOT folded into `setCurrentTrack`: clicking a CLIP sets the current track too, and
 * would then land on the Track tab instead of the clip the user just selected.
 */
export function focusPanel(tab: SidePanelTab): void {
  state.sidePanelTab = tab;
}

/** Is a modal covering the document? Keyboard shortcuts must not reach the timeline behind one:
 *  the document is still there and still editable, and an edit you cannot see is not a feature. */
export function modalOpen(): boolean {
  return state.helpOpen || state.exportOpen;
}
