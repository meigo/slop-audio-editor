<script lang="ts">
  import type { Track } from "../doc/document";
  import { renameTrack, setTrackDucked, setTrackGain, setTrackMuted } from "../doc/edits";
  import {
    amend, beginGesture, commit, currentTrackId, endGesture, engine, setCurrentTrack,
    state as appState, toggleSolo,
  } from "../state/appState.svelte";
  import Fader from "./Fader.svelte";

  const { track }: { track: Track } = $props();

  const isCurrent = $derived(currentTrackId() === track.id);

  let renaming = $state(false);
  let nameInput = $state<HTMLInputElement | null>(null);
  let dragging = false;

  // `autofocus` is an a11y warning and the build gate is 0 warnings, so focus explicitly.
  $effect(() => {
    if (renaming) nameInput?.focus();
  });

  /** Gain is a MIX change: applied live on the engine's retained node, so a fader can be ridden
   *  while playing. Only the pointer-up commits a history entry. */
  function onGain(g: number) {
    if (!dragging) {
      dragging = true;
      beginGesture("mix"); // MIX gesture: no reschedule on release, so the fader can be ridden
    }
    amend((p) => setTrackGain(p, track.id, g));
    engine.setTrackGain(track.id, g);
  }

  function onGainCommit() {
    if (!dragging) return;
    dragging = false;
    endGesture();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- `select-none` on the header: the name and the M/S/D letters are controls, not text, and
     double-clicking the name to rename it would otherwise highlight the word as it opens the
     editor. The rename input takes `select-text` back, because there selecting IS the point. -->
<div
  class="flex select-none flex-col justify-between border-b border-l-2 border-line px-2 py-1"
  class:border-l-transparent={!isCurrent}
  class:border-l-accent={isCurrent}
  style="height: {appState.trackHeightPx}px"
  onclick={() => setCurrentTrack(track.id)}
>
  <div class="flex items-center gap-1">
    {#if renaming}
      <input
        bind:this={nameInput}
        class="w-full select-text bg-panel px-1 text-xs"
        value={track.name}
        onblur={(e) => {
          commit((p) => renameTrack(p, track.id, e.currentTarget.value.trim() || track.name));
          renaming = false;
        }}
        onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    {:else}
      <button
        class="flex-1 truncate text-left text-xs text-text"
        title="Double-click to rename"
        ondblclick={() => (renaming = true)}
      >
        {track.name}
      </button>
    {/if}

    <button
      class="rounded px-1 text-[10px] font-bold"
      class:bg-warn={track.muted}
      class:text-black={track.muted}
      class:text-muted={!track.muted}
      title="Mute (saved with the project, silences the export)"
      onclick={() => commit((p) => setTrackMuted(p, track.id, !track.muted))}
    >
      M
    </button>
    <button
      class="rounded px-1 text-[10px] font-bold"
      class:bg-accent={appState.soloed.has(track.id)}
      class:text-black={appState.soloed.has(track.id)}
      class:text-muted={!appState.soloed.has(track.id)}
      title="Solo (preview only — never affects the export)"
      onclick={() => toggleSolo(track.id)}
    >
      S
    </button>
    <button
      class="rounded px-1 text-[10px] font-bold"
      class:bg-ok={track.ducked}
      class:text-black={track.ducked}
      class:text-muted={!track.ducked}
      title="Background: dip this track while any other track is playing (music under voice)"
      onclick={() => commit((p) => setTrackDucked(p, track.id, !track.ducked))}
    >
      D
    </button>
  </div>

  <Fader gain={track.gain} onInput={onGain} onCommit={onGainCommit} label="Track volume (dB)" />
</div>
