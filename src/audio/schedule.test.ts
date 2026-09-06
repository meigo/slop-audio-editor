import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project, type Clip } from "../doc/document";
import {
  addClip,
  addTrack,
  makeClip,
  setClipFade,
  setClipGain,
  setTrackMuted,
  splitAt,
} from "../doc/edits";
import {
  DECLICK_S,
  masterFadeInSpec,
  masterFadeSpec,
  planSchedule,
  playsContinuouslyInto,
} from "./schedule";

const NO_SOLO: ReadonlySet<string> = new Set();

/** One track, one clip: 10 s of source starting 2 s in, placed at t=5. */
function oneClip(): Project {
  const base = createProject();
  return addClip(base, base.tracks[0].id, makeClip("s", 5, 10, 2));
}

beforeEach(() => __resetIds());

describe("planSchedule window", () => {
  it("places a clip that sits wholly inside the window", () => {
    const plan = planSchedule(oneClip(), 0, 100, NO_SOLO);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ when: 5, sourceOffset: 2, duration: 10, gain: 1 });
  });

  it("makes `when` relative to the window start, not to t=0", () => {
    expect(planSchedule(oneClip(), 3, 100, NO_SOLO)[0].when).toBe(2);
  });

  it("enters a clip partway when the window starts inside it", () => {
    const plan = planSchedule(oneClip(), 8, 100, NO_SOLO);
    expect(plan[0]).toMatchObject({ when: 0, sourceOffset: 5, duration: 7 });
  });

  it("truncates a clip the window ends inside", () => {
    expect(planSchedule(oneClip(), 0, 9, NO_SOLO)[0]).toMatchObject({ when: 5, duration: 4 });
  });

  it("omits clips entirely outside the window, on either side", () => {
    expect(planSchedule(oneClip(), 20, 30, NO_SOLO)).toEqual([]);
    expect(planSchedule(oneClip(), 0, 5, NO_SOLO)).toEqual([]);
  });

  it("returns nothing for an empty or inverted window", () => {
    expect(planSchedule(oneClip(), 5, 5, NO_SOLO)).toEqual([]);
    expect(planSchedule(oneClip(), 9, 5, NO_SOLO)).toEqual([]);
  });
});

describe("planSchedule gain, mute and solo", () => {
  it("carries the clip's own gain and NOT the track gain", () => {
    let p = oneClip();
    p = setClipGain(p, p.tracks[0].clips[0].id, 0.5);
    p.tracks[0].gain = 0.25;
    expect(planSchedule(p, 0, 100, NO_SOLO)[0].gain).toBe(0.5);
  });

  it("drops a muted track", () => {
    let p = oneClip();
    p = setTrackMuted(p, p.tracks[0].id, true);
    expect(planSchedule(p, 0, 100, NO_SOLO)).toEqual([]);
  });

  it("drops every track outside a non-empty solo set", () => {
    let p = oneClip();
    p = addTrack(p, "B");
    p = addClip(p, p.tracks[1].id, makeClip("s", 0, 4));
    const plan = planSchedule(p, 0, 100, new Set([p.tracks[1].id]));
    expect(plan).toHaveLength(1);
    expect(plan[0].trackId).toBe(p.tracks[1].id);
  });

  it("an EMPTY solo set means no soloing — this is what mixdown passes", () => {
    let p = oneClip();
    p = addTrack(p, "B");
    p = addClip(p, p.tracks[1].id, makeClip("s", 0, 4));
    expect(planSchedule(p, 0, 100, NO_SOLO)).toHaveLength(2);
  });

  it("mute still wins over solo", () => {
    let p = oneClip();
    p = setTrackMuted(p, p.tracks[0].id, true);
    expect(planSchedule(p, 0, 100, new Set([p.tracks[0].id]))).toEqual([]);
  });
});

