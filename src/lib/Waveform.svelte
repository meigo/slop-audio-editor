<script lang="ts">
  import { aggregatePeaks } from "../audio/peaks";
  import { PEAK_SAMPLES_PER_PAIR, PROJECT_SAMPLE_RATE } from "../doc/document";
  import { pool } from "../state/appState.svelte";

  const {
    sourceId,
    inS,
    durS,
    widthPx,
    heightPx,
    gain,
  }: {
    sourceId: string;
    inS: number;
    durS: number;
    widthPx: number;
    heightPx: number;
    gain: number;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);

  /** The clip's own edge is an `outline` at `-outline-offset-1`, so it occupies the outermost
   *  pixel of the box. `widthPx`/`heightPx` describe that whole box, and a canvas filling it
   *  painted its first and last columns — and a full-scale sample's top and bottom — straight over
   *  that outline, so the border and the waveform read as one thick smudge. Drawing 1px inside on
   *  every side is the same rule the fade and duck overlays already follow. */
  const INSET_PX = 1;
  const drawW = $derived(Math.max(1, Math.round(widthPx - 2 * INSET_PX)));
  const drawH = $derived(Math.max(1, Math.round(heightPx - 2 * INSET_PX)));

  $effect(() => {
    const el = canvas;
    const source = pool.get(sourceId);
    const w = drawW;
    const h = drawH;
    const g = gain; // read in the tracked scope: redraw on Match loudness (or any gain edit)
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
      source.peaks,
      PROJECT_SAMPLE_RATE,
      PEAK_SAMPLES_PER_PAIR,
      inS,
      inS + durS,
      w,
    );
    const mid = h / 2;
    // Slate ink, not white: the clip's NAME is drawn over this, and white-on-white left the
    // label at 2.4:1 against the waveform. Slate-400 at the same alpha puts it at 4.7:1.
    ctx.fillStyle = "rgba(148,163,184,0.55)";
    for (let col = 0; col < w; col++) {
      // The waveform shows what you will HEAR, not the raw source: scale by the clip's gain, then
      // clamp to +-1 so a boosted clip visibly hits the ceiling instead of drawing outside its box.
      const min = Math.max(-1, Math.min(1, peaks[col * 2] * g));
      const max = Math.max(-1, Math.min(1, peaks[col * 2 + 1] * g));
      const y0 = mid - max * mid;
      const y1 = mid - min * mid;
      ctx.fillRect(col, y0, 1, Math.max(1, y1 - y0));
    }
  });
</script>

<canvas
  bind:this={canvas}
  class="pointer-events-none absolute inset-px"
  style="width: {drawW}px; height: {drawH}px"
></canvas>
