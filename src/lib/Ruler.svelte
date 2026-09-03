<script lang="ts">
  import { seekTo, state as appState } from "../state/appState.svelte";
  import { formatTime, pxToTime, rulerTicks, timeToPx } from "./geometry";

  const { widthPx }: { widthPx: number } = $props();

  const toS = $derived(appState.scrollS + widthPx / appState.pxPerSecond);
  const ticks = $derived(rulerTicks(appState.scrollS, toS, appState.pxPerSecond));

  let el = $state<HTMLDivElement | null>(null);
  let dragging = $state(false);

  function seekFromEvent(e: PointerEvent) {
    const rect = el!.getBoundingClientRect();
    seekTo(pxToTime(e.clientX - rect.left, appState.scrollS, appState.pxPerSecond));
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    el!.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={el}
  class="relative h-7 shrink-0 cursor-text select-none border-b border-neutral-700 bg-neutral-800"
  onpointerdown={onPointerDown}
  onpointermove={(e) => dragging && seekFromEvent(e)}
  onpointerup={(e) => {
    dragging = false;
    el!.releasePointerCapture(e.pointerId);
  }}
>
  {#each ticks as tick (tick.s)}
    {@const x = timeToPx(tick.s, appState.scrollS, appState.pxPerSecond)}
    <div
      class="absolute bottom-0 w-px bg-neutral-600"
      class:h-2={!tick.major}
      class:h-3={tick.major}
      style="left: {x}px"
    ></div>
    {#if tick.major}
      <span class="absolute top-0.5 text-[10px] text-neutral-400" style="left: {x + 3}px">
        {formatTime(tick.s)}
      </span>
    {/if}
  {/each}
</div>
