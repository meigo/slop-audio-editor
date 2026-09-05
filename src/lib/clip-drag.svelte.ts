import { findClip, projectDurationS, type Project } from "../doc/document";
import { moveClips, setClipFade, trimClipEnd, trimClipStart } from "../doc/edits";
import { clipsInRange, editPoints, NO_SELECTION } from "../doc/selection";
import {
  amend, beginGesture, endGesture, pool, setCurrentTrack, state as appState,
} from "../state/appState.svelte";
import { pxToTime, snapTime } from "./geometry";
import type { ClipZone } from "./hit-test";

/** Snap candidates: every clip boundary EXCEPT the ones belonging to the clips being dragged
 *  (a clip must not snap to itself), plus the playhead and t=0. */
function snapCandidates(p: Project, movingIds: readonly string[]): number[] {
  const moving = new Set(movingIds);
  const ids = p.tracks.map((t) => t.id);
  const all = editPoints(
    { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !moving.has(c.id)) })) },
    ids,
  );
  return [...all, appState.playheadS, projectDurationS(p)];
}

/**
 * Drive one clip gesture from pointerdown to pointerup. Everything in between goes through
 * `amend` (no history); `endGesture` writes the single history entry.
 *
 * Every `amend` call below computes from `base` — the project captured once at drag start — not
 * from `appState.project` (the previous frame's result). Applying successive deltas to a moving
 * target would compound: the clip would run away from the cursor instead of tracking it 1:1.
 *
 * Shift disables snapping for the duration of the drag; the check reads `ev.shiftKey` on each
 * move event so toggling Shift mid-drag takes effect immediately, rather than latching whatever
 * state held at pointer-down.
 */
/** Which clips a drag on `clipId` moves.
 *
 *  A time-range selection counts as well as a clip selection: dragging a box across several clips
 *  and then moving one of them should move all of them, or the gesture does not do what it looks
 *  like it does. `clipsInRange` is overlap-based, so a clip the range only partly covers still
 *  moves in full — a clip cannot be half-moved, and leaving it behind would silently break up a
 *  group the user drew a box around. */
function grabbedGroup(p: Project, clipId: string): string[] {
  const sel = appState.selection;
  if (sel.kind === "clips" && sel.clipIds.includes(clipId)) return sel.clipIds;
  if (sel.kind === "range") {
    const inRange = clipsInRange(p, sel.range);
    if (inRange.includes(clipId)) return inRange;
  }
  return [clipId];
}

export function startClipDrag(e: PointerEvent, clipId: string, trackId: string, zone: ClipZone): void {
  const target = e.currentTarget as HTMLElement;
  const pointerId = e.pointerId;
  target.setPointerCapture(pointerId);
  setCurrentTrack(trackId);

  const startX = e.clientX;
  const startY = e.clientY;
  const base = appState.project;
  const found = findClip(base, clipId);
  if (!found) return;
  const original = found.clip;
  const sourceDurS = pool.get(original.sourceId)?.durationS ?? original.inS + original.durS;

  const movingIds = grabbedGroup(base, clipId);
  const candidates = snapCandidates(base, movingIds);

  beginGesture();

  function onMove(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return; // ignore a second finger's motion
    const dxS = (ev.clientX - startX) / appState.pxPerSecond;
    const snapOn = appState.snap && !ev.shiftKey;

    if (zone === "body") {
      const wanted = original.startS + dxS;
      const snapped = snapOn ? snapTime(wanted, candidates, appState.pxPerSecond) : wanted;
      const dTrack = Math.round((ev.clientY - startY) / appState.trackHeightPx);
      amend(() => moveClips(base, movingIds, snapped - original.startS, dTrack));
      return;
    }

    if (zone === "trimStart") {
      const wanted = original.startS + dxS;
      const snapped = snapOn ? snapTime(wanted, candidates, appState.pxPerSecond) : wanted;
      amend(() => trimClipStart(base, clipId, snapped - original.startS));
      return;
    }

    if (zone === "trimEnd") {
      const wanted = original.startS + original.durS + dxS;
      const snapped = snapOn ? snapTime(wanted, candidates, appState.pxPerSecond) : wanted;
      amend(() =>
        trimClipEnd(base, clipId, snapped - (original.startS + original.durS), sourceDurS),
      );
      return;
    }

    if (zone === "fadeIn") {
      amend(() => setClipFade(base, clipId, { fadeInS: Math.max(0, original.fadeInS + dxS) }));
      return;
    }

    amend(() => setClipFade(base, clipId, { fadeOutS: Math.max(0, original.fadeOutS - dxS) }));
  }

  function detach() {
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // `pointercancel` releases capture itself, so this throws on that path. Not worth
      // surfacing — the point of the call is to guarantee release, not to report it.
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  }

  /** Also bound to `pointercancel`. The OS can take a touch away mid-drag (an edge-swipe, palm
   *  rejection, a system alert) and then no `pointerup` ever arrives. Without this the gesture
   *  stays open forever: `endGesture` never runs, so the move the user can SEE is never recorded
   *  in history and never reschedules playback, and the window listeners leak. Finishing where
   *  the pointer stopped is the least surprising outcome — the clip is left where it looks. */
  function onUp(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return; // a second finger must not end this drag
    detach();
    endGesture();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/**
 * Drag on empty lane area = time-range selection. Vertical travel extends the range across
 * tracks. `trackId` is the lane the drag started on — it anchors the vertical extent even though
 * the range's actual track list is recomputed from cursor position on every move.
 *
 * A range selection carries no history and touches no clip, so unlike `startClipDrag` this never
 * calls `beginGesture`/`amend`/`endGesture` — it only ever assigns `appState.selection`.
 */
export function startRangeDrag(e: PointerEvent, trackId: string): void {
  const target = e.currentTarget as HTMLElement;
  const pointerId = e.pointerId;
  const rect = target.getBoundingClientRect();
  const startY = e.clientY;
  const anchorS = pxToTime(e.clientX - rect.left, appState.scrollS, appState.pxPerSecond);
  const anchorIndex = appState.project.tracks.findIndex((t) => t.id === trackId);
  setCurrentTrack(trackId);
  appState.selection = NO_SELECTION;
  target.setPointerCapture(pointerId);

  function onMove(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    const s = pxToTime(ev.clientX - rect.left, appState.scrollS, appState.pxPerSecond);
    const overIndex = Math.max(
      0,
      Math.min(
        appState.project.tracks.length - 1,
        anchorIndex + Math.round((ev.clientY - startY) / appState.trackHeightPx),
      ),
    );
    const lo = Math.min(anchorIndex, overIndex);
    const hi = Math.max(anchorIndex, overIndex);
    appState.selection = {
      kind: "range",
      range: {
        fromS: Math.max(0, Math.min(anchorS, s)),
        toS: Math.max(anchorS, s),
        trackIds: appState.project.tracks.slice(lo, hi + 1).map((t) => t.id),
      },
    };
  }

  function onUp(ev: PointerEvent) {
    if (ev.pointerId !== pointerId) return;
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // Already released — `pointercancel` does that for us.
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    // A click with no drag is a deselect, not a zero-length range.
    if (
      appState.selection.kind === "range" &&
      appState.selection.range.toS - appState.selection.range.fromS < 0.001
    ) {
      appState.selection = NO_SELECTION;
    }
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
