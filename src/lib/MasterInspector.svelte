<script lang="ts">
  import {
    EQ_HIGH_HZ,
    EQ_LOW_HZ,
    EQ_MAX_DB,
    EQ_MID_HZ,
    projectDurationS,
    type EqBands,
    type Project,
    type TrackFilter,
  } from "../doc/document";
  import {
    setDuckDepth,
    setGlue,
    setMasterEq,
    setMasterFadeIn,
    setMasterFadeOut,
    setMasterFilter,
    setSaturation,
  } from "../doc/edits";
  import {
    amend,
    beginGesture,
    commit,
    endGesture,
    engine,
    state as appState,
  } from "../state/appState.svelte";
  import BandSlider from "./BandSlider.svelte";
  import DriveSlider from "./DriveSlider.svelte";
  import FilterSlider from "./FilterSlider.svelte";
  import NumberField from "./NumberField.svelte";

  let dragging = false;

  function onMasterBand(patch: Partial<EqBands>) {
    if (!dragging) {
      dragging = true;
      beginGesture("mix");
    }
    amend((p) => setMasterEq(p, patch));
    engine.setMasterEq(appState.project.masterEq);
  }

  function onFilter(filter: TrackFilter) {
    if (!dragging) {
      dragging = true;
      beginGesture("mix");
    }
    amend((p) => setMasterFilter(p, filter));
    engine.setMasterFilter(appState.project.masterFilter);
  }

  function onDrive(amount: number) {
    if (!dragging) {
      dragging = true;
      beginGesture("mix");
    }
    amend((p) => setSaturation(p, amount));
    engine.setSaturation(appState.project.saturation);
  }

  function onBandCommit() {
    if (!dragging) return;
    dragging = false;
    endGesture();
  }

  /**
   * The mix fades update the document on every step of a scrub, like a clip's own fades, so the
   * curve `MasterFadeOverlay` draws across the tracks follows the drag.
   *
   * A "structural" gesture, unlike everything above it here: the mix fades are automation written
   * into the schedule, not a retained node the engine can sweep, so `amend` moves the drawing
   * without rescheduling and the single `endGesture` on release is what makes it audible. The
   * whole drag is one undo entry either way.
   */
  let fading = false;

  function onFade(set: (p: Project, v: number) => Project, v: number) {
    if (!fading) {
      fading = true;
      beginGesture();
    }
    amend((p) => set(p, v));
  }

  function commitFade(set: (p: Project, v: number) => Project, v: number) {
    if (!fading) {
      commit((p) => set(p, v)); // typed, not dragged
      return;
    }
    amend((p) => set(p, v));
    fading = false;
    endGesture();
  }

  const ducking = $derived(appState.project.tracks.some((t) => t.ducked));

  /** Clamped to the project's length, the same way `masterFadeInSpec`/`masterFadeSpec` and the
   *  overlay clamp them. The STORED value can exceed it once clips are deleted, and the field
   *  then read 6.00 while the picture and the audio both did 3. */
  const durationS = $derived(projectDurationS(appState.project));
  const fadeInShown = $derived(Math.min(appState.project.fadeInS, durationS));
  const fadeOutShown = $derived(Math.min(appState.project.fadeOutS, durationS));
</script>

<!-- What applies to the WHOLE project. The meter and the master fader stay in the toolbar on
     purpose: the meter is a safety device and the fader gets ridden during playback, so neither
     should be reachable only by opening a panel. -->
<div class="flex flex-col gap-3 p-2">
  <section
    class="grid items-center gap-x-2 gap-y-3 border-t border-line pt-2"
    style="grid-template-columns: auto minmax(0, 1fr) auto"
  >
    <h3 class="col-span-3 text-[11px] tracking-wide text-muted uppercase">Master</h3>
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
    <FilterSlider
      filter={appState.project.masterFilter}
      title="Sweepable filter on the whole mix. Left is a high-pass, right a low-pass, centre off. Separate from Glue's own fixed band-limit."
      onInput={onFilter}
      onCommit={onBandCommit}
    />
    <DriveSlider
      label="drive"
      amount={appState.project.saturation}
      title="Tape-style saturation on the whole mix. Quiet material passes untouched; peaks bend. Sits after Glue, so it is the last colour before the meter."
      onInput={onDrive}
      onCommit={onBandCommit}
    />
    <button
      class="col-span-3 mt-1 rounded border px-2 py-1 text-xs {appState.project.glue
        ? 'border-accent bg-accent/20 text-text'
        : 'border-line text-muted hover:bg-raised hover:text-text'}"
      aria-pressed={appState.project.glue}
      title="Band-limit and gently compress the master bus so disparate sources sit together. Level-neutral for quiet material."
      onclick={() => commit((p) => setGlue(p, !p.glue))}
    >
      Glue
    </button>
  </section>

  <section
    class="grid items-center gap-x-2 gap-y-3 border-t border-line pt-2"
    style="grid-template-columns: auto minmax(0, 1fr) auto"
  >
    <h3 class="col-span-3 text-[11px] tracking-wide text-muted uppercase">Mix fades</h3>
    <NumberField
      label="in"
      value={fadeInShown}
      suffix="s"
      title="Fades the WHOLE MIX up from the project's start — everything playing, together. Anchored to t = 0, which cannot move."
      onInput={(v) => onFade(setMasterFadeIn, v)}
      onCommit={(v) => commitFade(setMasterFadeIn, v)}
    />
    <NumberField
      label="out"
      value={fadeOutShown}
      suffix="s"
      title="Fades the WHOLE MIX at the end of the project — everything still playing, together. Anchored to the project end, so a range export of the middle does not invent one."
      onInput={(v) => onFade(setMasterFadeOut, v)}
      onCommit={(v) => commitFade(setMasterFadeOut, v)}
    />
  </section>

  <section
    class="grid items-center gap-x-2 gap-y-3 border-t border-line pt-2"
    style="grid-template-columns: auto minmax(0, 1fr) auto"
  >
    <h3 class="col-span-3 text-[11px] tracking-wide text-muted uppercase">Duck</h3>
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
