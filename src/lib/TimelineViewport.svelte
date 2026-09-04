<script lang="ts">
  import { state as appState } from "../state/appState.svelte";
  import { pxToTime } from "./geometry";

  const { children }: { children: import("svelte").Snippet } = $props();

  let el = $state<HTMLDivElement | null>(null);

  const MIN_PX_PER_S = 2;
  const MAX_PX_PER_S = 2000;

  /** Ctrl/Cmd-wheel zooms about the pointer; plain wheel scrolls in time. */
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = el!.getBoundingClientRect();
      const anchorS = pxToTime(e.clientX - rect.left, appState.scrollS, appState.pxPerSecond);
      const next = Math.min(
        MAX_PX_PER_S,
        Math.max(MIN_PX_PER_S, appState.pxPerSecond * Math.pow(1.0015, -e.deltaY)),
      );
      // Keep the time under the pointer pinned while the scale changes.
      appState.scrollS = Math.max(0, anchorS - (e.clientX - rect.left) / next);
      appState.pxPerSecond = next;
    } else {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      appState.scrollS = Math.max(0, appState.scrollS + dx / appState.pxPerSecond);
    }
  }
</script>

<div bind:this={el} class="relative flex-1 overflow-hidden" onwheel={onWheel}>
  {@render children()}
</div>
