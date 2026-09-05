<script lang="ts">
  import { engine, state as appState } from "../state/appState.svelte";
  import { timeToPx } from "./geometry";

  // While playing, the position comes from the audio clock — never from a counter.
  $effect(() => {
    if (!appState.playing) return;
    let raf = 0;
    const tick = () => {
      appState.playheadS = engine.positionS();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const x = $derived(timeToPx(appState.playheadS, appState.scrollS, appState.pxPerSecond));
</script>

<div class="pointer-events-none absolute inset-y-0 z-20 w-px bg-danger" style="left: {x}px">
  <div class="absolute -left-1 top-0 h-2 w-2 bg-danger"></div>
</div>
