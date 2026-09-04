<script lang="ts">
  import { state as appState } from "../state/appState.svelte";
  import { timeToPx } from "./geometry";

  const range = $derived(
    appState.selection.kind === "range" ? appState.selection.range : null,
  );
  const tracks = $derived(new Set(range?.trackIds ?? []));
</script>

{#if range}
  {@const x = timeToPx(range.fromS, appState.scrollS, appState.pxPerSecond)}
  {@const w = (range.toS - range.fromS) * appState.pxPerSecond}
  {#each appState.project.tracks as track, i (track.id)}
    {#if tracks.has(track.id)}
      <div
        class="pointer-events-none absolute z-10 border-x border-sky-300 bg-sky-400/20"
        style="left: {x}px; width: {w}px;
               top: {i * appState.trackHeightPx}px; height: {appState.trackHeightPx}px"
      ></div>
    {/if}
  {/each}
{/if}
