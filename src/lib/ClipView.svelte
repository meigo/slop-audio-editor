<script lang="ts">
  import type { Clip } from "../doc/document";
  import { clipsInRange } from "../doc/selection";
  import { pool, state as appState } from "../state/appState.svelte";
  import { startClipDrag } from "./clip-drag.svelte";
  import { fadeInCurve, fadeOutCurve } from "../audio/fades";
  import type { DuckPoint } from "../audio/ducking";
  import {
    envelopeMaskPolygon, FADE_MASK_POINTS, fadeMaskPolygon, formatTime, timeToPx,
  } from "./geometry";
  import { hitTestClip, MOUSE_ZONES, TOUCH_ZONES, type ClipZone } from "./hit-test";
  import Waveform from "./Waveform.svelte";

  const {
    clip, trackId, heightPx, duck,
  }: { clip: Clip; trackId: string; heightPx: number; duck: DuckPoint[] } = $props();

  const duckMask = $derived(envelopeMaskPolygon(duck, clip.durS));

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
    return hitTestClip(
      e.clientX - r.left, e.clientY - r.top, r.width, r.height,
      e.pointerType === "touch" ? TOUCH_ZONES : MOUSE_ZONES,
    );
  }

  const CURSORS: Record<ClipZone, string> = {
    body: "grab", trimStart: "ew-resize", trimEnd: "ew-resize",
    fadeIn: "nesw-resize", fadeOut: "nwse-resize",
  };

  function onPointerDown(e: PointerEvent) {
    e.stopPropagation(); // a clip click must not start a range drag on the lane behind it
    const z = zoneAt(e);
    // Shift as well as the platform modifier: Shift is what most people reach for first, and
    // nothing else on a clip uses it at pointer-down (Shift only suppresses snapping once a
    // drag is under way).
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;
    // A plain click INSIDE an existing time-range selection keeps that range, so the drag can
    // move every clip the range covers. Overwriting it here would collapse the selection to this
    // one clip before `startClipDrag` ever sees it, and the box you drew would move one clip.
    const sel = appState.selection;
    if (!additive && sel.kind === "range" && clipsInRange(appState.project, sel.range).includes(clip.id)) {
      startClipDrag(e, clip.id, trackId, z);
      return;
    }
    const current = sel.kind === "clips" ? sel.clipIds : [];
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
<!-- `select-none`: a clip is a drag target, not text. Without it Shift-click (which adds to the
     selection) also extends the browser's TEXT selection, so clip names light up blue as you
     multi-select, and dragging across labels selects them. -->
<div
  data-clip-id={clip.id}
  class="absolute top-1 touch-none select-none overflow-hidden rounded border bg-media-clip
         {selected ? 'border-accent' : 'border-media-clip-border'}"
  title="{name} — {formatTime(clip.durS)}"
  data-hint="Drag to move · ⌘-click or Shift-click to add to the selection · ⌘A selects every clip"
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

  <!-- Ducking: how far this background track is pushed down by the foreground. Drawn as the SAME
       darkening wash as a fade, because it means the same thing — level removed here. It was
       green (tied to the D toggle's badge) which read as a status colour rather than as
       attenuation. The badge still identifies the track; the wash shows the effect. -->
  {#if duckMask}
    <div
      class="pointer-events-none absolute inset-0 bg-ground/55"
      style="clip-path: {duckMask}"
    ></div>
  {/if}

  <!-- Fade overlays: the shaded area is what the fade takes away, traced from the real gain
       curve — linear stays a triangle, equal-power bows, exponential sags. -->
  {#if clip.fadeInS > 0}
    <div
      class="pointer-events-none absolute inset-y-0 left-0 bg-ground/60"
      style="width: {clip.fadeInS * appState.pxPerSecond}px;
             clip-path: {fadeInMask}"
    ></div>
  {/if}
  {#if clip.fadeOutS > 0}
    <div
      class="pointer-events-none absolute inset-y-0 right-0 bg-ground/60"
      style="width: {clip.fadeOutS * appState.pxPerSecond}px;
             clip-path: {fadeOutMask}"
    ></div>
  {/if}

  <span class="pointer-events-none absolute left-1 top-0.5 truncate text-[10px] text-white/80">
    {name}
  </span>
</div>
