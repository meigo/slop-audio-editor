<script lang="ts">
  import { projectDurationS, type Track } from "../doc/document";
  import { planDucking, type DuckPoint } from "../audio/ducking";
  import { focusPanel, state as appState } from "../state/appState.svelte";
  import ClipView from "./ClipView.svelte";
  import { startRangeDrag } from "./clip-drag.svelte";
  import { armLongPress, endLongPress, moveLongPress } from "./long-press";

  const { track }: { track: Track } = $props();

  /** Computed once per lane rather than per clip: `planDucking` walks every track's clips, so
   *  calling it inside `ClipView` would make drawing quadratic in the project's clip count. */
  const duck = $derived(
    track.ducked
      ? (planDucking(appState.project, 0, projectDurationS(appState.project)).get(track.id) ?? [])
      : [],
  );

  /** The envelope over one clip, in seconds from that clip's start. Includes the value in force
   *  when the clip begins, so a clip that starts mid-duck is drawn already dipped. */
  function duckOver(startS: number, durS: number): DuckPoint[] {
    if (duck.length === 0) return [];
    const endS = startS + durS;
    let before = duck[0];
    const out: DuckPoint[] = [];
    for (const p of duck) {
      if (p.t <= startS) before = p;
      else if (p.t < endS) out.push({ t: p.t - startS, gain: p.gain });
    }
    return [{ t: 0, gain: before.gain }, ...out];
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-track-id={track.id}
  class="relative touch-none border-b border-line bg-ground"
  style="height: {appState.trackHeightPx}px"
  onpointerdown={(e) => {
    // Empty lane space — a clip's own handler stops propagation, so reaching here means the
    // pointer landed on the TRACK.
    focusPanel("track");
    startRangeDrag(e, track.id);
    armLongPress(e);
  }}
  onpointermove={moveLongPress}
  onpointerup={endLongPress}
  onpointercancel={endLongPress}
  oncontextmenu={(e) => {
    // Empty lane time: the menu is here for Paste, so the selection is left exactly as it was.
    e.preventDefault();
    appState.contextMenu = { x: e.clientX, y: e.clientY };
  }}
>
  {#each track.clips as clip (clip.id)}
    <ClipView
      {clip}
      trackId={track.id}
      heightPx={appState.trackHeightPx}
      duck={duckOver(clip.startS, clip.durS)}
    />
  {/each}
</div>
