<script lang="ts">
  import {
    ArrowLeftToLine,
    ArrowRightToLine,
    Keyboard,
    Pause,
    Play,
    Redo2,
    Repeat,
    Scale,
    Scissors,
    Square,
    Undo2,
    UnfoldHorizontal,
    X,
  } from "@lucide/svelte";
  import { createProject } from "../doc/document";
  import { setMasterGain, splitAt } from "../doc/edits";
  import {
    openProjectFile,
    pruneUnreferencedSources,
    saveProjectFile,
  } from "../persist/project-io.svelte";
  import {
    amend,
    beginGesture,
    canRedoNow,
    canUndoNow,
    clearPlayRange,
    commit,
    currentTrackId,
    endGesture,
    engine,
    importFiles,
    matchLoudness,
    pool,
    reachableProjects,
    redoEdit,
    resetSessionState,
    seekTo,
    selectedTrackIds,
    setPlayIn,
    setPlayOut,
    state as appState,
    togglePlay,
    undoEdit,
    zoomToFit,
  } from "../state/appState.svelte";
  import ExportDialog from "./ExportDialog.svelte";
  import ToolbarMenu from "./ToolbarMenu.svelte";
  import HelpOverlay from "./HelpOverlay.svelte";
  import Meter from "./Meter.svelte";
  import Fader from "./Fader.svelte";
  import { formatTime } from "./geometry";

  let fileInput = $state<HTMLInputElement | null>(null);
  let projectInput = $state<HTMLInputElement | null>(null);
  let masterDragging = false;

  // Inline rather than an `@apply` rule: in Tailwind 4 an `@apply` inside a component <style>
  // block needs an `@reference` to the stylesheet in every file, which is more ceremony than
  // one shared string.
  /** Every toolbar control is 24 px tall. Padding alone gave icon buttons 24 px and the text
   *  toggles 20 px, so the row read as two rows of slightly different things. */
  const CONTROL_H = "flex h-6 items-center justify-center rounded";
  const BTN = `${CONTROL_H} w-6 text-text hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent`;
  /** A 1px rule between toolbar groups. Whitespace alone reads as accidental at this size. */
  const DIVIDER = "mx-1 h-5 w-px shrink-0 bg-line";
  const MENU_ITEM =
    "flex w-full items-center px-3 py-1 text-left text-xs text-text hover:bg-raised";
  /** Toggle buttons, not checkboxes: the track headers already say "on" by FILLING (M / S / D),
   *  and two idioms for the same idea in one window is one too many. Text rather than an icon
   *  because "Snap" has no glyph anyone would read correctly — a cryptic icon would trade a
   *  consistency problem for a comprehension one. (Glue used the same class before it moved to
   *  the master panel, where it belongs with the rest of the master bus.) */
  const toggleClass = (on: boolean): string =>
    `${CONTROL_H} px-2 text-xs ` +
    (on ? "bg-accent font-medium text-ground" : "text-muted hover:bg-raised hover:text-text");
  /** An ICON toggle, same on-state as the text ones. Built as one string rather than layering
   *  `class:text-accent` over `BTN`: both are text-colour utilities of equal specificity, so which
   *  one wins depends on the ORDER TAILWIND EMITS THEM, not on the markup. Loop looked dead for
   *  exactly that reason — it was toggling all along, invisibly. */
  const toggleIconClass = (on: boolean): string =>
    `${CONTROL_H} w-6 ` + (on ? "bg-accent text-ground" : "text-text hover:bg-raised");

  function onMasterGain(g: number) {
    if (!masterDragging) {
      masterDragging = true;
      beginGesture("mix"); // MIX gesture — see TrackHeader
    }
    amend((p) => setMasterGain(p, g));
    engine.setMasterGain(g);
  }
</script>

