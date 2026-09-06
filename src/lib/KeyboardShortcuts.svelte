<script lang="ts">
  import { moveClips, setTrackMuted, splitAt } from "../doc/edits";
  import { editPoints, nextEditPoint, prevEditPoint, NO_SELECTION } from "../doc/selection";
  import {
    clearPlayRange,
    commit,
    copySelection,
    currentTrackId,
    cutSelection,
    modalOpen,
    deleteSelection,
    duplicateSelection,
    pasteAtPlayhead,
    redoEdit,
    seekTo,
    selectedTrackIds,
    setPlayIn,
    setPlayOut,
    state as appState,
    toggleSolo,
    togglePlay,
    undoEdit,
    zoomToFit,
  } from "../state/appState.svelte";
  import { resolveShortcut } from "./shortcuts";

  const { onSave }: { onSave: () => void } = $props();

  /** A shortcut must never fire while the user is typing into the inspector or a rename field. */
  function isTextTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isTextTarget(e.target)) return;

    // While ANY modal is up, the only keys that do anything are the ones that dismiss it. Editing
    // the project behind a dialog you cannot see the result through is not a feature — and the
    // export dialog is the worse case of the two, since it holds a rendered buffer of a mix the
    // edit would invalidate.
    if (modalOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        appState.helpOpen = false;
        appState.exportOpen = false;
      } else if (e.key === "?" && appState.helpOpen) {
        e.preventDefault();
        appState.helpOpen = false;
      }
      return;
    }

    const cmd = resolveShortcut(e);
    if (!cmd) return;
    e.preventDefault();

    switch (cmd.kind) {
      case "showHelp":
        appState.helpOpen = true;
        return;
      case "togglePlay":
        return togglePlay();
      case "split":
        return commit((p) => splitAt(p, selectedTrackIds(), appState.playheadS));
      case "toggleLoop":
        appState.loop = !appState.loop;
        return;
      case "toggleMute": {
        const id = currentTrackId();
        const muted = appState.project.tracks.find((t) => t.id === id)?.muted ?? false;
        return commit((p) => setTrackMuted(p, id, !muted));
      }
      case "toggleSolo":
        return toggleSolo(currentTrackId());
      case "selectAll": {
        const ids = appState.project.tracks.flatMap((t) => t.clips.map((c) => c.id));
        appState.selection = ids.length > 0 ? { kind: "clips", clipIds: ids } : NO_SELECTION;
        return;
      }
      case "setIn":
        return setPlayIn();
      case "setOut":
        return setPlayOut();
      case "clearPlayRange":
        return clearPlayRange();
      case "delete":
        return deleteSelection(cmd.ripple);
      case "copy":
        return copySelection();
      case "cut":
        return cutSelection();
      case "paste":
        return pasteAtPlayhead();
      case "duplicate":
        return duplicateSelection();
      case "undo":
        return undoEdit();
      case "redo":
        return redoEdit();
      case "save":
        return onSave();
      case "nudge": {
        if (appState.selection.kind === "clips") {
          const ids = appState.selection.clipIds;
          return commit((p) => moveClips(p, ids, cmd.deltaS, 0));
        }
        return seekTo(appState.playheadS + cmd.deltaS);
      }
      case "jumpEdit": {
        const points = editPoints(appState.project, selectedTrackIds());
        const next =
          cmd.direction === 1
            ? nextEditPoint(points, appState.playheadS)
            : prevEditPoint(points, appState.playheadS);
        return seekTo(next ?? appState.playheadS);
      }
      case "zoom":
        appState.pxPerSecond = Math.min(2000, Math.max(2, appState.pxPerSecond * cmd.factor));
        return;
      case "zoomFit":
        return zoomToFit(cmd.scope);
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />
