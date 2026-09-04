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

<div class="flex h-10 shrink-0 items-center gap-4 border-t border-neutral-700 px-3">
  {#if clip}
    <span class="w-48 truncate text-xs text-neutral-300">{source?.name ?? "missing audio"}</span>

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
      class="rounded bg-neutral-800 px-1 py-0.5 text-[11px]"
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
    <span class="text-xs text-neutral-600">Select a clip to edit its exact values</span>
  {/if}
</div>