<div class="flex h-11 items-center gap-3 border-b border-line bg-panel px-2 text-text">
  <!-- A File MENU rather than five icon buttons. Those needed ~132 px of a toolbar that wanted
       1190 px minimum, and none of them is pressed while actually editing — unlike the transport
       and undo, which stay as buttons. The unsaved mark moves onto the trigger: hiding Save
       behind a menu must not also hide the fact that there is something to save. -->
  <ToolbarMenu
    label="File"
    marked={appState.dirty || appState.autosaveBroken}
    markClass={appState.autosaveBroken ? "bg-warn" : "bg-accent"}
    title={appState.autosaveBroken
      ? "Autosave unavailable — this session could not be written to browser storage, so it will NOT survive a reload. Save to a file (⌘S)."
      : appState.dirty
        ? "File — unsaved changes"
        : "File"}
  >
    {#snippet children(close)}
      <button
        class={MENU_ITEM}
        onclick={() => {
          // Undoable, so it FEELS safe — but the previous project's audio is pruned from browser
          // storage on the next reload, and undo history does not survive one. Ask while there is
          // something to lose. `dirty` cannot decide this: a session restored from autosave is
          // not dirty and has never been saved to a file.
          if (
            appState.project.tracks.some((t) => t.clips.length > 0) &&
            !window.confirm(
              "Start a new project? The open one stays undoable until you reload — after that its audio is removed from browser storage unless it was saved to a file.",
            )
          ) {
            close();
            return;
          }
          commit(() => createProject());
          // The same reset `loadInto` does: a selection, in/out range or solo left over from the
          // old document would still be read by the export window and the transport.
          resetSessionState();
          // New project is an undoable commit, so the previous document is still reachable —
          // prune only what NO reachable document references, or undo comes back to dead audio.
          void pruneUnreferencedSources(
            reachableProjects(),
            pool.records().map((s) => s.id),
          );
          close();
        }}
      >
        New project
      </button>
      <button
        class={MENU_ITEM}
        onclick={() => {
          projectInput?.click();
          close();
        }}
      >
        Open project…
      </button>
      <button
        class={MENU_ITEM}
        onclick={() => {
          saveProjectFile();
          close();
        }}
      >
        Save project<span class="ml-auto pl-4 text-muted">⌘S</span>
      </button>
      <div class="my-1 border-t border-line"></div>
      <button
        class={MENU_ITEM}
        onclick={() => {
          fileInput?.click();
          close();
        }}
      >
        Import audio…
      </button>
      <button
        class={MENU_ITEM}
        onclick={() => {
          appState.exportOpen = true;
          close();
        }}
      >
        Export…
      </button>
    {/snippet}
  </ToolbarMenu>
  <input
    bind:this={projectInput}
    type="file"
    accept=".slopaudio,application/zip"
    class="hidden"
    onchange={async (e) => {
      const f = e.currentTarget.files?.[0];
      e.currentTarget.value = "";
      if (!f) return;
      appState.fileError = null; // a successful retry must clear the last failure
      try {
        await openProjectFile(f);
      } catch (err) {
        appState.fileError = err instanceof Error ? err.message : String(err);
      }
    }}
  />

  <input
    bind:this={fileInput}
    type="file"
    accept="audio/*"
    multiple
    class="hidden"
    onchange={async (e) => {
      // Copy the File objects OUT before resetting. `e.currentTarget.files` is a LIVE FileList:
      // setting `value = ""` empties that very object (same identity), so a captured reference
      // would read as length 0 and the import would silently do nothing. Individual File objects
      // are independent of the list and survive the reset — which is why the project-open handler
      // below, which grabs `files?.[0]`, was never affected.
      const files = Array.from(e.currentTarget.files ?? []);
      e.currentTarget.value = ""; // reset after copying, so re-picking the same file still works
      if (files.length === 0) return;
      appState.fileError = null; // a successful retry must clear the last failure
      try {
        await importFiles(files, currentTrackId(), appState.playheadS);
      } catch (err) {
        // A decode or autosave-write failure must be visible here, not console-only: this is the
        // main way audio enters the app, and the user needs to know if what they just imported
        // will not survive a reload.
        appState.fileError = err instanceof Error ? err.message : String(err);
      }
    }}
  />

  <div class={DIVIDER}></div>

  <div class="flex items-center gap-1">
    <button class={BTN} title="Play/pause (Space)" onclick={togglePlay}>
      {#if appState.playing}<Pause size={16} />{:else}<Play size={16} />{/if}
    </button>
    <button
      class={BTN}
      title="Stop and return the playhead to the start"
      onclick={() => {
        if (appState.playing) togglePlay();
        seekTo(0);
      }}
    >
      <Square size={16} />
    </button>
    <button
      class={toggleIconClass(appState.loop)}
      aria-pressed={appState.loop}
      title="Loop the in/out range, or the whole project (L)"
      onclick={() => (appState.loop = !appState.loop)}
    >
      <Repeat size={16} />
    </button>
    <button class={BTN} title="Set in point at playhead (I)" onclick={() => setPlayIn()}>
      <ArrowLeftToLine size={16} />
    </button>
    <button class={BTN} title="Set out point at playhead (O)" onclick={() => setPlayOut()}>
      <ArrowRightToLine size={16} />
    </button>
    <button
      class={BTN}
      disabled={appState.playRange === null}
      title="Clear in/out range (⌘I)"
      onclick={clearPlayRange}
    >
      <X size={16} />
    </button>
  </div>

  <div class={DIVIDER}></div>

  <span class="w-24 text-sm tabular-nums">{formatTime(appState.playheadS)}</span>

  <div class={DIVIDER}></div>

  <div class="flex items-center gap-1">
    <button class={BTN} disabled={!canUndoNow()} title="Undo (⌘Z)" onclick={undoEdit}>
      <Undo2 size={16} />
    </button>
    <button class={BTN} disabled={!canRedoNow()} title="Redo (⇧⌘Z)" onclick={redoEdit}>
      <Redo2 size={16} />
    </button>
    <button
      class={BTN}
      title="Split at playhead (S)"
      onclick={() => commit((p) => splitAt(p, selectedTrackIds(), appState.playheadS))}
    >
      <Scissors size={16} />
    </button>
  </div>

  <div class={DIVIDER}></div>

  <button
    class={toggleClass(appState.snap)}
    aria-pressed={appState.snap}
    title="Snap edges to clip boundaries, the playhead and t=0 while dragging (hold Shift to override)"
    onclick={() => (appState.snap = !appState.snap)}
  >
    Snap
  </button>

  <button
    class={BTN}
    title="Set every clip's gain so all clips play at the same loudness. Non-destructive: it only changes clip gain, and undo reverses it."
    onclick={matchLoudness}
  >
    <Scale size={16} />
  </button>

  <div class={DIVIDER}></div>

  <button
    class={BTN}
    title="Zoom to fit the selection, or the whole project (F)"
    onclick={() => zoomToFit("selection")}
  >
    <UnfoldHorizontal size={16} />
  </button>

  <!-- A button as well as the `?` key: the whole point of the overlay is to reach people who do
       not know the shortcuts, so reaching it can't require knowing one. -->
  <button class={BTN} title="Shortcuts and gestures (?)" onclick={() => (appState.helpOpen = true)}>
    <Keyboard size={16} />
  </button>

  <div class="ml-auto flex items-center gap-2 text-xs">
    <span class="text-muted">Master</span>
    <Meter />
    <Fader
      gain={appState.project.masterGain}
      onInput={onMasterGain}
      onCommit={() => {
        if (masterDragging) {
          masterDragging = false;
          endGesture();
        }
      }}
      label="Master volume (dB)"
    />
  </div>
</div>

{#if appState.exportOpen}
  <ExportDialog onClose={() => (appState.exportOpen = false)} />
{/if}

{#if appState.helpOpen}
  <HelpOverlay onClose={() => (appState.helpOpen = false)} />
{/if}
