<script lang="ts">
  import {
    Download, FilePlus2, FolderOpen, Pause, Play, Plus, Redo2, Repeat, Save, Scissors, Square,
    Undo2, Upload,
  } from "@lucide/svelte";
  import { createProject } from "../doc/document";
  import { addTrack, setMasterGain, splitAt } from "../doc/edits";
  import { openProjectFile, pruneUnreferencedSources, saveProjectFile } from "../persist/project-io.svelte";
  import {
    amend, beginGesture, canRedoNow, canUndoNow, commit, endGesture, engine, importFiles,
    pool, redoEdit, seekTo, selectedTrackIds, state as appState, togglePlay, undoEdit,
  } from "../state/appState.svelte";
  import ExportDialog from "./ExportDialog.svelte";
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
  const BTN =
    "rounded p-1 text-neutral-300 hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent";

  function onMasterGain(g: number) {
    if (!masterDragging) {
      masterDragging = true;
      beginGesture("mix"); // MIX gesture — see TrackHeader
    }
    amend((p) => setMasterGain(p, g));
    engine.setMasterGain(g);
  }
</script>

<div class="flex h-11 items-center gap-3 border-b border-neutral-700 px-2 text-neutral-300">
  <div class="flex items-center gap-1">
    <button
      class={BTN}
      title="New project"
      onclick={() => {
        commit(() => createProject());
        // A fresh project references no sources, so every source the pool still knows about is
        // now an orphan — otherwise these accumulate in IndexedDB forever (see autosave.ts).
        void pruneUnreferencedSources(appState.project, pool.records().map((s) => s.id));
      }}
    >
      <FilePlus2 size={16} />
    </button>
    <button class={BTN} title="Open project" onclick={() => projectInput?.click()}>
      <FolderOpen size={16} />
    </button>
    <button class={BTN} title="Save project (⌘S)" onclick={saveProjectFile}>
      <Save size={16} />
      {#if appState.dirty}<span class="ml-0.5 text-sky-400">•</span>{/if}
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
    <span class="text-xs text-red-400">{fileError}</span>
  {/if}

  <button class={BTN} title="Import audio" onclick={() => fileInput?.click()}>
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
        await importFiles(files, appState.project.tracks[0].id, appState.playheadS);
      } catch (err) {
        // A decode or autosave-write failure must be visible here, not console-only: this is the
        // main way audio enters the app, and the user needs to know if what they just imported
        // will not survive a reload.
        fileError = err instanceof Error ? err.message : String(err);
      }
    }}
  />

  <div class="flex items-center gap-1">
    <button class={BTN} title="Play/pause (Space)" onclick={togglePlay}>
      {#if appState.playing}<Pause size={16} />{:else}<Play size={16} />{/if}
    </button>
    <button class={BTN} title="Stop" onclick={() => { if (appState.playing) togglePlay(); seekTo(0); }}>
      <Square size={16} />
    </button>
    <button
      class={BTN}
      class:text-sky-400={appState.loop}
      title="Loop the selected range (L)"
      onclick={() => (appState.loop = !appState.loop)}
    >
      <Repeat size={16} />
    </button>
  </div>

  <span class="w-24 tabular-nums text-sm">{formatTime(appState.playheadS)}</span>

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
    <button class={BTN} title="Add track" onclick={() => commit((p) => addTrack(p))}>
      <Plus size={16} />
    </button>
  </div>

  <label class="flex items-center gap-1 text-xs">
    <input type="checkbox" bind:checked={appState.snap} /> Snap
  </label>

  <button class={BTN} title="Export mix" onclick={() => (exporting = true)}>
    <Upload size={16} />
  </button>

  <div class="ml-auto flex items-center gap-2 text-xs">
    <span class="text-neutral-500">Master</span>
    <Fader
      gain={appState.project.masterGain}
      onInput={onMasterGain}
      onCommit={() => { if (masterDragging) { masterDragging = false; endGesture(); } }}
    />
  </div>
</div>

{#if exporting}
  <ExportDialog onClose={() => (exporting = false)} />
{/if}