describe("planSchedule fades", () => {
  it("declicks a clip that has no fades of its own", () => {
    // A bare cut starts and stops the source at whatever sample value it happens to be at, which
    // is a step discontinuity and ticks. Both edges get a short linear ramp instead.
    const plan = planSchedule(oneClip(), 0, 100, NO_SOLO);
    expect(plan[0].fadeIn).toMatchObject({ atS: 5, durS: DECLICK_S, shape: "linear" });
    expect(plan[0].fadeOut).toMatchObject({
      atS: 15 - DECLICK_S,
      durS: DECLICK_S,
      shape: "linear",
    });
  });

  it("declicks the point where a window opens mid-clip, not the clip's own start", () => {
    // Seeking into the middle of a clip is just as much a discontinuity as an edit is.
    expect(planSchedule(oneClip(), 8, 100, NO_SOLO)[0].fadeIn).toMatchObject({
      atS: 0,
      durS: DECLICK_S,
    });
  });

  it("is short enough to be inaudible as a fade", () => {
    expect(DECLICK_S).toBeLessThanOrEqual(0.01);
    expect(DECLICK_S).toBeGreaterThan(0);
  });

  it("emits a whole fade in at the clip's start", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 2, fadeShape: "equalPower" });
    expect(planSchedule(p, 0, 100, NO_SOLO)[0].fadeIn).toEqual({
      atS: 5,
      durS: 2,
      shape: "equalPower",
      fromT: 0,
      toT: 1,
    });
  });

  it("emits a whole fade out ending at the clip's end", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeOutS: 3 });
    expect(planSchedule(p, 0, 100, NO_SOLO)[0].fadeOut).toMatchObject({
      atS: 12,
      durS: 3,
      fromT: 0,
      toT: 1,
    });
  });

  it("renders the REMAINDER of a fade in the window started partway through", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 4 });
    const fade = planSchedule(p, 6, 100, NO_SOLO)[0].fadeIn!;
    expect(fade).toMatchObject({ atS: 0, durS: 3, fromT: 0.25, toT: 1 });
  });

  it("truncates a fade out the window ends inside", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeOutS: 4 });
    const fade = planSchedule(p, 0, 13, NO_SOLO)[0].fadeOut!;
    expect(fade).toMatchObject({ atS: 11, durS: 2, fromT: 0, toT: 0.5 });
  });

  it("drops a fade the window missed entirely, leaving only the declick", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 2 });
    // The real 2 s fade ended before the window opened, so what is left is the declick at the
    // window edge — NOT a resumed fragment of the fade.
    expect(planSchedule(p, 8, 100, NO_SOLO)[0].fadeIn).toMatchObject({ atS: 0, durS: DECLICK_S });
  });

  it("never replaces a real fade with a declick", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 2, fadeOutS: 3 });
    const sc = planSchedule(p, 0, 100, NO_SOLO)[0];
    expect(sc.fadeIn).toMatchObject({ durS: 2 });
    expect(sc.fadeOut).toMatchObject({ durS: 3 });
  });

  it("keeps the declick inside a very short clip, and the spans still do not overlap", () => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 0, 0.01)); // MIN_CLIP_S
    const sc = planSchedule(p, 0, 100, NO_SOLO)[0];
    const inEnd = sc.fadeIn!.atS + sc.fadeIn!.durS;
    expect(sc.fadeIn!.durS).toBeGreaterThan(0);
    expect(inEnd).toBeLessThan(sc.fadeOut!.atS);
    expect(sc.fadeOut!.atS + sc.fadeOut!.durS).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it("never emits overlapping fade spans", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 6, fadeOutS: 6 });
    const s = planSchedule(p, 0, 100, NO_SOLO)[0];
    // Strict, no tolerance: setValueCurveAtTime throws on an overlap and is
    // implementation-defined on exact abutment, so the two spans must never touch.
    expect(s.fadeIn!.atS + s.fadeIn!.durS).toBeLessThan(s.fadeOut!.atS);
  });

  it("keeps fade-in and fade-out strictly separated across many clamped fade-length pairs", () => {
    const clipDurS = 10; // oneClip()'s clip length
    let sawClamp = false;
    for (let fadeInS = 0.1; fadeInS < clipDurS; fadeInS += 0.37) {
      for (let fadeOutS = 0.1; fadeOutS < clipDurS; fadeOutS += 0.41) {
        if (fadeInS + fadeOutS > clipDurS) sawClamp = true;
        let p = oneClip();
        p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS, fadeOutS });
        const s = planSchedule(p, 0, 100, NO_SOLO)[0];
        if (s.fadeIn && s.fadeOut) {
          expect(s.fadeIn.atS + s.fadeIn.durS).toBeLessThan(s.fadeOut.atS);
        }
      }
    }
    expect(sawClamp).toBe(true); // sanity: the sweep actually drove clampFades
  });
});

describe("planSchedule ordering", () => {
  it("returns clips in track order, then in time order", () => {
    let p = createProject();
    p = addTrack(p, "B");
    p = addClip(p, p.tracks[0].id, makeClip("s", 4, 1));
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 1));
    p = addClip(p, p.tracks[1].id, makeClip("s", 2, 1));
    const plan = planSchedule(p, 0, 100, NO_SOLO);
    expect(plan.map((s) => [s.trackId === p.tracks[0].id ? "A" : "B", s.when])).toEqual([
      ["A", 0],
      ["A", 4],
      ["B", 2],
    ]);
  });
});

