<script lang="ts">
  import { EQ_HIGH_HZ, EQ_LOW_HZ, EQ_MAX_DB, EQ_MID_HZ, findClip, findTrack, type FadeShape, type TrackEq } from "../doc/document";
  import { setClipFade, setClipGain, setTrackEq, trimClipEnd, trimClipStart } from "../doc/edits";
  import {
    amend, beginGesture, commit, currentTrackId, endGesture, engine, pool, state as appState,
  } from "../state/appState.svelte";
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

  /** EQ is per TRACK, not per clip, so it follows the current track (the one you last touched)
   *  rather than the selection — the same rule the M / solo shortcuts use. */
  const track = $derived(findTrack(appState.project, currentTrackId()));

  /** A MIX change, exactly like the track fader: applied live on the retained biquads so a band
   *  can be swept while listening, and committed as ONE history entry that does not reschedule. */
  function onBand(patch: Partial<TrackEq>) {
    const id = currentTrackId();
    beginGesture("mix");
    amend((p) => setTrackEq(p, id, patch));
    const next = findTrack(appState.project, id)?.eq;
    if (next) engine.setTrackEq(id, next);
    endGesture();
  }

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

  {#if track}
    <!-- Right-aligned and always present: EQ belongs to the current track, so unlike the clip
         fields it has something to show even when nothing is selected. -->
    <div
      class="ml-auto flex items-center gap-2"
      data-hint="Three-band tone control for the current track ({EQ_LOW_HZ} Hz, {EQ_MID_HZ} Hz, {EQ_HIGH_HZ} Hz). Click a track header to switch tracks."
    >
      <span class="max-w-24 truncate text-[11px] text-neutral-500">{track.name} EQ</span>
      <NumberField
        label="low"
        value={track.eq.lowDb}
        min={-EQ_MAX_DB}
        suffix="dB"
        title="Low shelf at {EQ_LOW_HZ} Hz — cut to tame boom, boost for weight"
        onCommit={(v) => onBand({ lowDb: v })}
      />
      <NumberField
        label="mid"
        value={track.eq.midDb}
        min={-EQ_MAX_DB}
        suffix="dB"
        title="Peaking band at {EQ_MID_HZ} Hz — cut to reduce boxiness, boost for presence"
        onCommit={(v) => onBand({ midDb: v })}
      />
      <NumberField
        label="high"
        value={track.eq.highDb}
        min={-EQ_MAX_DB}
        suffix="dB"
        title="High shelf at {EQ_HIGH_HZ} Hz — cut to soften sibilance, boost for air"
        onCommit={(v) => onBand({ highDb: v })}
      />
    </div>
  {/if}
</div>
