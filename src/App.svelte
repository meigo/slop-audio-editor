<script lang="ts">
  import Playhead from "./lib/Playhead.svelte";
  import Ruler from "./lib/Ruler.svelte";
  import TimelineViewport from "./lib/TimelineViewport.svelte";
  import TrackLane from "./lib/TrackLane.svelte";
  import { importFiles, state as appState } from "./state/appState.svelte";

  /** Left column holding track headers. Fixed so the ruler and lanes share one x origin. */
  const HEADER_W = 176;

  let timelineWidth = $state(0);
</script>

<div class="flex h-full flex-col bg-neutral-900 text-neutral-200">
  <!-- Toolbar lands here in Task 24 -->
  <header class="h-11 shrink-0 border-b border-neutral-700">
    <!-- TEMPORARY: stand-in for the Task 24 toolbar's import control, so there is something to
         look at before then. Task 24 removes this. -->
    <input
      type="file"
      accept="audio/*"
      multiple
      class="m-2 text-xs"
      onchange={(e) => {
        const files = e.currentTarget.files;
        if (files) void importFiles(files, appState.project.tracks[0].id, 0);
      }}
    />
  </header>

  <div class="flex min-h-0 flex-1">
    <div class="shrink-0 border-r border-neutral-700" style="width: {HEADER_W}px">
      <!-- Track headers land here in Task 24 -->
      <div class="h-7 border-b border-neutral-700"></div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col" bind:clientWidth={timelineWidth}>
      <Ruler widthPx={timelineWidth} />
      <TimelineViewport>
        {#each appState.project.tracks as track (track.id)}
          <TrackLane {track} />
        {/each}
        <Playhead />
      </TimelineViewport>
    </div>
  </div>

  <!-- Inspector lands here in Task 25 -->
  <footer class="h-10 shrink-0 border-t border-neutral-700"></footer>
</div>