describe("declick at a seam between contiguous clips", () => {
  /** One clip cut in two by `splitAt`: the halves are bit-contiguous, so the join is not a step. */
  function splitOnce(): Project {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 0, 30));
    return splitAt(p, [p.tracks[0].id], 15);
  }

  it("leaves a split seam alone — declicking it punched a hole in continuous audio", () => {
    const [a, b] = planSchedule(splitOnce(), 0, 100, NO_SOLO);
    expect(a.fadeOut).toBeNull();
    expect(b.fadeIn).toBeNull();
  });

  it("still declicks the outer edges of those same two clips", () => {
    const [a, b] = planSchedule(splitOnce(), 0, 100, NO_SOLO);
    expect(a.fadeIn).toMatchObject({ atS: 0, durS: DECLICK_S });
    expect(b.fadeOut).toMatchObject({ durS: DECLICK_S });
  });

  it("declicks the seam when the halves differ in gain — that IS a step", () => {
    const p = splitOnce();
    const withGain = setClipGain(p, p.tracks[0].clips[1].id, 0.5);
    const [a, b] = planSchedule(withGain, 0, 100, NO_SOLO);
    expect(a.fadeOut).not.toBeNull();
    expect(b.fadeIn).not.toBeNull();
  });

  it("declicks between two different sources butted together", () => {
    const base = createProject();
    let p = addClip(base, base.tracks[0].id, makeClip("a", 0, 15));
    p = addClip(p, p.tracks[0].id, makeClip("b", 15, 15));
    const [a, b] = planSchedule(p, 0, 100, NO_SOLO);
    expect(a.fadeOut).not.toBeNull();
    expect(b.fadeIn).not.toBeNull();
  });

  it("declicks a seam the window opens exactly on — the other half never played", () => {
    // Split at 15, then press Space with the playhead still on the cut. The first half is not in
    // the window at all, so the second half starts from silence: a genuine step, and the exact
    // case DECLICK_S exists for. `joinedAtStart` used to be decided from the document neighbour
    // alone, which said "continuous" and suppressed the ramp.
    const plan = planSchedule(splitOnce(), 15, 100, NO_SOLO);
    expect(plan).toHaveLength(1);
    expect(plan[0].fadeIn).toMatchObject({ atS: 0, durS: DECLICK_S });
  });

  it("declicks a seam the window ends exactly on", () => {
    const plan = planSchedule(splitOnce(), 0, 15, NO_SOLO);
    expect(plan).toHaveLength(1);
    expect(plan[0].fadeOut).toMatchObject({ durS: DECLICK_S });
  });

  it("still leaves the seam dry when BOTH halves are in the window", () => {
    const [a, b] = planSchedule(splitOnce(), 10, 20, NO_SOLO);
    expect(a.fadeOut).toBeNull();
    expect(b.fadeIn).toBeNull();
  });

  it("declicks where the WINDOW cuts into a clip, seam or not", () => {
    // Opening playback mid-clip is a genuine discontinuity even though the clip continues its
    // neighbour: the previous audio was never played.
    const plan = planSchedule(splitOnce(), 20, 100, NO_SOLO);
    expect(plan[0].fadeIn).toMatchObject({ atS: 0, durS: DECLICK_S });
  });
});

describe("varispeed", () => {
  const fast = (over: Partial<Clip> = {}): Clip => ({
    ...makeClip("s1", 0, 5),
    speed: 2,
    ...over,
  });

  it("passes SOURCE seconds as the duration, so the clip still sounds for its timeline length", () => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, fast());
    const plan = planSchedule(p, 0, 60, new Set());
    // 5 s of timeline at 2x consumes 10 s of source; start()'s duration is in buffer time.
    expect(plan[0].duration).toBeCloseTo(10, 9);
    expect(plan[0].speed).toBe(2);
  });

  it("scales the in-point when the window cuts into a sped-up clip", () => {
    let p = createProject();
    p = addClip(p, p.tracks[0].id, fast({ startS: 0, inS: 4 }));
    const plan = planSchedule(p, 1, 60, new Set()); // window starts 1 timeline second in

    expect(plan[0].sourceOffset).toBeCloseTo(4 + 2, 9); // one timeline second = two source seconds
    expect(plan[0].duration).toBeCloseTo(8, 9);
  });
});

