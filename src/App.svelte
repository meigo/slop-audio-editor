<script lang="ts">
  import Inspector from "./lib/Inspector.svelte";
  import KeyboardShortcuts from "./lib/KeyboardShortcuts.svelte";
  import Playhead from "./lib/Playhead.svelte";
  import RangeOverlay from "./lib/RangeOverlay.svelte";
  import Ruler from "./lib/Ruler.svelte";
  import TimelineViewport from "./lib/TimelineViewport.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import TrackHeader from "./lib/TrackHeader.svelte";
  import TrackLane from "./lib/TrackLane.svelte";
  import { PROJECT_FILE_EXT } from "./persist/project-file";
  import { openProjectFile, restoreAutosave, saveProjectFile } from "./persist/project-io.svelte";
  import { importFiles, state as appState } from "./state/appState.svelte";

  /** Left column holding track headers. Fixed so the ruler and lanes share one x origin. */
  const HEADER_W = 176;

  let timelineWidth = $state(0);
  let loadError = $state<string | null>(null);

  // Runs once on mount: pull yesterday's session back in before the user touches anything.
  $effect(() => {
    void restoreAutosave().catch((err) => {
      // A corrupt or half-written autosave must not look like "your work vanished". The editor is
      // still usable with an empty project, so degrade to that — but say what happened, or the
      // user has no way to tell a restore failure from never having had a session at all.
      loadError =
        "Could not restore your last session: " +
        (err instanceof Error ? err.message : String(err));
    });
  });

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    const projectFile = files.find((f) => f.name.endsWith(PROJECT_FILE_EXT));
    try {
      if (projectFile) await openProjectFile(projectFile);
      else await importFiles(files, appState.project.tracks[0].id, appState.playheadS);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative flex h-full flex-col bg-neutral-900 text-neutral-200"
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  {#if appState.importing}
    <div class="absolute inset-x-0 top-0 z-50 bg-sky-700 px-2 py-1 text-xs">
      Loading {appState.importing.name} — {Math.round(appState.importing.fraction * 100)}%
    </div>
  {/if}
  {#if loadError}
    <button
      class="absolute inset-x-0 top-0 z-50 bg-red-800 px-2 py-1 text-left text-xs"
      onclick={() => (loadError = null)}
    >
      {loadError} — click to dismiss
    </button>
  {/if}

  <KeyboardShortcuts onSave={saveProjectFile} viewportWidthPx={timelineWidth} />
  <Toolbar />

  <div class="flex min-h-0 flex-1">
    <div class="shrink-0 border-r border-neutral-700" style="width: {HEADER_W}px">
      <div class="h-7 border-b border-neutral-700"></div>
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
</div>
