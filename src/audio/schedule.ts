import {
  clipEndS,
  PROJECT_SAMPLE_RATE,
  type Clip,
  type FadeShape,
  type Project,
} from "../doc/document";

/** The minimum gap enforced between a fade-in's end and a fade-out's start (see `scheduleClip`). */
const MIN_FADE_GAP_S = 1 / PROJECT_SAMPLE_RATE;

/**
 * Length of the automatic ramp applied to any clip edge that has no fade of its own.
 *
 * Clips never overlap (see `overlap.ts`), so butting two of them together is a hard cut: the
 * source starts and stops at whatever sample value it happens to be at, and that step
 * discontinuity ticks. 5 ms is far too short to hear as a fade — it reads as a clean edit — but
 * long enough to turn the step into a ramp. It is applied HERE, in the shared planner, so preview
 * and export declick identically; it is never written into the document, so it cannot be edited,
 * undone, or saved, and a clip's own fades always win over it.
 */
export const DECLICK_S = 0.005;

export interface FadeSpec {
  /** Seconds from the START OF THE RENDER WINDOW — feed straight to `setValueCurveAtTime`. */
  atS: number;
  durS: number;
  shape: FadeShape;
  /** The normalised sub-range of the fade that survives the window. A window that starts halfway
   *  through a 4 s fade in emits `{ fromT: 0.5, toT: 1 }`, so the remainder is rendered rather
   *  than the fade being dropped or restarted. */
  fromT: number;
  toT: number;
}

export interface ScheduledClip {
  /** Which track's GainNode this connects to. */
  trackId: string;
  sourceId: string;
  /** Seconds from the start of the render window. */
  when: number;
  /** Seconds into the source buffer. */
  sourceOffset: number;
  duration: number;
  /** The CLIP's own gain only — track and master gain are separate nodes, so the faders can be
   *  ridden during playback without rescheduling. */
  gain: number;
  fadeIn: FadeSpec | null;
  fadeOut: FadeSpec | null;
}

/** Intersect a fade's timeline span with the visible part of the clip. */
function fadeSpec(
  fadeStartS: number,
  fadeLenS: number,
  shape: FadeShape,
  visFromS: number,
  visToS: number,
  windowFromS: number,
): FadeSpec | null {
  if (fadeLenS <= 0) return null;
  const fs = Math.max(fadeStartS, visFromS);
  const fe = Math.min(fadeStartS + fadeLenS, visToS);
  if (!(fe > fs)) return null;
  return {
    atS: fs - windowFromS,
    durS: fe - fs,
    shape,
    fromT: (fs - fadeStartS) / fadeLenS,
    toT: (fe - fadeStartS) / fadeLenS,
  };
}

/** A declick ramp at one end of the audible span `[s, e)`. Capped at half the span so the two
 *  ends can never claim more than the clip has — a clip may be as short as `MIN_CLIP_S` (10 ms),
 *  which is only two declicks long. */
function declickSpec(s: number, e: number, windowFromS: number, atStart: boolean): FadeSpec | null {
  const durS = Math.min(DECLICK_S, (e - s) / 2);
  if (!(durS > 0)) return null;
  return {
    atS: (atStart ? s : e - durS) - windowFromS,
    durS,
    shape: "linear",
    fromT: 0,
    toT: 1,
  };
}

/** Do these two neighbours play as one unbroken stretch of the same audio?
 *
 *  True for the halves of a `splitAt`, which are bit-contiguous by construction: same source,
 *  touching on the timeline, and the second one's in-point continues exactly where the first's
 *  ends. Gain must match too — a step between clip gains is a real discontinuity.
 *
 *  Exported for tests. */
export function playsContinuouslyInto(prev: Clip, next: Clip): boolean {
  const eps = 1e-9;
  return (
    prev.sourceId === next.sourceId &&
    prev.gain === next.gain &&
    Math.abs(clipEndS(prev) - next.startS) < eps &&
    Math.abs(prev.inS + prev.durS - next.inS) < eps
  );
}

