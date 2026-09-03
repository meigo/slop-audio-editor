<script lang="ts">
  import type { Clip } from "../doc/document";
  import { pool, state as appState } from "../state/appState.svelte";
  import { timeToPx } from "./geometry";
  import Waveform from "./Waveform.svelte";

  const { clip, heightPx }: { clip: Clip; heightPx: number } = $props();

  const x = $derived(timeToPx(clip.startS, appState.scrollS, appState.pxPerSecond));
  const w = $derived(clip.durS * appState.pxPerSecond);
  const selected = $derived(
    appState.selection.kind === "clips" && appState.selection.clipIds.includes(clip.id),
  );
  // A source can be missing (e.g. a project opened without its media): render a labelled clip
  // rather than throwing, so one bad clip does not take down the whole timeline.
  const name = $derived(pool.get(clip.sourceId)?.name ?? "missing audio");
</script>

<div
  data-clip-id={clip.id}
  class="absolute top-1 overflow-hidden rounded border bg-sky-800/70"
  class:border-sky-300={selected}
  class:border-sky-900={!selected}
  style="left: {x}px; width: {w}px; height: {heightPx - 8}px"
>
  <Waveform
    sourceId={clip.sourceId}
    inS={clip.inS}
    durS={clip.durS}
    widthPx={w}
    heightPx={heightPx - 8}
  />

  <!-- Fade overlays: triangles standing in for the gain ramp, drawn over the waveform. -->
  {#if clip.fadeInS > 0}
    <div
      class="pointer-events-none absolute inset-y-0 left-0 bg-neutral-900/60"
      style="width: {clip.fadeInS * appState.pxPerSecond}px;
             clip-path: polygon(0 0, 100% 0, 0 100%)"
    ></div>
  {/if}
  {#if clip.fadeOutS > 0}
    <div
      class="pointer-events-none absolute inset-y-0 right-0 bg-neutral-900/60"
      style="width: {clip.fadeOutS * appState.pxPerSecond}px;
             clip-path: polygon(100% 0, 100% 100%, 0 0)"
    ></div>
  {/if}

  <span class="pointer-events-none absolute left-1 top-0.5 truncate text-[10px] text-white/80">
    {name}
  </span>
</div>
