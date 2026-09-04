<script lang="ts">
  import { setPlayIn, setPlayOut, seekTo, state as appState } from "../state/appState.svelte";
  import { formatTime, pxToTime, rulerTicks, timeToPx } from "./geometry";
  import { hitTestRuler } from "./hit-test";

  const { widthPx }: { widthPx: number } = $props();

  const toS = $derived(appState.scrollS + widthPx / appState.pxPerSecond);
  const ticks = $derived(rulerTicks(appState.scrollS, toS, appState.pxPerSecond));

  let el = $state<HTMLDivElement | null>(null);

  function timeAtClientX(clientX: number): number {
    const rect = el!.getBoundingClientRect();
    return pxToTime(clientX - rect.left, appState.scrollS, appState.pxPerSecond);
  }

  /** Current marker x-positions in ruler-local pixels, `null` when a marker isn't set. */
  function markerPx(): { inPx: number | null; outPx: number | null } {
    const r = appState.playRange;
    return {
      inPx: r ? timeToPx(r.fromS, appState.scrollS, appState.pxPerSecond) : null,
      outPx: r ? timeToPx(r.toS, appState.scrollS, appState.pxPerSecond) : null,
    };
  }

  /**
   * The zone is decided ONCE at pointerdown (`hitTestRuler`) and reused for the whole gesture,
   * the same convention `ClipView`/`clip-drag.svelte.ts` use for clip zones: a handle starts a
   * drag that moves that marker (through `setIn`/`setOut`, via `setPlayIn`/`setPlayOut`, so the
   * clamping rules apply); anything else seeks exactly as it does today.
   */
  function onPointerDown(e: PointerEvent) {
    const rect = el!.getBoundingClientRect();
    const { inPx, outPx } = markerPx();
    // A fingertip needs a wider grab band than a cursor for the in/out handles.
    const zone = hitTestRuler(e.clientX - rect.left, inPx, outPx, e.pointerType === "touch" ? 22 : undefined);
    el!.setPointerCapture(e.pointerId);

    function apply(clientX: number) {
      const atS = timeAtClientX(clientX);
      if (zone === "in") setPlayIn(atS);
      else if (zone === "out") setPlayOut(atS);
      else seekTo(atS);
    }

    apply(e.clientX);

    function onMove(ev: PointerEvent) {
      apply(ev.clientX);
    }

    function onUp(ev: PointerEvent) {
      el!.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={el}
  class="relative h-7 shrink-0 cursor-text touch-none select-none border-b border-neutral-700 bg-neutral-800"
  onpointerdown={onPointerDown}
>
  {#if appState.playRange}
    {@const range = appState.playRange}
    {@const ix = timeToPx(range.fromS, appState.scrollS, appState.pxPerSecond)}
    {@const ox = timeToPx(range.toS, appState.scrollS, appState.pxPerSecond)}
    <div
      class="pointer-events-none absolute inset-y-0 bg-amber-400/20"
      style="left: {ix}px; width: {ox - ix}px"
    ></div>
    <div class="pointer-events-none absolute inset-y-0 w-1 bg-amber-400" style="left: {ix - 2}px"></div>
    <div class="pointer-events-none absolute inset-y-0 w-1 bg-amber-400" style="left: {ox - 2}px"></div>
    <span
      class="pointer-events-none absolute bottom-0.5 text-[9px] font-bold text-amber-300"
      style="left: {ix + 3}px"
    >I</span>
    <span
      class="pointer-events-none absolute bottom-0.5 text-[9px] font-bold text-amber-300"
      style="left: {ox - 9}px"
    >O</span>
  {/if}
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
