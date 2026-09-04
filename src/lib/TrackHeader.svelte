<script lang="ts">
  import type { Track } from "../doc/document";
  import { renameTrack, setTrackGain, setTrackMuted } from "../doc/edits";
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
<div
  class="flex flex-col justify-between border-b border-l-2 border-neutral-800 px-2 py-1"
  class:border-l-transparent={!isCurrent}
  class:border-l-violet-400={isCurrent}
  style="height: {appState.trackHeightPx}px"
  onclick={() => setCurrentTrack(track.id)}
>
  <div class="flex items-center gap-1">
    {#if renaming}
      <input
        bind:this={nameInput}
        class="w-full bg-neutral-800 px-1 text-xs"
        value={track.name}
        onblur={(e) => {
          commit((p) => renameTrack(p, track.id, e.currentTarget.value.trim() || track.name));
          renaming = false;
        }}
        onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    {:else}
      <button
        class="flex-1 truncate text-left text-xs text-neutral-300"
        title="Double-click to rename"
        ondblclick={() => (renaming = true)}
      >
        {track.name}
      </button>
    {/if}

    <button
      class="rounded px-1 text-[10px] font-bold"
      class:bg-amber-500={track.muted}
      class:text-black={track.muted}
      class:text-neutral-500={!track.muted}
      title="Mute (saved with the project, silences the export)"
      onclick={() => commit((p) => setTrackMuted(p, track.id, !track.muted))}
    >
      M
    </button>
    <button
      class="rounded px-1 text-[10px] font-bold"
      class:bg-sky-400={appState.soloed.has(track.id)}
      class:text-black={appState.soloed.has(track.id)}
      class:text-neutral-500={!appState.soloed.has(track.id)}
      title="Solo (preview only — never affects the export)"
      onclick={() => toggleSolo(track.id)}
    >
      S
    </button>
  </div>

  <Fader gain={track.gain} onInput={onGain} onCommit={onGainCommit} label="Track volume (dB)" />
</div>
