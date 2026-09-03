<script lang="ts">
  import Playhead from "./lib/Playhead.svelte";
  import Ruler from "./lib/Ruler.svelte";
  import TimelineViewport from "./lib/TimelineViewport.svelte";

  /** Left column holding track headers. Fixed so the ruler and lanes share one x origin. */
  const HEADER_W = 176;

  let timelineWidth = $state(0);
</script>

<div class="flex h-full flex-col bg-neutral-900 text-neutral-200">
  <!-- Toolbar lands here in Task 24 -->
  <header class="h-11 shrink-0 border-b border-neutral-700"></header>

  <div class="flex min-h-0 flex-1">
    <div class="shrink-0 border-r border-neutral-700" style="width: {HEADER_W}px">
      <!-- Track headers land here in Task 24 -->
      <div class="h-7 border-b border-neutral-700"></div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col" bind:clientWidth={timelineWidth}>
      <Ruler widthPx={timelineWidth} />
      <TimelineViewport>
        <!-- Track lanes land here in Task 22 -->
        <Playhead />
      </TimelineViewport>
    </div>
  </div>

  <!-- Inspector lands here in Task 25 -->
  <footer class="h-10 shrink-0 border-t border-neutral-700"></footer>
</div>
