<script lang="ts">
  import { aggregatePeaks } from "../audio/peaks";
  import { PEAK_SAMPLES_PER_PAIR, PROJECT_SAMPLE_RATE } from "../doc/document";
  import { pool } from "../state/appState.svelte";

  const {
    sourceId, inS, durS, widthPx, heightPx,
  }: { sourceId: string; inS: number; durS: number; widthPx: number; heightPx: number } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    const el = canvas;
    const source = pool.get(sourceId);
    const w = Math.max(1, Math.round(widthPx));
    const h = Math.max(1, Math.round(heightPx));
    if (!el || !source) return;

    // The backing store is sized in DEVICE pixels and then scaled back down via setTransform, so
    // drawing coordinates below stay in CSS pixels while the canvas is crisp on a retina display.
    const dpr = window.devicePixelRatio || 1;
    el.width = w * dpr;
    el.height = h * dpr;
    const ctx = el.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // One [min, max] pair per pixel column, re-aggregated from the source's full-resolution peaks
    // on every redraw — this is what makes zooming in reveal detail rather than stretch pixels.
    const peaks = aggregatePeaks(
      source.peaks, PROJECT_SAMPLE_RATE, PEAK_SAMPLES_PER_PAIR, inS, inS + durS, w,
    );
    const mid = h / 2;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let col = 0; col < w; col++) {
      const min = peaks[col * 2];
      const max = peaks[col * 2 + 1];
      const y0 = mid - max * mid;
      const y1 = mid - min * mid;
      ctx.fillRect(col, y0, 1, Math.max(1, y1 - y0));
    }
  });
</script>

<canvas
  bind:this={canvas}
  class="pointer-events-none absolute inset-0 h-full w-full"
  style="width: {widthPx}px; height: {heightPx}px"
></canvas>
