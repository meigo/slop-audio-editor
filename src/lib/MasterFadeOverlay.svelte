<script lang="ts">
  import { projectDurationS } from "../doc/document";
  import { fadeInCurve, fadeOutCurve } from "../audio/fades";
  import { MASTER_FADE_SHAPE } from "../audio/schedule";
  import { state as appState } from "../state/appState.svelte";
  import { FADE_MASK_POINTS, fadeAreaPoints, fadeCurvePoints, timeToPx } from "./geometry";

  const endS = $derived(projectDurationS(appState.project));
  /** Clamped the same way the engine clamps them, so the picture cannot promise a longer fade
   *  than the project can give. */
  const inS = $derived(Math.min(appState.project.fadeInS, endS));
  const outS = $derived(Math.min(appState.project.fadeOutS, endS));

  /** Only as tall as the TRACKS, not the viewport. The lanes end where the last track does and
   *  everything below is empty space — a curve sweeping through that reads as a stray diagonal
   *  rather than as something applied to the material. */
  const lanesH = $derived(appState.project.tracks.length * appState.trackHeightPx);

  /** Traced from the ENGINE's own curves and its own shape constant — not triangles that happen to
   *  look similar. Same rule the clip fades follow: derive the picture from what will be heard, or
   *  the two drift and nobody notices. */
  const fades = $derived(
    [
      {
        on: inS > 0,
        startS: 0,
        lenS: inS,
        curve: fadeInCurve(MASTER_FADE_SHAPE, FADE_MASK_POINTS),
      },
      {
        on: outS > 0,
        startS: endS - outS,
        lenS: outS,
        curve: fadeOutCurve(MASTER_FADE_SHAPE, FADE_MASK_POINTS),
      },
    ].filter((f) => f.on && f.lenS > 0),
  );
</script>

<!-- Across every lane, because the mix fade is a MASTER effect: drawing it on the last clip would
     say that clip is fading, when everything still playing is.
     The explicit height is NOT redundant with the absolute positioning. An `<svg>` is a REPLACED
     element, so with a width set and no height its `viewBox` aspect ratio wins — the box came out
     exactly as tall as it was wide, which fixed the curve's on-screen angle and made a longer fade
     a wider copy of the same shape instead of a shallower one. -->
{#each fades as fade (fade.startS)}
  <svg
    class="pointer-events-none absolute top-0 z-10"
    style="left: {timeToPx(fade.startS, appState.scrollS, appState.pxPerSecond)}px;
           width: {fade.lenS * appState.pxPerSecond}px; height: {lanesH}px"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <polygon points={fadeAreaPoints(fade.curve)} class="fill-ground/70" />
    <polyline
      points={fadeCurvePoints(fade.curve)}
      class="stroke-text/60"
      fill="none"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/each}
