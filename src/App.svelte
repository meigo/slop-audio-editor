<script lang="ts">
  import Inspector from "./lib/Inspector.svelte";
  import Playhead from "./lib/Playhead.svelte";
  import RangeOverlay from "./lib/RangeOverlay.svelte";
  import Ruler from "./lib/Ruler.svelte";
  import TimelineViewport from "./lib/TimelineViewport.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import TrackHeader from "./lib/TrackHeader.svelte";
  import TrackLane from "./lib/TrackLane.svelte";
  import { state as appState } from "./state/appState.svelte";

  /** Left column holding track headers. Fixed so the ruler and lanes share one x origin. */
  const HEADER_W = 176;

  let timelineWidth = $state(0);
</script>

<div class="flex h-full flex-col bg-neutral-900 text-neutral-200">
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
