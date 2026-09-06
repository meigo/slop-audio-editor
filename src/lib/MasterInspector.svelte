<script lang="ts">
  import { EQ_HIGH_HZ, EQ_LOW_HZ, EQ_MAX_DB, EQ_MID_HZ, type EqBands } from "../doc/document";
  import { setDuckDepth, setGlue, setMasterEq } from "../doc/edits";
  import {
    amend,
    beginGesture,
    commit,
    endGesture,
    engine,
    state as appState,
  } from "../state/appState.svelte";
  import BandSlider from "./BandSlider.svelte";
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

  function onBandCommit() {
    if (!dragging) return;
    dragging = false;
    endGesture();
  }

  const ducking = $derived(appState.project.tracks.some((t) => t.ducked));
</script>

<!-- What applies to the WHOLE project. The meter and the master fader stay in the toolbar on
     purpose: the meter is a safety device and the fader gets ridden during playback, so neither
     should be reachable only by opening a panel. -->
<div class="flex flex-col gap-3 p-2">
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
