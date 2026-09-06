<script lang="ts">
  import {
    EQ_HIGH_HZ,
    EQ_LOW_HZ,
    EQ_MAX_DB,
    EQ_MID_HZ,
    findTrack,
    type EqBands,
    type TrackFilter,
  } from "../doc/document";
  import { setTrackEq, setTrackFilter } from "../doc/edits";
  import {
    amend,
    beginGesture,
    currentTrackId,
    endGesture,
    engine,
    state as appState,
  } from "../state/appState.svelte";
  import BandSlider from "./BandSlider.svelte";
  import FilterSlider from "./FilterSlider.svelte";

  /** Follows the CURRENT track — the one you last touched, which clicking a clip sets — not the
   *  selection. That is exactly why it sits on the Clip tab: these are the mix controls for the
   *  thing you just selected, where the Master tab holds what applies to the whole project. */
  const track = $derived(findTrack(appState.project, currentTrackId()));

  /** A MIX change: applied live on the retained nodes so a band can be swept while listening, and
   *  committed as ONE history entry on release that does not reschedule. */
  let dragging = false;

  function startSweep() {
    if (dragging) return;
    dragging = true;
    beginGesture("mix");
  }

  function onBand(patch: Partial<EqBands>) {
    const id = currentTrackId();
    startSweep();
    amend((p) => setTrackEq(p, id, patch));
    const next = findTrack(appState.project, id)?.eq;
    if (next) engine.setTrackEq(id, next);
  }

  function onFilter(filter: TrackFilter) {
    const id = currentTrackId();
    startSweep();
    amend((p) => setTrackFilter(p, id, filter));
    const next = findTrack(appState.project, id)?.filter;
    if (next) engine.setTrackFilter(id, next);
  }

  function onBandCommit() {
    if (!dragging) return;
    dragging = false;
    endGesture();
  }
</script>

<div class="flex flex-col gap-1.5 p-2">
  {#if track}
    <section
      class="flex flex-col gap-1.5"
      data-hint="Three-band tone control for the current track. Click a track header to switch tracks."
    >
      <h3 class="truncate text-[11px] tracking-wide text-muted uppercase">{track.name}</h3>
      <BandSlider
        label="low"
        db={track.eq.lowDb}
        maxDb={EQ_MAX_DB}
        title="Low shelf at {EQ_LOW_HZ} Hz — cut to tame boom, boost for weight"
        onInput={(v) => onBand({ lowDb: v })}
        onCommit={onBandCommit}
      />
      <BandSlider
        label="mid"
        db={track.eq.midDb}
        maxDb={EQ_MAX_DB}
        title="Peaking band at {EQ_MID_HZ} Hz — cut to reduce boxiness, boost for presence"
        onInput={(v) => onBand({ midDb: v })}
        onCommit={onBandCommit}
      />
      <BandSlider
        label="high"
        db={track.eq.highDb}
        maxDb={EQ_MAX_DB}
        title="High shelf at {EQ_HIGH_HZ} Hz — cut to soften sibilance, boost for air"
        onInput={(v) => onBand({ highDb: v })}
        onCommit={onBandCommit}
      />
      <FilterSlider
        filter={track.filter}
        title="Sweepable filter. Left is a high-pass climbing from 20 Hz — the one thing the shelves cannot do, since a shelf plateaus and this keeps falling. Right is a low-pass. Centre is off."
        onInput={onFilter}
        onCommit={onBandCommit}
      />
    </section>
  {/if}
</div>
