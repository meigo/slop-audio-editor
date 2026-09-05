import { describe, expect, it } from "vitest";
import { createProject, type Project } from "../doc/document";
import { addClip, addTrack, makeClip, setTrackDucked, setTrackMuted } from "../doc/edits";
import { DUCK_ATTACK_S, DUCK_GAIN, DUCK_RELEASE_S, foregroundSpans, planDucking } from "./ducking";

/** Track 0 = "music" (ducked), track 1 = "voice" (foreground). */
function project(voice: [number, number][], music: [number, number][] = [[0, 30]]): Project {
  let p = addTrack(createProject("p"), "voice");
  for (const [start, dur] of music) p = addClip(p, p.tracks[0].id, makeClip("m", start, dur));
  for (const [start, dur] of voice) p = addClip(p, p.tracks[1].id, makeClip("v", start, dur));
  return setTrackDucked(p, p.tracks[0].id, true);
}

describe("foregroundSpans", () => {
  it("returns the spans of clips on tracks that are NOT ducked", () => {
    expect(foregroundSpans(project([[2, 3]]))).toEqual([{ fromS: 2, toS: 5 }]);
  });

  it("ignores the ducked track's own clips — music must not duck itself", () => {
    expect(foregroundSpans(project([], [[0, 10]]))).toEqual([]);
  });

  it("merges overlapping spans", () => {
    expect(
      foregroundSpans(
        project([
          [0, 4],
          [2, 4],
        ]),
      ),
    ).toEqual([{ fromS: 0, toS: 6 }]);
  });

  it("merges spans separated by less than the recovery time, so the bed does not pump", () => {
    // A 0.2 s breath between two sentences is shorter than attack + release: bringing the music
    // back up and straight down again is worse than staying down.
    const spans = foregroundSpans(
      project([
        [0, 2],
        [2.2, 2],
      ]),
    );
    expect(spans).toEqual([{ fromS: 0, toS: 4.2 }]);
  });

  it("keeps spans apart when the gap is comfortably longer than the recovery", () => {
    const gap = DUCK_ATTACK_S + DUCK_RELEASE_S + 1;
    expect(
      foregroundSpans(
        project([
          [0, 2],
          [2 + gap, 2],
        ]),
      ),
    ).toHaveLength(2);
  });

  it("ignores muted foreground tracks — a muted voice is not in the mix to duck against", () => {
    const p = project([[2, 3]]);
    expect(foregroundSpans(setTrackMuted(p, p.tracks[1].id, true))).toEqual([]);
  });
});

describe("planDucking", () => {
  it("is empty when no track is ducked", () => {
    let p = addTrack(createProject("p"), "voice");
    p = addClip(p, p.tracks[1].id, makeClip("v", 0, 5));
    expect(planDucking(p, 0, 10).size).toBe(0);
  });

  it("is empty when a ducked track has nothing to duck against", () => {
    expect(planDucking(project([]), 0, 10).size).toBe(0);
  });

  it("dips to the duck gain and recovers to unity", () => {
    const p = project([[2, 3]]);
    const pts = planDucking(p, 0, 20).get(p.tracks[0].id)!;
    expect(pts).toEqual([
      { t: 0, gain: 1 },
      { t: 2 - DUCK_ATTACK_S, gain: 1 },
      { t: 2, gain: DUCK_GAIN },
      { t: 5, gain: DUCK_GAIN },
      { t: 5 + DUCK_RELEASE_S, gain: 1 },
    ]);
  });

  // The attack RAMP happens before the voice, so the bed is already down at the voice's first
  // sample. A real-time sidechain cannot do this without lookahead latency; computing the
  // envelope from clip positions can, for free.
  it("is already at full depth when the foreground starts, not still ramping into it", () => {
    const p = project([[2, 3]]);
    const pts = planDucking(p, 0, 20).get(p.tracks[0].id)!;
    const atVoiceStart = pts.find((pt) => pt.t === 2)!;
    expect(atVoiceStart.gain).toBeCloseTo(DUCK_GAIN, 10);
  });

  // The pre-roll clamps to 0 for a span at the very start, which makes two coincident points
  // there. Resolving that tie the wrong way left the bed ramping slowly DOWN across the whole
  // voice and only reaching depth as it ended — the exact opposite of the feature.
  it("is already at full depth when the foreground starts at exactly t=0", () => {
    const p = project([[0, 5]]);
    const pts = planDucking(p, 0, 30).get(p.tracks[0].id)!;
    expect(pts[0]).toEqual({ t: 0, gain: DUCK_GAIN });
    expect(pts.find((x) => x.t === 5)!.gain).toBeCloseTo(DUCK_GAIN, 10);
  });

  it("clamps the pre-roll at the timeline start rather than emitting a negative time", () => {
    const p = project([[0.02, 3]]); // less than one attack from t = 0
    const pts = planDucking(p, 0, 20).get(p.tracks[0].id)!;
    expect(pts.every((pt) => pt.t >= 0)).toBe(true);
  });

  it("uses the project's duck depth", () => {
    const p = { ...project([[2, 3]]), duckDepthDb: -6 };
    const pts = planDucking(p, 0, 20).get(p.tracks[0].id)!;
    expect(Math.min(...pts.map((x) => x.gain))).toBeCloseTo(10 ** (-6 / 20), 10);
  });

  it("emits no envelope at all when the depth is 0 dB — nothing to do", () => {
    const p = { ...project([[2, 3]]), duckDepthDb: 0 };
    expect(planDucking(p, 0, 20).size).toBe(0);
  });

  it("never emits an envelope for a muted ducked track", () => {
    const p = project([[2, 3]]);
    expect(planDucking(setTrackMuted(p, p.tracks[0].id, true), 0, 20).size).toBe(0);
  });

  // A window opening mid-duck must START ducked, not ramp down from unity — otherwise seeking
  // into the middle of a voiceover would let the music jump up for a moment.
  it("starts already ducked when the window opens inside a duck", () => {
    const p = project([[2, 10]]);
    const pts = planDucking(p, 5, 8).get(p.tracks[0].id)!;
    expect(pts[0]).toEqual({ t: 0, gain: DUCK_GAIN });
  });

  it("expresses points relative to the window start, like ScheduledClip.when", () => {
    const p = project([[10, 2]]);
    const pts = planDucking(p, 8, 20).get(p.tracks[0].id)!;
    expect(pts.some((p) => p.t === 2)).toBe(true); // the duck starts 2 s into the window
  });
});
