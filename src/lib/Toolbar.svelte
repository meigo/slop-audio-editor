<script lang="ts">
  import {
    ArrowLeftToLine, ArrowRightToLine, Download, FilePlus2, FolderOpen, Pause, Play,
    Redo2, Repeat, Save, Scale, Scissors, Square, Undo2, Upload, X,
  } from "@lucide/svelte";
  import { createProject } from "../doc/document";
  import { setDuckDepth, setGlue, setMasterGain, splitAt } from "../doc/edits";
  import { openProjectFile, pruneUnreferencedSources, saveProjectFile } from "../persist/project-io.svelte";
  import {
    amend, beginGesture, canRedoNow, canUndoNow, clearPlayRange, commit, currentTrackId,
    endGesture, engine, importFiles, matchLoudness, pool, reachableProjects, redoEdit, seekTo,
    selectedTrackIds,
    setPlayIn, setPlayOut, state as appState, togglePlay, undoEdit,
  } from "../state/appState.svelte";
  import ExportDialog from "./ExportDialog.svelte";
  import NumberField from "./NumberField.svelte";
  import Meter from "./Meter.svelte";
  import Fader from "./Fader.svelte";
  import { formatTime } from "./geometry";

  let fileInput = $state<HTMLInputElement | null>(null);
  let projectInput = $state<HTMLInputElement | null>(null);
  let fileError = $state<string | null>(null);
  let masterDragging = false;
  let exporting = $state(false);

  // Inline rather than an `@apply` rule: in Tailwind 4 an `@apply` inside a component <style>
  // block needs an `@reference` to the stylesheet in every file, which is more ceremony than
  // one shared string.
  /** Every toolbar control is 24 px tall. Padding alone gave icon buttons 24 px and the text
   *  toggles 20 px, so the row read as two rows of slightly different things. */
  const CONTROL_H = "flex h-6 items-center justify-center rounded";
  const BTN =
    `${CONTROL_H} w-6 text-text hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent`;
  /** A 1px rule between toolbar groups. Whitespace alone reads as accidental at this size. */
  const DIVIDER = "mx-1 h-5 w-px shrink-0 bg-line";
  /** Toggle buttons, not checkboxes: the track headers already say "on" by FILLING (M / S / D),
   *  and two idioms for the same idea in one window is one too many. Text rather than an icon
   *  because "Glue" has no glyph anyone would read correctly — a cryptic icon would trade a
   *  consistency problem for a comprehension one. */
  const toggleClass = (on: boolean): string =>
    `${CONTROL_H} px-2 text-xs ` +
    (on ? "bg-accent font-medium text-ground" : "text-muted hover:bg-raised hover:text-text");
  /** An ICON toggle, same on-state as the text ones. Built as one string rather than layering
   *  `class:text-accent` over `BTN`: both are text-colour utilities of equal specificity, so which
   *  one wins depends on the ORDER TAILWIND EMITS THEM, not on the markup. Loop looked dead for
   *  exactly that reason — it was toggling all along, invisibly. */
  const toggleIconClass = (on: boolean): string =>
    `${CONTROL_H} w-6 ` + (on ? "bg-accent text-ground" : "text-text hover:bg-raised");

  function onMasterGain(g: number) {
    if (!masterDragging) {
      masterDragging = true;
      beginGesture("mix"); // MIX gesture — see TrackHeader
    }
    amend((p) => setMasterGain(p, g));
    engine.setMasterGain(g);
  }
</script>

