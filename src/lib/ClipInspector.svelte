<script lang="ts">
  import { findClip, MAX_SPEED, MIN_SPEED, type FadeShape } from "../doc/document";
  import { setClipFade, setClipGain, setClipSpeed, trimClipEnd, trimClipStart } from "../doc/edits";
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
    linear: "Linear",
    equalPower: "Equal power",
    exponential: "Exponential",
  };
</script>

<!-- THE SELECTED CLIP, and nothing else. It used to be a horizontal bar under the timeline while
     the mix controls sat in a panel on the right — clip properties in one place, track and master
     properties in another. Both now live in the same panel, on tabs.
     Stacked vertically rather than in a row: a narrow column suits `NumberField` better than the
     bar did, where seven fields competed for one line and the row scrolled sideways. -->
<div class="flex flex-col p-2">
  {#if clip}
    <span class="truncate pb-2 text-xs text-text" title={source?.name ?? "missing audio"}>
      {source?.name ?? "missing audio"}
    </span>

    <!-- ONE grid for every field on the tab, not one per group: separate grids size their label
         columns independently, so "fade out" pushed the second group's boxes right and the two
         halves no longer lined up across the divider. The rules are full-width rows inside the
         same grid instead of section borders.
         Grouped by what the fields DO: where the clip sits and how fast it plays; then its level
         and the envelope shaping that level. Seven fields in one flat column read as a list to
         scan rather than three things to adjust. -->
    <div
      class="grid items-center gap-2 pt-2"
      style="grid-template-columns: auto minmax(0, 1fr) auto"
    >
      <div class="col-span-3 border-t border-line"></div>
      <NumberField
        label="in"
        value={clip.startS}
        suffix="s"
        title="Where the clip starts on the timeline"
        onCommit={(v) => commit((p) => trimClipStart(p, clip.id, v - clip.startS))}
      />
      <NumberField
        label="out"
        value={clip.startS + clip.durS}
        suffix="s"
        title="Where the clip ends on the timeline"
        onCommit={(v) =>
          commit((p) =>
            trimClipEnd(p, clip.id, v - (clip.startS + clip.durS), source?.durationS ?? Infinity),
          )}
      />
      <NumberField
        label="speed"
        value={clip.speed}
        min={MIN_SPEED}
        max={MAX_SPEED}
        suffix="×"
        title="Playback rate. Changes speed and pitch together, like tape — 2 is twice as fast and an octave up. The clip's length on the timeline changes to match."
        onCommit={(v) => commit((p) => setClipSpeed(p, clip.id, v))}
      />

      <div class="col-span-3 mt-1 border-t border-line"></div>
      <NumberField
        label="gain"
        value={clip.gain <= 0 ? -60 : gainToDb(clip.gain)}
        min={-60}
        max={24}
        step={0.1}
        suffix="dB"
        title="Clip volume in dB"
        onCommit={(v) => commit((p) => setClipGain(p, clip.id, v <= -60 ? 0 : dbToGain(v)))}
      />
      <NumberField
        label="fade in"
        value={clip.fadeInS}
        suffix="s"
        title="Fade-in length"
        onCommit={(v) => commit((p) => setClipFade(p, clip.id, { fadeInS: v }))}
      />
      <NumberField
        label="fade out"
        value={clip.fadeOutS}
        suffix="s"
        title="Fade-out length"
        onCommit={(v) => commit((p) => setClipFade(p, clip.id, { fadeOutS: v }))}
      />
      <label class="contents text-[11px] text-muted" title="Fade curve shape">
        <span class="text-right">shape</span>
        <select
          class="col-span-2 h-6 min-w-0 rounded bg-raised px-1 text-xs text-text"
          value={clip.fadeShape}
          onchange={(e) =>
            commit((p) =>
              setClipFade(p, clip.id, { fadeShape: e.currentTarget.value as FadeShape }),
            )}
        >
          {#each SHAPES as shape (shape)}
            <option value={shape}>{SHAPE_LABELS[shape]}</option>
          {/each}
        </select>
      </label>
    </div>
  {:else}
    <span class="text-xs text-muted">Select a clip to edit its exact values</span>
  {/if}
</div>
