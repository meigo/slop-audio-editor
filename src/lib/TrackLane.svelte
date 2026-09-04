<script lang="ts">
  import { projectDurationS, type Track } from "../doc/document";
  import { planDucking, type DuckPoint } from "../audio/ducking";
  import { state as appState } from "../state/appState.svelte";
  import ClipView from "./ClipView.svelte";
  import { startRangeDrag } from "./clip-drag.svelte";

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
  class="relative border-b border-neutral-800 bg-neutral-900"
  style="height: {appState.trackHeightPx}px"
  onpointerdown={(e) => startRangeDrag(e, track.id)}
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
