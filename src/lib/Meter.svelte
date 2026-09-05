<script lang="ts">
  import { amplitudeToDbfs } from "../audio/peak";
  import { engine, state as appState } from "../state/appState.svelte";
  import { meterFillPct } from "./geometry";

  /** Peak-hold fall rate, dB per second. Slow enough to read a transient, fast enough to follow. */
  const DECAY_DB_PER_S = 24;

  let peakDb = $state(-Infinity);
  let holdDb = $state(-Infinity);
  /** Latches on an over and STAYS latched until clicked: an over lasting three samples is the
   *  thing you most need to know about and the thing a decaying meter is most likely to hide. */
  let clipped = $state(false);

  $effect(() => {
    if (!appState.playing) {
      peakDb = -Infinity;
      holdDb = -Infinity;
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      const db = amplitudeToDbfs(engine.peakLevel());
      peakDb = db;
      if (db >= 0) clipped = true;
      holdDb = db > holdDb ? db : Math.max(db, holdDb - DECAY_DB_PER_S * dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<button
  type="button"
  class="flex h-6 items-center gap-1"
  title="Master output level. Red means the mix went over 0 dBFS and will clip — click to reset."
  onclick={() => (clipped = false)}
>
  <div class="relative h-2 w-24 overflow-hidden rounded-sm bg-raised">
    <div
      class="absolute inset-y-0 left-0 {peakDb >= -1 ? 'bg-danger' : 'bg-ok'}"
      style="width: {meterFillPct(peakDb)}%"
    ></div>
    {#if holdDb > -Infinity}
      <div class="absolute inset-y-0 w-0.5 bg-text" style="left: {meterFillPct(holdDb)}%"></div>
    {/if}
  </div>
  <span
    class="w-3 rounded-sm text-center text-[9px] leading-3 {clipped
      ? 'bg-danger text-white'
      : 'text-muted'}">●</span
  >
</button>
