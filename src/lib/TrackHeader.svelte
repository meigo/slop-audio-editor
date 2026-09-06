<script lang="ts">
  import { GripVertical } from "@lucide/svelte";
  import type { Track } from "../doc/document";
  import {
    renameTrack,
    reorderTrack,
    setTrackDucked,
    setTrackGain,
    setTrackMuted,
  } from "../doc/edits";
  import {
    amend,
    beginGesture,
    commit,
    currentTrackId,
    endGesture,
    engine,
    setCurrentTrack,
    state as appState,
    toggleSolo,
  } from "../state/appState.svelte";
  import Fader from "./Fader.svelte";
  import { trackDropIndex } from "./panel-layout";

  const { track }: { track: Track } = $props();

  const isCurrent = $derived(currentTrackId() === track.id);

  let renaming = $state(false);
  let nameInput = $state<HTMLInputElement | null>(null);
  let dragging = false;

  /** M / S / D share a fixed 20 px square so the row does not reflow as letters differ, and the
   *  colour encodes WHAT KIND of state each one is, not which letter it is — the letter already
   *  does that. `accent` = it is in the document and reaches the export (mute, duck). `warn` =
   *  session-only monitoring that is never saved and never exported (solo), which is the same
   *  colour the in/out markers use for the same reason. */
  const FLAG_BASE =
    "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ";
  const FLAG_OFF = "text-muted hover:bg-raised hover:text-text";
  /** The on-colours are written out as LITERALS, never interpolated: Tailwind generates utilities
   *  by scanning source text, so a `bg-${kind}` would only work while some other file happened to
   *  use the same class. */
  const flagClass = (on: boolean, onClass: string): string => FLAG_BASE + (on ? onClass : FLAG_OFF);
  const FLAG_DOC = "bg-accent text-ground";
  const FLAG_SESSION = "bg-warn text-ground";

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

  /**
   * Reorder by dragging the grip.
   *
   * A GRIP rather than the whole header: the header's click sets the current track and its name's
   * double-click opens the rename editor, so a row-wide drag would need a movement threshold plus
   * an exclusion for every control inside it — a pile of conditions that can only be got subtly
   * wrong. A dedicated handle does one thing, shows that the row is draggable, and works on touch.
   *
   * Track order affects NO audio: nothing in the engine indexes tracks by position and everything
   * sums to the master bus. That is why this reorders LIVE under the pointer instead of showing a
   * drop indicator, and why it is a "mix" gesture — rescheduling playback would cost an audible
   * gap for a change that cannot alter a single sample.
   */
  let gripping = false;

  function gripDown(e: PointerEvent) {
    e.stopPropagation(); // or the row's click fires on release and steals the current track
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gripping = true;
    beginGesture("mix");
  }

  function gripMove(e: PointerEvent) {
    if (!gripping) return;
    const column = (e.currentTarget as HTMLElement).closest("[data-track-header]")?.parentElement;
    const first = column?.querySelector("[data-track-header]")?.getBoundingClientRect();
    if (!first) return;
    amend((p) =>
      reorderTrack(
        p,
        track.id,
        trackDropIndex(e.clientY, first.top, appState.trackHeightPx, p.tracks.length),
      ),
    );
  }

  function gripUp(e: PointerEvent) {
    if (!gripping) return;
    gripping = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // `pointercancel` releases it itself.
    }
    endGesture();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- `select-none` on the header: the name and the M/S/D letters are controls, not text, and
     double-clicking the name to rename it would otherwise highlight the word as it opens the
     editor. The rename input takes `select-text` back, because there selecting IS the point. -->
<div
  class="flex flex-col justify-between border-b border-l-2 border-line px-2 py-1 select-none"
  class:border-l-transparent={!isCurrent}
  class:border-l-accent={isCurrent}
  style="height: {appState.trackHeightPx}px"
  data-track-header={track.id}
  onclick={() => setCurrentTrack(track.id)}
>
  <div class="flex items-center gap-1">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="-ml-1 shrink-0 cursor-grab touch-none px-0.5 text-muted hover:text-text"
      title="Drag to reorder tracks"
      onpointerdown={gripDown}
      onpointermove={gripMove}
      onpointerup={gripUp}
      onpointercancel={gripUp}
    >
      <GripVertical size={12} />
    </div>
    {#if renaming}
      <input
        bind:this={nameInput}
        class="w-full bg-panel px-1 text-xs select-text"
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
      class={flagClass(track.muted, FLAG_DOC)}
      aria-pressed={track.muted}
      title="Mute — saved with the project and silences the export"
      onclick={() => commit((p) => setTrackMuted(p, track.id, !track.muted))}
    >
      M
    </button>
    <button
      class={flagClass(appState.soloed.has(track.id), FLAG_SESSION)}
      aria-pressed={appState.soloed.has(track.id)}
      title="Solo — preview only, never saved and never affects the export"
      onclick={() => toggleSolo(track.id)}
    >
      S
    </button>
    <button
      class={flagClass(track.ducked, FLAG_DOC)}
      aria-pressed={track.ducked}
      title="Background — saved with the project; dips this track while any other track plays"
      onclick={() => commit((p) => setTrackDucked(p, track.id, !track.ducked))}
    >
      D
    </button>
  </div>

  <Fader gain={track.gain} onInput={onGain} onCommit={onGainCommit} label="Track volume (dB)" />
</div>
