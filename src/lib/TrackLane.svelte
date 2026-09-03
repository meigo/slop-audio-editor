<script lang="ts">
  import type { Track } from "../doc/document";
  import { state as appState } from "../state/appState.svelte";
  import ClipView from "./ClipView.svelte";

  const { track }: { track: Track } = $props();
</script>

<div
  data-track-id={track.id}
  class="relative border-b border-neutral-800 bg-neutral-900"
  style="height: {appState.trackHeightPx}px"
>
  {#each track.clips as clip (clip.id)}
    <ClipView {clip} heightPx={appState.trackHeightPx} />
  {/each}
</div>