function scheduleClip(
  c: Clip,
  trackId: string,
  fromS: number,
  toS: number,
  joinedAtStart: boolean,
  joinedAtEnd: boolean,
): ScheduledClip | null {
  const start = c.startS;
  const end = clipEndS(c);
  const s = Math.max(start, fromS);
  const e = Math.min(end, toS);
  if (!(e > s)) return null;
  // A clip's own fade always wins; the declick only fills an edge that would otherwise be a step.
  //
  // ...and only where there IS a step. A `splitAt` leaves two halves that continue the same audio
  // sample-for-sample, so declicking both sides of that join punched a 10 ms hole to silence into
  // material that had no discontinuity at all — an edit that changes nothing else in the mix
  // became audible. `joinedAt*` suppresses the ramp at such a seam. The window edges are NOT
  // seams: if the render window cut into this clip, starting playback there is a genuine
  // discontinuity and still needs the ramp, which is what the `s === start` / `e === end` tests
  // distinguish.
  const declickIn = joinedAtStart && s === start ? null : declickSpec(s, e, fromS, true);
  const declickOut = joinedAtEnd && e === end ? null : declickSpec(s, e, fromS, false);
  let fadeIn = fadeSpec(start, c.fadeInS, c.fadeShape, s, e, fromS) ?? declickIn;
  const fadeOut = fadeSpec(end - c.fadeOutS, c.fadeOutS, c.fadeShape, s, e, fromS) ?? declickOut;
  // clampFades scales a colliding fade-in/fade-out pair to fill the clip EXACTLY, so the spans
  // built above can end up overlapping by a float ulp or abutting exactly. setValueCurveAtTime
  // throws on the former and is implementation-defined (observed to throw in Chromium) on the
  // latter, so force a strict one-sample gap by shrinking the fade-in — never the fade-out, so
  // the tail the listener actually hears reaching silence is never touched.
  if (fadeIn && fadeOut) {
    const maxEndS = fadeOut.atS - MIN_FADE_GAP_S;
    const curEndS = fadeIn.atS + fadeIn.durS;
    if (curEndS > maxEndS) {
      const newDurS = maxEndS - fadeIn.atS;
      if (newDurS <= 0) {
        fadeIn = null;
      } else {
        const scale = newDurS / fadeIn.durS;
        fadeIn = {
          ...fadeIn,
          durS: newDurS,
          toT: fadeIn.fromT + (fadeIn.toT - fadeIn.fromT) * scale,
        };
      }
    }
  }
  return {
    trackId,
    sourceId: c.sourceId,
    when: s - fromS,
    sourceOffset: c.inS + (s - start),
    duration: e - s,
    gain: c.gain,
    fadeIn,
    fadeOut,
  };
}

/**
 * Turn the document into a flat list of clips to schedule over `[fromS, toS)`.
 *
 * Pure: no AudioContext, no DOM. Live playback renders this against an `AudioContext`; the
 * mixdown renders the SAME list against an `OfflineAudioContext`. That is what makes preview and
 * export structurally incapable of drifting apart.
 *
 * `soloed` is a PARAMETER rather than a document field on purpose. Solo is monitoring state and
 * must never change what an export contains — mixdown passes an empty set, which means "no
 * soloing", and that is enforced here rather than remembered by a caller.
 */
export function planSchedule(
  p: Project,
  fromS: number,
  toS: number,
  soloed: ReadonlySet<string>,
): ScheduledClip[] {
  if (!(toS > fromS)) return [];
  const out: ScheduledClip[] = [];
  for (const t of p.tracks) {
    if (t.muted) continue;
    if (soloed.size > 0 && !soloed.has(t.id)) continue;
    for (let i = 0; i < t.clips.length; i++) {
      const c = t.clips[i];
      const prev = t.clips[i - 1];
      const next = t.clips[i + 1];
      const s = scheduleClip(
        c,
        t.id,
        fromS,
        toS,
        prev !== undefined && playsContinuouslyInto(prev, c),
        next !== undefined && playsContinuouslyInto(c, next),
      );
      if (s) out.push(s);
    }
  }
  return out;
}
