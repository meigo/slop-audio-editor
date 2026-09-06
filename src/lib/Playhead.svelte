<script lang="ts">
  import { engine, state as appState } from "../state/appState.svelte";
  import { playheadFollower, timeToPx } from "./geometry";

  // While playing, the position comes from the audio clock — never from a counter.
  // The same loop keeps the playhead on screen by PAGE FLIP (`pageFlipScroll`, through
  // `playheadFollower`): the view jumps when the playhead crosses an edge and otherwise holds
  // still. The follower remembers the position it last saw, and decides from THAT rather than
  // from `appState.playheadS` — a loop restart assigns the playhead straight to the loop start
  // between frames, so the live value was already off-screen by the time this loop looked, and
  // read as a manual scroll. A playhead the user scrolled away from still stays put: it was not
  // in view last frame either.
  $effect(() => {
    if (!appState.playing) return;
    let raf = 0;
    const step = playheadFollower(appState.playheadS);
    const tick = () => {
      const { scrollS, pxPerSecond, timelineWidthPx } = appState;
      appState.playheadS = engine.positionS();
      const flip = step(appState.playheadS, scrollS, pxPerSecond, timelineWidthPx);
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
