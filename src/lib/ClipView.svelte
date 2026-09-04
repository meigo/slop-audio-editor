<script lang="ts">
  import type { Clip } from "../doc/document";
  import { pool, state as appState } from "../state/appState.svelte";
  import { startClipDrag } from "./clip-drag.svelte";
  import { fadeInCurve, fadeOutCurve } from "../audio/fades";
  import { FADE_MASK_POINTS, fadeMaskPolygon, formatTime, timeToPx } from "./geometry";
  import { hitTestClip, type ClipZone } from "./hit-test";
  import Waveform from "./Waveform.svelte";

  const { clip, trackId, heightPx }: { clip: Clip; trackId: string; heightPx: number } = $props();

  // Sampled from the engine's own fade curves, so the overlay shows the shape that will play.
  const fadeInMask = $derived(fadeMaskPolygon(fadeInCurve(clip.fadeShape, FADE_MASK_POINTS)));
  const fadeOutMask = $derived(fadeMaskPolygon(fadeOutCurve(clip.fadeShape, FADE_MASK_POINTS)));

  const x = $derived(timeToPx(clip.startS, appState.scrollS, appState.pxPerSecond));
  const w = $derived(clip.durS * appState.pxPerSecond);
  const selected = $derived(
    appState.selection.kind === "clips" && appState.selection.clipIds.includes(clip.id),
  );
  // A source can be missing (e.g. a project opened without its media): render a labelled clip
  // rather than throwing, so one bad clip does not take down the whole timeline.
  const name = $derived(pool.get(clip.sourceId)?.name ?? "missing audio");

  let zone = $state<ClipZone>("body");

  function zoneAt(e: PointerEvent): ClipZone {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return hitTestClip(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  }

  const CURSORS: Record<ClipZone, string> = {
    body: "grab", trimStart: "ew-resize", trimEnd: "ew-resize",
    fadeIn: "nesw-resize", fadeOut: "nwse-resize",
  };

  function onPointerDown(e: PointerEvent) {
    e.stopPropagation(); // a clip click must not start a range drag on the lane behind it
    const z = zoneAt(e);
    const additive = e.metaKey || e.ctrlKey;
    const current =
      appState.selection.kind === "clips" ? appState.selection.clipIds : [];
    appState.selection = {
      kind: "clips",
      clipIds: additive
        ? current.includes(clip.id)
          ? current.filter((id) => id !== clip.id)
          : [...current, clip.id]
        : current.includes(clip.id)
          ? current
          : [clip.id],
    };
    startClipDrag(e, clip.id, trackId, z);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-clip-id={clip.id}
  class="absolute top-1 overflow-hidden rounded border bg-sky-800/70"
  class:border-sky-300={selected}
  class:border-sky-900={!selected}
  title="{name} — {formatTime(clip.durS)}"
  onpointerdown={onPointerDown}
  onpointermove={(e) => (zone = zoneAt(e))}
  style="left: {x}px; width: {w}px; height: {heightPx - 8}px; cursor: {CURSORS[zone]}"
>
  <Waveform
    sourceId={clip.sourceId}
    inS={clip.inS}
    durS={clip.durS}
    widthPx={w}
    heightPx={heightPx - 8}
    gain={clip.gain}
  />

  <!-- Fade overlays: the shaded area is what the fade takes away, traced from the real gain
       curve — linear stays a triangle, equal-power bows, exponential sags. -->
  {#if clip.fadeInS > 0}
    <div
      class="pointer-events-none absolute inset-y-0 left-0 bg-neutral-900/60"
      style="width: {clip.fadeInS * appState.pxPerSecond}px;
             clip-path: {fadeInMask}"
    ></div>
  {/if}
  {#if clip.fadeOutS > 0}
    <div
      class="pointer-events-none absolute inset-y-0 right-0 bg-neutral-900/60"
      style="width: {clip.fadeOutS * appState.pxPerSecond}px;
             clip-path: {fadeOutMask}"
    ></div>
  {/if}

  <span class="pointer-events-none absolute left-1 top-0.5 truncate text-[10px] text-white/80">
    {name}
  </span>
</div>
