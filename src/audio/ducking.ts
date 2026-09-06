import { clipEndS, DEFAULT_DUCK_DEPTH_DB, type Project } from "../doc/document";

/** How far a background track dips while something else is playing — the DEFAULT depth, which
 *  `project.duckDepthDb` overrides; -12 dB is the common broadcast starting point, clearly audible
 *  without the bed vanishing.
 *
 *  The depth is adjustable, but the TIMING is not: attack and release are the part that has a
 *  right answer, and exposing them would be four knobs for a feature that earns its keep by being
 *  one toggle. */
export const DUCK_GAIN = 10 ** (DEFAULT_DUCK_DEPTH_DB / 20);
export const DUCK_ATTACK_S = 0.08;
export const DUCK_RELEASE_S = 0.4;

export interface Span {
  fromS: number;
  toS: number;
}

/** One breakpoint of a track's duck envelope. `t` is SECONDS FROM THE START OF THE RENDER
 *  WINDOW — the same base as `ScheduledClip.when`, so it feeds the node graph directly. */
export interface DuckPoint {
  t: number;
  gain: number;
}

/**
 * Merged time spans where any FOREGROUND audio exists — every unmuted, non-ducked track's clips.
 *
 * Absolute project seconds. Muted tracks are excluded because they are not in the mix, so there
 * is nothing to duck against. Solo is deliberately NOT considered: it is monitoring state, and
 * letting it change the envelope would make a soloed preview disagree with the export.
 */
export function foregroundSpans(p: Project): Span[] {
  const raw: Span[] = [];
  for (const t of p.tracks) {
    if (t.muted || t.ducked) continue;
    for (const c of t.clips) raw.push({ fromS: c.startS, toS: clipEndS(c) });
  }
  raw.sort((a, b) => a.fromS - b.fromS);

  // Spans closer together than the envelope needs to recover and dip again are merged. A short
  // breath between two sentences is shorter than attack + release, and bringing the bed up only
  // to pull it straight back down is worse than leaving it down.
  const gap = DUCK_ATTACK_S + DUCK_RELEASE_S;
  const out: Span[] = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && s.fromS - last.toS <= gap) last.toS = Math.max(last.toS, s.toS);
    else out.push({ ...s });
  }
  return out;
}

/** Absolute-time breakpoints of the envelope produced by `spans`. Because spans are merged when
 *  closer than attack + release, these are always strictly increasing in time. */
function breakpoints(spans: readonly Span[], duckGain: number): DuckPoint[] {
  const pts: DuckPoint[] = [];
  for (const s of spans) {
    // The attack ramp sits BEFORE the span, so full depth is reached at the foreground's first
    // sample rather than 80 ms into it — the consonant that carries the word would otherwise land
    // over an undipped bed. A real-time sidechain would need a lookahead buffer (and the latency
    // that costs) to do this; reading clip positions from the document gets it for nothing.
    pts.push({ t: Math.max(0, s.fromS - DUCK_ATTACK_S), gain: 1 });
    pts.push({ t: s.fromS, gain: duckGain });
    pts.push({ t: s.toS, gain: duckGain });
    pts.push({ t: s.toS + DUCK_RELEASE_S, gain: 1 });
  }
  return pts;
}

/** The envelope's value at an absolute time, linearly interpolated. Unity outside every span.
 *
 *  `t < pts[0].t`, NOT `<=`. A span starting at 0 has its pre-roll clamped to 0, so it emits two
 *  coincident points there — unity, then full depth. Returning unity for `t === pts[0].t` picked
 *  the first of them, and the window filter below then dropped both, leaving the bed to ramp
 *  slowly down across the whole voice instead of being down for it. */
function valueAt(pts: readonly DuckPoint[], t: number): number {
  if (pts.length === 0 || t < pts[0].t) return 1;
  if (t >= pts[pts.length - 1].t) return 1;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1];
      const b = pts[i];
      const span = b.t - a.t;
      return span <= 0 ? b.gain : a.gain + ((t - a.t) / span) * (b.gain - a.gain);
    }
  }
  return 1;
}

/**
 * Gain envelopes for every ducked track over `[fromS, toS)`, keyed by track id.
 *
 * Pure — no AudioContext, no DOM — and derived from clip POSITIONS rather than from audio
 * content, which is what lets it be computed identically for live playback and for the offline
 * mixdown. Tracks with a constant-unity envelope are omitted entirely, so no node is built for
 * them.
 */
export function planDucking(p: Project, fromS: number, toS: number): Map<string, DuckPoint[]> {
  const out = new Map<string, DuckPoint[]>();
  if (!(toS > fromS)) return out;

  const ducked = p.tracks.filter((t) => t.ducked && !t.muted);
  if (ducked.length === 0) return out;

  const depthDb = p.duckDepthDb ?? DEFAULT_DUCK_DEPTH_DB;
  if (depthDb >= 0) return out; // 0 dB means "no ducking" — build nothing rather than a flat line

  const pts = breakpoints(foregroundSpans(p), 10 ** (depthDb / 20));
  if (pts.length === 0) return out;

  // A window opening mid-duck starts already down, rather than ramping from unity — otherwise
  // seeking into the middle of a voiceover would let the bed jump up for a moment.
  const window: DuckPoint[] = [{ t: 0, gain: valueAt(pts, fromS) }];
  for (const pt of pts) {
    if (pt.t > fromS && pt.t <= toS) window.push({ t: pt.t - fromS, gain: pt.gain });
  }
  if (window.length === 1 && window[0].gain === 1) return out;

  for (const t of ducked) out.set(t.id, window);
  return out;
}
