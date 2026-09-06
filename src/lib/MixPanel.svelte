<script lang="ts">
  import { PanelRightClose, PanelRightOpen } from "@lucide/svelte";
  import {
    EQ_HIGH_HZ,
    EQ_LOW_HZ,
    EQ_MAX_DB,
    EQ_MID_HZ,
    findTrack,
    type EqBands,
    type TrackFilter,
  } from "../doc/document";
  import { setDuckDepth, setGlue, setMasterEq, setTrackEq, setTrackFilter } from "../doc/edits";
  import {
    amend,
    beginGesture,
    commit,
    currentTrackId,
    endGesture,
    engine,
    state as appState,
  } from "../state/appState.svelte";
  import BandSlider from "./BandSlider.svelte";
  import FilterSlider from "./FilterSlider.svelte";
  import NumberField from "./NumberField.svelte";

  /** A MIX change, exactly like the track EQ in the Inspector: applied live on the retained
   *  biquads so a band can be swept while listening, committed as ONE history entry on release,
   *  and never rescheduling. `dragging` is what collapses a whole sweep into one undo step. */
  let dragging = false;

  function startSweep() {
    if (dragging) return;
    dragging = true;
    beginGesture("mix");
  }

  function onMasterBand(patch: Partial<EqBands>) {
    startSweep();
    amend((p) => setMasterEq(p, patch));
    engine.setMasterEq(appState.project.masterEq);
  }

  /** Track EQ follows the CURRENT track (the one you last touched), not the selection — it is a
   *  track property, the same rule the M / solo shortcuts use. */
  const track = $derived(findTrack(appState.project, currentTrackId()));

  function onTrackBand(patch: Partial<EqBands>) {
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

  const ducking = $derived(appState.project.tracks.some((t) => t.ducked));
</script>

<!-- The mixer: everything you SET AND LEAVE — the current track's EQ, the master EQ, Glue, and
     the duck depth. The meter and the master fader stay in the toolbar on purpose: the meter is a
     safety device and the fader gets ridden during playback, so neither should be reachable only
     by expanding a panel.
     Gathering these here is what got the toolbar and the inspector back under a 1230 px window —
     the inspector row needed 1271 px with the track EQ in it, and now describes only the selected
     clip, which is what its name promises. -->
<div
  class="flex shrink-0 flex-col border-l border-line bg-panel"
  style="width: {appState.masterPanelOpen ? 200 : 30}px"
>
  <!-- The toggle is LAST, pinned to the panel's right edge. The panel grows leftwards, so its
       left edge moves by the full 172 px it opens by while the right edge does not move at all —
       a toggle on the left would slide out from under the pointer that just clicked it. -->
  <div class="flex h-7 items-center border-b border-line">
    {#if appState.masterPanelOpen}
      <span class="truncate px-2 text-[11px] text-muted">Mix</span>
    {/if}
    <button
      class="ml-auto shrink-0 self-stretch px-2 text-muted hover:bg-raised hover:text-text"
      title={appState.masterPanelOpen ? "Hide mix panel" : "Show mix panel"}
      onclick={() => (appState.masterPanelOpen = !appState.masterPanelOpen)}
    >
      {#if appState.masterPanelOpen}<PanelRightClose size={13} />
      {:else}<PanelRightOpen size={13} />{/if}
    </button>
  </div>

  {#if appState.masterPanelOpen}
    <div class="flex flex-col gap-3 overflow-y-auto p-2">
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
            onInput={(v) => onTrackBand({ lowDb: v })}
            onCommit={onBandCommit}
          />
          <BandSlider
            label="mid"
            db={track.eq.midDb}
            maxDb={EQ_MAX_DB}
            title="Peaking band at {EQ_MID_HZ} Hz — cut to reduce boxiness, boost for presence"
            onInput={(v) => onTrackBand({ midDb: v })}
            onCommit={onBandCommit}
          />
          <BandSlider
            label="high"
            db={track.eq.highDb}
            maxDb={EQ_MAX_DB}
            title="High shelf at {EQ_HIGH_HZ} Hz — cut to soften sibilance, boost for air"
            onInput={(v) => onTrackBand({ highDb: v })}
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

      <section class="flex flex-col gap-1.5 border-t border-line pt-2">
        <h3 class="text-[11px] tracking-wide text-muted uppercase">Master</h3>
        <BandSlider
          label="low"
          db={appState.project.masterEq.lowDb}
          maxDb={EQ_MAX_DB}
          title="Master low shelf at {EQ_LOW_HZ} Hz — cut to tame boom, boost for weight"
          onInput={(v) => onMasterBand({ lowDb: v })}
          onCommit={onBandCommit}
        />
        <BandSlider
          label="mid"
          db={appState.project.masterEq.midDb}
          maxDb={EQ_MAX_DB}
          title="Master peaking band at {EQ_MID_HZ} Hz — cut to reduce boxiness, boost for presence"
          onInput={(v) => onMasterBand({ midDb: v })}
          onCommit={onBandCommit}
        />
        <BandSlider
          label="high"
          db={appState.project.masterEq.highDb}
          maxDb={EQ_MAX_DB}
          title="Master high shelf at {EQ_HIGH_HZ} Hz — cut to soften sibilance, boost for air"
          onInput={(v) => onMasterBand({ highDb: v })}
          onCommit={onBandCommit}
        />
        <!-- Below the EQ because that is the signal order: fader, EQ, then Glue. -->
        <button
          class="mt-1 rounded border px-2 py-1 text-xs {appState.project.glue
            ? 'border-accent bg-accent/20 text-text'
            : 'border-line text-muted hover:bg-raised hover:text-text'}"
          aria-pressed={appState.project.glue}
          title="Band-limit and gently compress the master bus so disparate sources sit together. Level-neutral for quiet material."
          onclick={() => commit((p) => setGlue(p, !p.glue))}
        >
          Glue
        </button>
      </section>

      <section class="flex flex-col gap-1.5 border-t border-line pt-2">
        <h3 class="text-[11px] tracking-wide text-muted uppercase">Duck</h3>
        <!-- Always mounted, disabled until some track is marked D — the same reason it is not
             `{#if}`-gated: state must not move the layout. -->
        <NumberField
          label="depth"
          value={appState.project.duckDepthDb}
          min={-40}
          suffix="dB"
          disabled={!ducking}
          title="How far background (D) tracks dip while another track plays. 0 dB turns ducking off."
          onCommit={(v) => commit((p) => setDuckDepth(p, v))}
        />
      </section>
    </div>
  {/if}
</div>
