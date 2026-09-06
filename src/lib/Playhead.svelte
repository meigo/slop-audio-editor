<script lang="ts">
  import { projectDurationS } from "../doc/document";
  import { engine, state as appState } from "../state/appState.svelte";
  import { playheadFollower, timeToPx } from "./geometry";

  // While playing, the position comes from the audio clock — never from a counter.
  // The same loop keeps the playhead on screen by PAGE FLIP, through `playheadFollower`: the view
  // jumps when the playhead crosses an edge and otherwise holds still, and a playhead the user
  // scrolled away from stays put because it was not in view last frame either.
  //
  // This effect reads `appState.playing` AND NOTHING ELSE from the store. It used to build the
  // follower from `appState.playheadS`, which is a TRACKED read: the tick writes that field every
  // frame, so the effect re-ran every frame, tearing the loop down and rebuilding the follower
  // with its memory set to the CURRENT position. A loop restart assigns the playhead from outside
  // this loop (`onEnded`), so the rebuild happened before the next frame could see the jump — the
  // follower was handed the already-jumped position and read it as a manual scroll, and the view
  // never came back. The reads inside `tick` are safe: an rAF callback runs outside the effect's
  // tracked scope.
  $effect(() => {
    if (!appState.playing) return;
    let raf = 0;
    const step = playheadFollower();
    const tick = () => {
      const { scrollS, pxPerSecond, timelineWidthPx } = appState;
      appState.playheadS = engine.positionS();
      // The project's end, so the last page sits flush with it instead of scrolling a page past
      // the final clip and leaving most of the viewport empty.
      const flip = step(
        appState.playheadS,
        scrollS,
        pxPerSecond,
        timelineWidthPx,
        projectDurationS(appState.project),
      );
      if (flip !== null) appState.scrollS = flip;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const x = $derived(timeToPx(appState.playheadS, appState.scrollS, appState.pxPerSecond));
</script>

<!-- Spans the ruler as well as the lanes (it is mounted beside the viewport, not inside it), so
     the head sits where the hand reaches to scrub. `pointer-events-none` keeps ruler scrubbing
     working straight through it.
     The head is a symmetric downward triangle with a RIGHT ANGLE at its point — half-width
     equals height (6 and 6), so the two slanted edges meet at exactly 90°. That is what separates
     it from the in/out
     markers: those are asymmetric half-wedges — IN flares right of its line, OUT flares left —
     so the two differ in SHAPE, not only in danger-vs-warn colour. Red against amber is the
     worst pair for the common colour blindnesses, so colour alone would not be a distinction.
     The drop-shadow is what keeps the head legible where it overlaps the ruler's own ticks. -->
<div class="pointer-events-none absolute inset-y-0 z-20 w-px bg-danger" style="left: {x}px">
  <div
    class="absolute top-0 -left-1.5 size-0 border-x-[6px] border-t-[6px] border-x-transparent
           border-t-danger drop-shadow-[0_0_1px_rgba(0,0,0,0.8)]"
  ></div>
</div>
