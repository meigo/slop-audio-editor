import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "../doc/document";
import { addClip, addTrack, makeClip, setClipFade, setClipGain, setTrackMuted } from "../doc/edits";
import { DECLICK_S, planSchedule } from "./schedule";

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
    expect(plan[0].fadeOut).toMatchObject({ atS: 15 - DECLICK_S, durS: DECLICK_S, shape: "linear" });
  });

  it("declicks the point where a window opens mid-clip, not the clip's own start", () => {
    // Seeking into the middle of a clip is just as much a discontinuity as an edit is.
    expect(planSchedule(oneClip(), 8, 100, NO_SOLO)[0].fadeIn).toMatchObject({
      atS: 0, durS: DECLICK_S,
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
      atS: 5, durS: 2, shape: "equalPower", fromT: 0, toT: 1,
    });
  });

  it("emits a whole fade out ending at the clip's end", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeOutS: 3 });
    expect(planSchedule(p, 0, 100, NO_SOLO)[0].fadeOut).toMatchObject({
      atS: 12, durS: 3, fromT: 0, toT: 1,
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
    expect(plan.map((s) => [s.trackId === p.tracks[0].id ? "A" : "B", s.when]))
      .toEqual([["A", 0], ["A", 4], ["B", 2]]);
  });
});