<div class="flex h-11 items-center gap-3 border-b border-line bg-panel px-2 text-text">
  <div class="flex items-center gap-1">
    <button
      class={BTN}
      title="New project"
      onclick={() => {
        commit(() => createProject());
        // New project is an undoable commit, so the previous document is still reachable —
        // prune only what NO reachable document references, or undo comes back to dead audio.
        void pruneUnreferencedSources(reachableProjects(), pool.records().map((s) => s.id));
      }}
    >
      <FilePlus2 size={16} />
    </button>
    <button class={BTN} title="Open project" onclick={() => projectInput?.click()}>
      <FolderOpen size={16} />
    </button>
    <!-- Unsaved state recolours the glyph and adds a badge that is positioned OUT OF FLOW. The
         dot used to sit in the flow beside the icon, so every save/edit nudged this button and its
         neighbours sideways.
         A broken autosave takes over the same glyph in `warn` rather than adding an indicator of
         its own: this is the button the user needs to press, so the warning belongs ON it. -->
    <button
      class="{BTN} relative"
      title={appState.autosaveBroken
        ? "Autosave unavailable — this session could not be written to browser storage, so it will NOT survive a reload. Save to a file (⌘S)."
        : appState.dirty
          ? "Save project — unsaved changes (⌘S)"
          : "Save project (⌘S)"}
      onclick={saveProjectFile}
    >
      <Save
        size={16}
        class={appState.autosaveBroken ? "text-warn" : appState.dirty ? "text-accent" : undefined}
      />
      {#if appState.dirty}
        <span
          class="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full {appState.autosaveBroken
            ? 'bg-warn'
            : 'bg-accent'}"
        ></span>
      {/if}
    </button>
  </div>
  <input
    bind:this={projectInput}
    type="file"
    accept=".slopaudio,application/zip"
    class="hidden"
    onchange={async (e) => {
      const f = e.currentTarget.files?.[0];
      e.currentTarget.value = "";
      if (!f) return;
      try {
        await openProjectFile(f);
      } catch (err) {
        fileError = err instanceof Error ? err.message : String(err);
      }
    }}
  />
  {#if fileError}
    <span class="text-xs text-danger">{fileError}</span>
  {/if}

  <button class={BTN} title="Import audio into the current track at the playhead — any format this browser can decode (MP3, WAV, M4A/AAC, FLAC, OGG, WebM)" onclick={() => fileInput?.click()}>
    <Download size={16} />
  </button>
  <input
    bind:this={fileInput}
    type="file"
    accept="audio/*"
    multiple
    class="hidden"
    onchange={async (e) => {
      // Copy the File objects OUT before resetting. `e.currentTarget.files` is a LIVE FileList:
      // setting `value = ""` empties that very object (same identity), so a captured reference
      // would read as length 0 and the import would silently do nothing. Individual File objects
      // are independent of the list and survive the reset — which is why the project-open handler
      // below, which grabs `files?.[0]`, was never affected.
      const files = Array.from(e.currentTarget.files ?? []);
      e.currentTarget.value = ""; // reset after copying, so re-picking the same file still works
      if (files.length === 0) return;
      try {
        await importFiles(files, currentTrackId(), appState.playheadS);
      } catch (err) {
        // A decode or autosave-write failure must be visible here, not console-only: this is the
        // main way audio enters the app, and the user needs to know if what they just imported
        // will not survive a reload.
        fileError = err instanceof Error ? err.message : String(err);
      }
    }}
  />

  <div class={DIVIDER}></div>

  <div class="flex items-center gap-1">
    <button class={BTN} title="Play/pause (Space)" onclick={togglePlay}>
      {#if appState.playing}<Pause size={16} />{:else}<Play size={16} />{/if}
    </button>
    <button class={BTN} title="Stop and return the playhead to the start" onclick={() => { if (appState.playing) togglePlay(); seekTo(0); }}>
      <Square size={16} />
    </button>
    <button
      class={toggleIconClass(appState.loop)}
      aria-pressed={appState.loop}
      title="Loop the in/out range, or the whole project (L)"
      onclick={() => (appState.loop = !appState.loop)}
    >
      <Repeat size={16} />
    </button>
    <button class={BTN} title="Set in point at playhead (I)" onclick={() => setPlayIn()}>
      <ArrowLeftToLine size={16} />
    </button>
    <button class={BTN} title="Set out point at playhead (O)" onclick={() => setPlayOut()}>
      <ArrowRightToLine size={16} />
    </button>
    <button
      class={BTN}
      disabled={appState.playRange === null}
      title="Clear in/out range (⌘I)"
      onclick={clearPlayRange}
    >
      <X size={16} />
    </button>
  </div>

  <div class={DIVIDER}></div>

  <span class="w-24 tabular-nums text-sm">{formatTime(appState.playheadS)}</span>

  <div class={DIVIDER}></div>

  <div class="flex items-center gap-1">
    <button class={BTN} disabled={!canUndoNow()} title="Undo (⌘Z)" onclick={undoEdit}>
      <Undo2 size={16} />
    </button>
    <button class={BTN} disabled={!canRedoNow()} title="Redo (⇧⌘Z)" onclick={redoEdit}>
      <Redo2 size={16} />
    </button>
    <button
      class={BTN}
      title="Split at playhead (S)"
      onclick={() => commit((p) => splitAt(p, selectedTrackIds(), appState.playheadS))}
    >
      <Scissors size={16} />
    </button>
  </div>

  <div class={DIVIDER}></div>

  <button
    class={toggleClass(appState.snap)}
    aria-pressed={appState.snap}
    title="Snap edges to clip boundaries, the playhead and t=0 while dragging (hold Shift to override)"
    onclick={() => (appState.snap = !appState.snap)}
  >
    Snap
  </button>

  <button
    class={toggleClass(appState.project.glue)}
    aria-pressed={appState.project.glue}
    title="Band-limit and gently compress the master bus so disparate sources cohere"
    onclick={() => commit((p) => setGlue(p, !appState.project.glue))}
  >
    Glue
  </button>

  <!-- Always mounted, disabled until some track is marked D. It used to be `{#if}`-gated, which
       meant marking a track D made a control appear IN the toolbar row and shoved its neighbours
       sideways — state moving the layout, the one thing the shared timeline styling forbids.
       Disabled still reads as "not for you yet" without the row twitching, and it keeps teaching
       what the D toggle is for. -->
  <div class="flex items-center text-xs">
    <NumberField
      label="Duck"
      value={appState.project.duckDepthDb}
      min={-40}
      suffix="dB"
      disabled={!appState.project.tracks.some((t) => t.ducked)}
      title="How far background (D) tracks dip while another track plays. 0 dB turns ducking off."
      onCommit={(v) => commit((p) => setDuckDepth(p, v))}
    />
  </div>

  <button class={BTN} title="Set every clip's gain so all clips play at the same loudness. Non-destructive: it only changes clip gain, and undo reverses it." onclick={matchLoudness}>
    <Scale size={16} />
  </button>

  <div class={DIVIDER}></div>

  <button class={BTN} title="Mix down to a file (WAV, MP3, M4A or WebM) — solo is ignored, mutes are honoured" onclick={() => (exporting = true)}>
    <Upload size={16} />
  </button>

  <div class="ml-auto flex items-center gap-2 text-xs">
    <span class="text-muted">Master</span>
    <Meter />
    <Fader
      gain={appState.project.masterGain}
      onInput={onMasterGain}
      onCommit={() => { if (masterDragging) { masterDragging = false; endGesture(); } }}
      label="Master volume (dB)"
    />
  </div>
</div>

{#if exporting}
  <ExportDialog onClose={() => (exporting = false)} />
{/if}
