<script lang="ts">
  import type { Clip } from "../doc/document";
  import { clipsInRange } from "../doc/selection";
  import { pool, setCurrentTrack, state as appState } from "../state/appState.svelte";
  import { startClipDrag } from "./clip-drag.svelte";
  import { armLongPress, endLongPress, moveLongPress } from "./long-press";
  import { fadeInCurve, fadeOutCurve } from "../audio/fades";
  import type { DuckPoint } from "../audio/ducking";
  import {
    envelopeAreaPoints,
    envelopeCurvePoints,
    FADE_MASK_POINTS,
    fadeAreaPoints,
    fadeCurvePoints,
    formatTime,
    timeToPx,
  } from "./geometry";
  import { hitTestClip, MOUSE_ZONES, TOUCH_ZONES, type ClipZone } from "./hit-test";
  import Waveform from "./Waveform.svelte";

  const {
    clip,
    trackId,
    heightPx,
    duck,
  }: { clip: Clip; trackId: string; heightPx: number; duck: DuckPoint[] } = $props();

  const duckArea = $derived(envelopeAreaPoints(duck, clip.durS));
  const duckCurve = $derived(envelopeCurvePoints(duck, clip.durS));

  // Sampled from the engine's own fade curves, so the overlay shows the shape that will play.
  const fadeIn = $derived(fadeInCurve(clip.fadeShape, FADE_MASK_POINTS));
  const fadeOut = $derived(fadeOutCurve(clip.fadeShape, FADE_MASK_POINTS));

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
      e.clientX - r.left,
      e.clientY - r.top,
      r.width,
      r.height,
      e.pointerType === "touch" ? TOUCH_ZONES : MOUSE_ZONES,
    );
  }

  const CURSORS: Record<ClipZone, string> = {
    body: "grab",
    trimStart: "ew-resize",
    trimEnd: "ew-resize",
    fadeIn: "nesw-resize",
    fadeOut: "nwse-resize",
  };

  /** Opening a menu on a clip that is NOT part of the selection selects it first; on one that is,
   *  the selection is kept so the action applies to the whole group. That is what makes "select
   *  three, right-click, delete" work. */
  function selectForMenu() {
    const sel = appState.selection;
    const covered =
      (sel.kind === "clips" && sel.clipIds.includes(clip.id)) ||
      (sel.kind === "range" && clipsInRange(appState.project, sel.range).includes(clip.id));
    if (!covered) appState.selection = { kind: "clips", clipIds: [clip.id] };
    setCurrentTrack(trackId);
  }

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
    if (
      !additive &&
      sel.kind === "range" &&
      clipsInRange(appState.project, sel.range).includes(clip.id)
    ) {
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
     multi-select, and dragging across labels selects them.
     `outline` rather than `border`: a border eats 2px of the content box, so the waveform canvas
     (sized from the height prop) and the overlay SVGs (sized to the box) disagreed by a pixel and
     the fade wedges sat off-centre against the waveform. An outline draws in the same place
     without taking any layout. -->
<div
  data-clip-id={clip.id}
  class="absolute top-1 touch-none overflow-hidden rounded bg-media-clip outline -outline-offset-1
         select-none {selected ? 'outline-accent' : 'outline-media-clip-border'}"
  title="{name} — {formatTime(clip.durS)}"
  data-hint="Drag to move · ⌘-click or Shift-click to add to the selection · ⌘A all · ⌘C copy, ⌘X cut, ⌘V paste at the playhead, ⌘D duplicate"
  onpointerdown={(e) => {
    onPointerDown(e); // selects and starts the drag
    armLongPress(e); // touch only; a press held still opens the menu over that selection
  }}
  onpointermove={(e) => {
    zone = zoneAt(e);
    moveLongPress(e);
  }}
  onpointerup={endLongPress}
  onpointercancel={endLongPress}
  oncontextmenu={(e) => {
    e.preventDefault();
    e.stopPropagation();
    selectForMenu();
    appState.contextMenu = { x: e.clientX, y: e.clientY };
  }}
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

  <!-- Both overlays are inset 1px vertically. At silence a fade curve lands exactly on the clip's
       bottom edge, where it shares pixels with the outline and the two read as one thick smudge;
       drawing inside the outline keeps the curve and the clip's own edge legible as separate
       things. -->
  <!-- Ducking: how far this background track is pushed down by the foreground. Drawn as the SAME
       darkening wash as a fade, because it means the same thing — level removed here. It was
       green (tied to the D toggle's badge) which read as a status colour rather than as
       attenuation. The badge still identifies the track; the wash shows the effect. -->
  {#if duckArea}
    <svg
      class="pointer-events-none absolute inset-x-0 inset-y-px h-[calc(100%-2px)] w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={duckArea} class="fill-media-clip/85" />
      <polyline
        points={duckCurve}
        class="stroke-text/70"
        fill="none"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  {/if}

  <!-- Fade overlays. The shaded area is what the fade takes away; the stroked line ON TOP is the
       curve itself, which is what actually makes the SHAPE readable — a wash alone only shows its
       own edge, and against a dark clip that edge is nearly invisible. `viewBox` is a unit box
       with `preserveAspectRatio="none"` so the same 0-100 points work at any clip width, and
       `vector-effect` keeps the stroke 1px however far the box is stretched. -->
  {#each [{ on: clip.fadeInS > 0, curve: fadeIn, w: clip.fadeInS, side: "left" }, { on: clip.fadeOutS > 0, curve: fadeOut, w: clip.fadeOutS, side: "right" }] as f (f.side)}
    {#if f.on}
      <svg
        class="pointer-events-none absolute inset-y-px h-[calc(100%-2px)]
               {f.side === 'left' ? 'left-0' : 'right-0'}"
        style="width: {f.w * appState.pxPerSecond}px"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon points={fadeAreaPoints(f.curve)} class="fill-media-clip/85" />
        <polyline
          points={fadeCurvePoints(f.curve)}
          class="stroke-text/70"
          fill="none"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    {/if}
  {/each}

  <span class="pointer-events-none absolute top-0.5 left-1 truncate text-[10px] text-white/80">
    {name}
  </span>
</div>
