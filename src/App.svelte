<script lang="ts">
  import { Plus, Rows2, Rows3, Rows4 } from "@lucide/svelte";
  import { addTrack } from "./doc/edits";
  import { TRACK_HEIGHTS } from "./persist/preferences";
  import Inspector from "./lib/Inspector.svelte";
  import KeyboardShortcuts from "./lib/KeyboardShortcuts.svelte";
  import Playhead from "./lib/Playhead.svelte";
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
    commit, currentTrackId, cycleTrackHeight, importFiles, markRestoreSettled,
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

  let timelineWidth = $state(0);
  let loadError = $state<string | null>(null);

  // Runs once on mount: pull yesterday's session back in before the user touches anything.
  $effect(() => {
    void restoreAutosave()
      .catch((err) => {
        // A corrupt or half-written autosave must not look like "your work vanished". The editor
        // is still usable with an empty project, so degrade to that — but say what happened, or
        // the user has no way to tell a restore failure from never having had a session at all.
        loadError =
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
    try {
      if (projectFile) await openProjectFile(projectFile);
      else await importFiles(files, dropTargetTrackId(e), appState.playheadS);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
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
  {#if loadError}
    <button
      class="absolute inset-x-0 top-0 z-50 bg-danger/25 px-2 py-1 text-left text-xs"
      onclick={() => (loadError = null)}
    >
      {loadError} — click to dismiss
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

    <div class="flex min-w-0 flex-1 flex-col" bind:clientWidth={timelineWidth}>
      <Ruler widthPx={timelineWidth} />
      <TimelineViewport>
        {#each appState.project.tracks as track (track.id)}
          <TrackLane {track} />
        {/each}
        <RangeOverlay />
        <Playhead />
      </TimelineViewport>
    </div>
  </div>

  <Inspector />
  <StatusBar />
</div>
