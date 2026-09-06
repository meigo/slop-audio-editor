import { MIN_CLIP_S, clipEndS, newId, type Clip } from "./document";

/** Fades must fit inside the clip and must not overlap each other — `setValueCurveAtTime` throws
 *  on overlapping curves, so this is what keeps the audio engine legal, not just tidy.
 *
 *  Scaling uses the RAW fadeInS/fadeOutS ratio, not a value pre-clamped to durS: pre-clamping the
 *  longer fade before totaling would distort the ratio (e.g. fades of 2s/4s in a 3s clip would
 *  clamp fadeOutS to 3 first, then scale 2:3 instead of the true 2:4 = 1:2 ratio). Scaling by
 *  durS/total already guarantees each result fits, so no separate upper clamp is needed. */
export function clampFades(c: Clip): Clip {
  const fi0 = Math.max(0, c.fadeInS);
  const fo0 = Math.max(0, c.fadeOutS);
  const total = fi0 + fo0;
  let fi = fi0;
  let fo = fo0;
  if (total > c.durS && total > 0) {
    const k = c.durS / total;
    fi = fi0 * k;
    fo = fo0 * k;
  }
  return fi === c.fadeInS && fo === c.fadeOutS ? c : { ...c, fadeInS: fi, fadeOutS: fo };
}

/** The part of `c` lying within `[fromS, toS)` in TIMELINE seconds, or null if nothing survives.
 *
 *  `inS` advances by exactly the amount cut off the head, so the audio that survives stays under
 *  the same timeline position it was already under. The id is KEPT — a caller producing two pieces
 *  from one clip must reassign one of them (see `insertClip`). */
export function sliceClip(c: Clip, fromS: number, toS: number): Clip | null {
  const s = Math.max(c.startS, fromS);
  const e = Math.min(clipEndS(c), toS);
  const durS = e - s;
  if (durS < MIN_CLIP_S) return null;
  // A fade belongs to the EDGE it was drawn on, not to the clip's identity. Spreading `...c`
  // carried both fades onto every piece: splitting a clip with a fade-out gave the head a
  // fade-out at the cut — audio that was at full level now tapering to silence — and the tail a
  // fade-in from silence, with `playsContinuouslyInto` still calling the seam continuous so not
  // even the declick fired. A fade survives only when the piece still has the edge it was
  // attached to.
  const keepsStart = s === c.startS;
  const keepsEnd = e === clipEndS(c);
  return clampFades({
    ...c,
    startS: s,
    inS: c.inS + (s - c.startS) * c.speed,
    durS,
    fadeInS: keepsStart ? c.fadeInS : 0,
    fadeOutS: keepsEnd ? c.fadeOutS : 0,
  });
}

/** Place `incoming` into `clips`, overwriting whatever it lands on: the dragged clip wins.
 *  Returns a new array, sorted by startS, with the non-overlap invariant restored.
 *
 *  A clip ending exactly where another begins does not overlap it — the `<=` / `>=` below are
 *  load-bearing, not off-by-one slop, or two clips placed back-to-back would spuriously get sliced. */
export function insertClip(clips: Clip[], incoming: Clip): Clip[] {
  const inEnd = clipEndS(incoming);
  const out: Clip[] = [];
  for (const c of clips) {
    if (clipEndS(c) <= incoming.startS || c.startS >= inEnd) {
      out.push(c);
      continue;
    }
    const head = sliceClip(c, -Infinity, incoming.startS);
    const tail = sliceClip(c, inEnd, Infinity);
    if (head) out.push(head);
    // Only a genuine split — both a head AND a tail surviving one original clip — produces a
    // second identity. A one-sided trim (only head or only tail survives) keeps the original id.
    if (tail) out.push(head ? { ...tail, id: newId("clip") } : tail);
  }
  out.push(incoming);
  return out.sort((a, b) => a.startS - b.startS);
}
