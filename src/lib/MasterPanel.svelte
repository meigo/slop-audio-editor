<script lang="ts">
  import { PanelRightClose, PanelRightOpen } from "@lucide/svelte";
  import {
    EQ_HIGH_HZ, EQ_LOW_HZ, EQ_MAX_DB, EQ_MID_HZ, type EqBands,
  } from "../doc/document";
  import { setGlue, setMasterEq } from "../doc/edits";
  import {
    amend, beginGesture, commit, endGesture, engine, state as appState,
  } from "../state/appState.svelte";
  import BandSlider from "./BandSlider.svelte";

  /** A MIX change, exactly like the track EQ in the Inspector: applied live on the retained
   *  biquads so a band can be swept while listening, committed as ONE history entry on release,
   *  and never rescheduling. `dragging` is what collapses a whole sweep into one undo step. */
  let dragging = false;

  function onBand(patch: Partial<EqBands>) {
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
</script>

<!-- Master PROCESSING only. The meter and the master fader stay in the toolbar on purpose: the
     meter is a safety device and the fader gets ridden during playback, and neither should be
     reachable only by expanding a panel. What lives here is what you set and leave. -->
<div
  class="flex shrink-0 flex-col border-l border-line bg-panel"
  style="width: {appState.masterPanelOpen ? 200 : 30}px"
>
  <!-- The toggle is LAST, pinned to the panel's right edge. The panel grows leftwards, so its
       left edge moves by the full 172 px it opens by while the right edge does not move at all —
       a toggle on the left would slide out from under the pointer that just clicked it. -->
  <div class="flex h-7 items-center border-b border-line">
    {#if appState.masterPanelOpen}
      <span class="truncate px-2 text-[11px] text-muted">Master</span>
    {/if}
    <button
      class="ml-auto shrink-0 self-stretch px-2 text-muted hover:bg-raised hover:text-text"
      title={appState.masterPanelOpen ? "Hide master panel" : "Show master panel"}
      onclick={() => (appState.masterPanelOpen = !appState.masterPanelOpen)}
    >
      {#if appState.masterPanelOpen}<PanelRightClose size={13} />
      {:else}<PanelRightOpen size={13} />{/if}
    </button>
  </div>

  {#if appState.masterPanelOpen}
    <div class="flex flex-col gap-3 p-2">
      <section class="flex flex-col gap-1.5">
        <h3 class="text-[11px] uppercase tracking-wide text-muted">EQ</h3>
        <BandSlider
          label="low"
          db={appState.project.masterEq.lowDb}
          maxDb={EQ_MAX_DB}
          title="Master low shelf at {EQ_LOW_HZ} Hz — cut to tame boom, boost for weight"
          onInput={(v) => onBand({ lowDb: v })}
          onCommit={onBandCommit}
        />
        <BandSlider
          label="mid"
          db={appState.project.masterEq.midDb}
          maxDb={EQ_MAX_DB}
          title="Master peaking band at {EQ_MID_HZ} Hz — cut to reduce boxiness, boost for presence"
          onInput={(v) => onBand({ midDb: v })}
          onCommit={onBandCommit}
        />
        <BandSlider
          label="high"
          db={appState.project.masterEq.highDb}
          maxDb={EQ_MAX_DB}
          title="Master high shelf at {EQ_HIGH_HZ} Hz — cut to soften sibilance, boost for air"
          onInput={(v) => onBand({ highDb: v })}
          onCommit={onBandCommit}
        />
      </section>

      <section class="flex flex-col gap-1.5">
        <h3 class="text-[11px] uppercase tracking-wide text-muted">Bus</h3>
        <!-- Below the EQ because that is the signal order: fader, EQ, then Glue. -->
        <button
          class="rounded border px-2 py-1 text-xs {appState.project.glue
            ? 'border-accent bg-accent/20 text-text'
            : 'border-line text-muted hover:bg-raised hover:text-text'}"
          aria-pressed={appState.project.glue}
          title="Band-limit and gently compress the master bus so disparate sources sit together. Level-neutral for quiet material."
          onclick={() => commit((p) => setGlue(p, !p.glue))}
        >
          Glue
        </button>
      </section>
    </div>
  {/if}
</div>
