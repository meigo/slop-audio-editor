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
  import { isInView, pinchUpdate, timeToPx } from "./geometry";
  import { isTypingTarget, repeatsOnHold, resolveShortcut } from "./shortcuts";

  const { onSave }: { onSave: () => void } = $props();

  function onKeyDown(e: KeyboardEvent) {
    // A shortcut must never fire while the user is typing into the inspector or a rename field —
    // but a slider is not a typing surface, and treating one as such killed every shortcut for as
    // long as a fader kept focus. `isTypingTarget` is pure and tested.
    const el = e.target as HTMLElement | null;
    if (el && isTypingTarget(el)) return;

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
    // Auto-repeat from a held key drives nudge and zoom deliberately; a toggle it just stutters,
    // and a held Space restarted playback dozens of times a second.
    if (e.repeat && !repeatsOnHold(cmd.kind)) return;
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
      case "zoom": {
        // About the playhead when it is on screen, else about the view's centre — never about the
        // left edge, which zoomed the thing you were looking at out of view. `pinchUpdate` is the
        // same arithmetic the two-finger gesture uses: a spread ratio of `factor` at one anchor.
        const w = appState.timelineWidthPx;
        const { scrollS, pxPerSecond } = appState;
        const anchorPx = isInView(appState.playheadS, scrollS, pxPerSecond, w)
          ? timeToPx(appState.playheadS, scrollS, pxPerSecond)
          : w / 2;
        const next = pinchUpdate(
          { pxPerSecond, scrollS, centerPx: anchorPx, spreadPx: 1 },
          { centerPx: anchorPx, spreadPx: cmd.factor },
        );
        appState.pxPerSecond = next.pxPerSecond;
        appState.scrollS = next.scrollS;
        return;
      }
      case "zoomFit":
        return zoomToFit(cmd.scope);
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />
