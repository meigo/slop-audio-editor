import { clipEndS, PROJECT_SAMPLE_RATE, type Clip, type FadeShape, type Project } from "../doc/document";

/** The minimum gap enforced between a fade-in's end and a fade-out's start (see `scheduleClip`). */
const MIN_FADE_GAP_S = 1 / PROJECT_SAMPLE_RATE;

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

function scheduleClip(c: Clip, trackId: string, fromS: number, toS: number): ScheduledClip | null {
  const start = c.startS;
  const end = clipEndS(c);
  const s = Math.max(start, fromS);
  const e = Math.min(end, toS);
  if (!(e > s)) return null;
  let fadeIn = fadeSpec(start, c.fadeInS, c.fadeShape, s, e, fromS);
  const fadeOut = fadeSpec(end - c.fadeOutS, c.fadeOutS, c.fadeShape, s, e, fromS);
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
        fadeIn = { ...fadeIn, durS: newDurS, toT: fadeIn.fromT + (fadeIn.toT - fadeIn.fromT) * scale };
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
    for (const c of t.clips) {
      const s = scheduleClip(c, t.id, fromS, toS);
      if (s) out.push(s);
    }
  }
  return out;
}