describe("playsContinuouslyInto with speed", () => {
  it("is true for split halves that share a speed", () => {
    const prev = { ...makeClip("s1", 0, 5), speed: 2 };
    const next = { ...makeClip("s1", 5, 5), speed: 2, inS: 10 }; // 5 s at 2x consumed 10 s
    expect(playsContinuouslyInto(prev, next)).toBe(true);
  });

  it("is false when the speeds differ — a pitch step is a real discontinuity", () => {
    const prev = { ...makeClip("s1", 0, 5), speed: 2 };
    const next = { ...makeClip("s1", 5, 5), speed: 1, inS: 10 };
    expect(playsContinuouslyInto(prev, next)).toBe(false);
  });

  it("uses SOURCE seconds for the in-point join, not timeline seconds", () => {
    const prev = { ...makeClip("s1", 0, 5), speed: 2 };
    // 5 timeline seconds at 2x is 10 source seconds; an in-point of 5 would be the speed-1 answer.
    expect(playsContinuouslyInto(prev, { ...makeClip("s1", 5, 5), speed: 2, inS: 5 })).toBe(false);
  });
});

describe("masterFadeSpec", () => {
  /** A 10 s project: one clip from 0 to 10. */
  const tenSeconds = (fadeOutS: number): Project => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 0, 10));
    return { ...p, fadeOutS };
  };

  it("is null when there is no fade", () => {
    expect(masterFadeSpec(tenSeconds(0), { fromS: 0, toS: 10 })).toBe(null);
  });

  it("sits at the PROJECT's end, not the window's", () => {
    // Exporting only the first half must not invent a fade at 5 s.
    expect(masterFadeSpec(tenSeconds(3), { fromS: 0, toS: 5 })).toBe(null);

    const whole = masterFadeSpec(tenSeconds(3), { fromS: 0, toS: 10 })!;
    expect(whole.atS).toBeCloseTo(7, 9);
    expect(whole.durS).toBeCloseTo(3, 9);
  });

  it("resumes rather than restarts when the window starts mid-fade", () => {
    const spec = masterFadeSpec(tenSeconds(4), { fromS: 8, toS: 10 })!;
    expect(spec.atS).toBeCloseTo(0, 9); // straight away, in window time
    expect(spec.durS).toBeCloseTo(2, 9);
    expect(spec.fromT).toBeCloseTo(0.5, 9); // half way down the taper already
    expect(spec.toT).toBeCloseTo(1, 9);
  });

  it("clamps a fade longer than the project", () => {
    const spec = masterFadeSpec(tenSeconds(999), { fromS: 0, toS: 10 })!;
    expect(spec.atS).toBeCloseTo(0, 9);
    expect(spec.durS).toBeCloseTo(10, 9);
  });

  it("is cut off with the window, so a partial export fades only as far as it reaches", () => {
    const spec = masterFadeSpec(tenSeconds(4), { fromS: 0, toS: 8 })!;
    expect(spec.durS).toBeCloseTo(2, 9);
    expect(spec.toT).toBeCloseTo(0.5, 9);
  });
});

describe("masterFadeInSpec", () => {
  const tenSeconds = (fadeInS: number): Project => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 0, 10));
    return { ...p, fadeInS };
  };

  it("is null when there is no fade", () => {
    expect(masterFadeInSpec(tenSeconds(0), { fromS: 0, toS: 10 })).toBe(null);
  });

  it("starts at t = 0, an anchor that cannot move", () => {
    const spec = masterFadeInSpec(tenSeconds(2), { fromS: 0, toS: 10 })!;
    expect(spec.atS).toBeCloseTo(0, 9);
    expect(spec.durS).toBeCloseTo(2, 9);
    expect(spec.fromT).toBeCloseTo(0, 9);
  });

  // The mirror of the fade-out case: exporting the tail must not invent a fade-in at its edge.
  it("does not appear in a range export that starts after it", () => {
    expect(masterFadeInSpec(tenSeconds(2), { fromS: 5, toS: 10 })).toBe(null);
  });

  it("resumes partway when the window starts inside it", () => {
    const spec = masterFadeInSpec(tenSeconds(4), { fromS: 1, toS: 10 })!;
    expect(spec.atS).toBeCloseTo(0, 9);
    expect(spec.durS).toBeCloseTo(3, 9);
    expect(spec.fromT).toBeCloseTo(0.25, 9);
  });
});
