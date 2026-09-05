<script lang="ts">
  import { projectDurationS } from "../doc/document";
  import {
    deleteClips, deleteRange, moveClips, setTrackMuted, splitAt,
  } from "../doc/edits";
  import { editPoints, nextEditPoint, prevEditPoint, NO_SELECTION } from "../doc/selection";
  import {
    clearPlayRange, commit, copySelection, currentTrackId, cutSelection, pasteAtPlayhead,
    redoEdit, seekTo, selectedTrackIds, setPlayIn, setPlayOut, state as appState, toggleSolo,
    togglePlay, undoEdit,
  } from "../state/appState.svelte";
  import { resolveShortcut } from "./shortcuts";

  const { onSave, viewportWidthPx }: { onSave: () => void; viewportWidthPx: number } = $props();

  /** A shortcut must never fire while the user is typing into the inspector or a rename field. */
  function isTextTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isTextTarget(e.target)) return;

    // While the overlay is up, the only keys that do anything are the ones that dismiss it.
    // Editing the project behind a modal you cannot see the result through is not a feature.
    if (appState.helpOpen) {
      if (e.key === "Escape" || e.key === "?") {
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
      case "delete": {
        if (appState.selection.kind === "clips") {
          const ids = appState.selection.clipIds;
          appState.selection = NO_SELECTION;
          return commit((p) => deleteClips(p, ids));
        }
        if (appState.selection.kind === "range") {
          const r = appState.selection.range;
          return commit((p) => deleteRange(p, r.trackIds, r.fromS, r.toS, cmd.ripple));
        }
        return;
      }
      case "copy":
        return copySelection();
      case "cut":
        return cutSelection();
      case "paste":
        return pasteAtPlayhead();
      case "duplicate":
        copySelection();
        return pasteAtPlayhead();
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
      case "zoomFit": {
        const dur = projectDurationS(appState.project);
        appState.scrollS = 0;
        appState.pxPerSecond = dur > 0 ? Math.max(2, (viewportWidthPx - 24) / dur) : 60;
        return;
      }
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />
