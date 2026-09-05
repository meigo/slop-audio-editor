<script lang="ts">
  import { findClip, type FadeShape } from "../doc/document";
  import { setClipFade, setClipGain, trimClipEnd, trimClipStart } from "../doc/edits";
  import { commit, pool, state as appState } from "../state/appState.svelte";
  import { dbToGain, gainToDb } from "./geometry";
  import NumberField from "./NumberField.svelte";

  /** The inspector edits ONE clip — it is for typing exact numbers, not for bulk operations. */
  const selected = $derived(
    appState.selection.kind === "clips" && appState.selection.clipIds.length === 1
      ? findClip(appState.project, appState.selection.clipIds[0])
      : undefined,
  );
  const clip = $derived(selected?.clip);
  const source = $derived(clip ? pool.get(clip.sourceId) : undefined);

  const SHAPES: FadeShape[] = ["linear", "equalPower", "exponential"];
  const SHAPE_LABELS: Record<FadeShape, string> = {
    linear: "Linear", equalPower: "Equal power", exponential: "Exponential",
  };
</script>

<!-- THE SELECTED CLIP, and nothing else. Track EQ used to sit on the right of this row and was
     566 px of its 1271 px minimum — it moved to the mix panel, where it sits with the master EQ
     it belongs beside.
     `overflow-x-auto` is the fallback for a genuinely narrow window: the controls keep their
     natural size and the bar scrolls, rather than squeezing until labels wrap. -->
<div class="flex h-10 shrink-0 items-center gap-3 overflow-x-auto border-t border-line bg-panel px-3">
  {#if clip}
    <span class="w-32 shrink-0 truncate text-xs text-text">{source?.name ?? "missing audio"}</span>

    <NumberField
      label="in"
      value={clip.startS}
      suffix="s"
      title="Clip start on the timeline (seconds)"
      onCommit={(v) => commit((p) => trimClipStart(p, clip.id, v - clip.startS))}
    />
    <NumberField
      label="out"
      value={clip.startS + clip.durS}
      suffix="s"
      title="Clip end on the timeline (seconds)"
      onCommit={(v) =>
        commit((p) => trimClipEnd(p, clip.id, v - (clip.startS + clip.durS), source?.durationS ?? Infinity))}
    />
    <NumberField
      label="gain"
      value={clip.gain <= 0 ? -60 : gainToDb(clip.gain)}
      min={-60}
      suffix="dB"
      title="Clip volume in dB"
      onCommit={(v) => commit((p) => setClipGain(p, clip.id, v <= -60 ? 0 : dbToGain(v)))}
    />
    <NumberField
      label="fade in"
      value={clip.fadeInS}
      suffix="s"
      title="Fade length in seconds"
      onCommit={(v) => commit((p) => setClipFade(p, clip.id, { fadeInS: v }))}
    />
    <NumberField
      label="fade out"
      value={clip.fadeOutS}
      suffix="s"
      title="Fade length in seconds"
      onCommit={(v) => commit((p) => setClipFade(p, clip.id, { fadeOutS: v }))}
    />

    <select
      class="rounded bg-panel px-1 py-0.5 text-[11px]"
      value={clip.fadeShape}
      title="Fade curve shape"
      onchange={(e) =>
        commit((p) => setClipFade(p, clip.id, { fadeShape: e.currentTarget.value as FadeShape }))}
    >
      {#each SHAPES as shape (shape)}
        <option value={shape}>{SHAPE_LABELS[shape]}</option>
      {/each}
    </select>
  {:else}
    <span class="text-xs text-muted">Select a clip to edit its exact values</span>
  {/if}

</div>
