<script lang="ts">
  import { Plus, Rows2, Rows3, Rows4, Trash2 } from "@lucide/svelte";
  import { addTrack, removeTrack } from "./doc/edits";
  import { TRACK_HEIGHTS } from "./persist/preferences";
  import ContextMenu from "./lib/ContextMenu.svelte";
  import KeyboardShortcuts from "./lib/KeyboardShortcuts.svelte";
  import SidePanel from "./lib/SidePanel.svelte";
  import Playhead from "./lib/Playhead.svelte";
  import MasterFadeOverlay from "./lib/MasterFadeOverlay.svelte";
  import RangeOverlay from "./lib/RangeOverlay.svelte";
  import Ruler from "./lib/Ruler.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import TimelineViewport from "./lib/TimelineViewport.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import TrackHeader from "./lib/TrackHeader.svelte";
  import TrackLane from "./lib/TrackLane.svelte";
  import { PROJECT_FILE_EXT } from "./persist/project-file";
  import { openProjectFile, restoreAutosave, saveProjectFile } from "./persist/project-io.svelte";
  import {
    commit,
    currentTrackId,
    cycleTrackHeight,
    importFiles,
    markRestoreSettled,
    state as appState,
  } from "./state/appState.svelte";

  /** Left column holding track headers. Fixed so the ruler and lanes share one x origin. */
  const HEADER_W = 176;

  const HEIGHT_LABEL = ["short", "medium", "tall"];
  /** Which preset the current height is at or below. A restored value ABOVE the largest preset
   *  has no match, and must read as the tallest — falling back to index 0 would label a 176 px
   *  track "short". */
  const heightIndex = $derived.by(() => {
    const i = TRACK_HEIGHTS.findIndex((h) => appState.trackHeightPx <= h);
    return i === -1 ? TRACK_HEIGHTS.length - 1 : i;
  });

  /** `removeTrack` refuses to remove the last track — `resolveTrackId` and `currentTrackId()`
   *  rely on a project always having one — so disable the control rather than offer a click that
   *  silently does nothing. */
  const onlyOneTrack = $derived(appState.project.tracks.length <= 1);
  const currentTrackName = $derived(
    appState.project.tracks.find((t) => t.id === currentTrackId())?.name ?? "",
  );

  let timelineWidth = $state(0);

  // Runs once on mount: pull yesterday's session back in before the user touches anything.
  $effect(() => {
    void restoreAutosave()
      .catch((err) => {
        // A corrupt or half-written autosave must not look like "your work vanished". The editor
        // is still usable with an empty project, so degrade to that — but say what happened, or
        // the user has no way to tell a restore failure from never having had a session at all.
        appState.fileError =
          "Could not restore your last session: " +
          (err instanceof Error ? err.message : String(err));
      })
      .finally(() => markRestoreSettled());
  });

  /** Drop targets the track under the cursor — pointing at a track IS the instruction — falling
   *  back to the resolved current track when the drop lands outside any lane (e.g. on the ruler
   *  or the header column). */
  function dropTargetTrackId(e: DragEvent): string {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-track-id]");
    return (el as HTMLElement | null)?.dataset.trackId ?? currentTrackId();
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    const projectFile = files.find((f) => f.name.endsWith(PROJECT_FILE_EXT));
    appState.fileError = null; // a successful retry must clear the last failure
    try {
      if (projectFile) await openProjectFile(projectFile);
      else await importFiles(files, dropTargetTrackId(e), appState.playheadS);
    } catch (err) {
      appState.fileError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative flex h-full flex-col bg-ground text-text"
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  {#if appState.importing}
    <div class="absolute inset-x-0 top-0 z-50 bg-accent px-2 py-1 text-xs">
      Loading {appState.importing.name} — {Math.round(appState.importing.fraction * 100)}%
    </div>
  {/if}
  <!-- ONE banner for every file error — restoring an autosave, opening a project, importing
       audio. Absolutely positioned, so it cannot move anything: the toolbar used to carry the
       open/import errors as a `<span>` in its own flow, which shoved every control to its right
       and, with nothing ever clearing it, left them there for the session. -->
  {#if appState.fileError}
    <button
      class="absolute inset-x-0 top-0 z-50 bg-danger/25 px-2 py-1 text-left text-xs"
      onclick={() => (appState.fileError = null)}
    >
      {appState.fileError} — click to dismiss
    </button>
  {/if}

  <KeyboardShortcuts onSave={saveProjectFile} viewportWidthPx={timelineWidth} />
  <Toolbar />

  <div class="flex min-h-0 flex-1">
    <div class="shrink-0 border-r border-line bg-panel" style="width: {HEADER_W}px">
      <!-- The strip that aligns with the ruler was dead space. Both controls here act on the
           track COLUMN, so they live together rather than one of them being marooned in the
           toolbar; and unlike a row under the last header, this does not move as tracks are
           added. -->
      <div class="flex h-7 items-center border-b border-line">
        <button
          class="flex flex-1 items-center gap-1.5 self-stretch px-2 text-left text-[11px]
                 text-muted hover:bg-raised hover:text-text"
          title="Add an empty track below the last one"
          onclick={() => commit((p) => addTrack(p))}
        >
          <Plus size={13} />
          Add track
        </button>
        <!-- Deletes the CURRENT track, the one marked in the header column. It lives here rather
             than in each header for two reasons: a per-track control revealed on hover inserts
             itself into the flow and shoves M/S/D sideways, and a destructive action is better
             away from flags that get clicked constantly. It pairs with Add track. -->
        <button
          class="self-stretch px-2 text-muted hover:bg-raised hover:text-danger
                 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
          disabled={onlyOneTrack}
          title={onlyOneTrack
            ? "Delete track — a project must keep at least one track"
            : `Delete "${currentTrackName}" and its clips (undoable)`}
          onclick={() => commit((p) => removeTrack(p, currentTrackId()))}
        >
          <Trash2 size={13} />
        </button>
        <button
          class="self-stretch px-2 text-muted hover:bg-raised hover:text-text"
          title="Track height: {HEIGHT_LABEL[heightIndex]} — click for the next size"
          onclick={cycleTrackHeight}
        >
          {#if heightIndex === 0}<Rows4 size={14} />
          {:else if heightIndex === 1}<Rows3 size={14} />
          {:else}<Rows2 size={14} />{/if}
        </button>
      </div>
      {#each appState.project.tracks as track (track.id)}
        <TrackHeader {track} />
      {/each}
    </div>

    <!-- `relative overflow-hidden`: the playhead lives at THIS level, not inside the viewport, so
         that it spans the ruler as well as the lanes — which means the clipping the viewport used
         to provide has to move up here too. It also contains the ruler, whose in/out markers were
         previously free to draw over the track-header column once scrolled off the left edge. -->
    <div
      class="relative flex min-w-0 flex-1 flex-col overflow-hidden"
      bind:clientWidth={timelineWidth}
    >
      <Ruler widthPx={timelineWidth} />
      <TimelineViewport>
        {#each appState.project.tracks as track (track.id)}
          <TrackLane {track} />
        {/each}
        <MasterFadeOverlay />
        <RangeOverlay />
      </TimelineViewport>
      <Playhead />
    </div>

    <SidePanel />
  </div>

  <StatusBar />
  <ContextMenu />
</div>
