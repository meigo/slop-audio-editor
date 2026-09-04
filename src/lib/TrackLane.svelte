<script lang="ts">
  import type { Track } from "../doc/document";
  import { state as appState } from "../state/appState.svelte";
  import ClipView from "./ClipView.svelte";
  import { startRangeDrag } from "./clip-drag.svelte";

  const { track }: { track: Track } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-track-id={track.id}
  class="relative border-b border-neutral-800 bg-neutral-900"
  style="height: {appState.trackHeightPx}px"
  onpointerdown={(e) => startRangeDrag(e, track.id)}
>
  {#each track.clips as clip (clip.id)}
    <ClipView {clip} trackId={track.id} heightPx={appState.trackHeightPx} />
  {/each}
</div>
