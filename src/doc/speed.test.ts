import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, MAX_SPEED, MIN_SPEED } from "./document";
import { addClip, makeClip, setClipSpeed, splitAt, trimClipEnd, trimClipStart } from "./edits";

beforeEach(() => __resetIds());

/** One clip: 10 s of timeline from t=0, reading the source from 0. */
function oneClip(speed = 1) {
  let p = createProject();
  const trackId = p.tracks[0].id;
  p = addClip(p, trackId, makeClip("s", 0, 10));
  if (speed !== 1) p = setClipSpeed(p, p.tracks[0].clips[0].id, speed);
  return { p, trackId, clipId: p.tracks[0].clips[0].id };
}
const only = (p: ReturnType<typeof createProject>) => p.tracks[0].clips[0];

describe("setClipSpeed", () => {
  it("defaults to 1 and rescales the TIMELINE length, keeping the source region", () => {
    const { p, clipId } = oneClip();
    expect(only(p).speed).toBe(1);

    const fast = setClipSpeed(p, clipId, 2);

    // Same 10 s of source, played twice as fast, so it occupies half the timeline.
    expect(only(fast).speed).toBe(2);
    expect(only(fast).durS).toBeCloseTo(5, 9);
    expect(only(fast).inS).toBe(0);
    expect(only(fast).durS * only(fast).speed).toBeCloseTo(10, 9); // source consumed is unchanged
  });

  it("makes a clip longer when slowed down", () => {
    const { p, clipId } = oneClip();
    expect(only(setClipSpeed(p, clipId, 0.5)).durS).toBeCloseTo(20, 9);
  });

  it("clamps to the supported range", () => {
    const { p, clipId } = oneClip();
    expect(only(setClipSpeed(p, clipId, 99)).speed).toBe(MAX_SPEED);
    expect(only(setClipSpeed(p, clipId, 0.001)).speed).toBe(MIN_SPEED);
  });

  it("cannot grow over the next clip when slowing down", () => {
    let { p, trackId, clipId } = oneClip();
    p = addClip(p, trackId, makeClip("s", 12, 5)); // occupies 12..17

    const slow = setClipSpeed(p, clipId, 0.5); // would want 20 s, only 12 available

    expect(only(slow).durS).toBeCloseTo(12, 9);
    expect(slow.tracks[0].clips[1].startS).toBe(12); // neighbour untouched
  });

  it("is a no-op at the same speed, so it cannot push a junk undo entry", () => {
    const { p, clipId } = oneClip();
    expect(setClipSpeed(p, clipId, 1)).toBe(p);
  });
});

describe("editing a clip that is not at speed 1", () => {
  // One timeline second consumes `speed` source seconds — every edit that touches inS has to know.
  it("trimming the head moves the in-point by delta x speed", () => {
    const { p, clipId } = oneClip(2); // 5 s of timeline, 10 s of source
    const t = trimClipStart(p, clipId, 1); // one timeline second off the front

    expect(only(t).startS).toBeCloseTo(1, 9);
    expect(only(t).inS).toBeCloseTo(2, 9); // ...is two source seconds
    expect(only(t).durS).toBeCloseTo(4, 9);
  });

  it("trimming the tail is limited by the source that remains, in TIMELINE seconds", () => {
    const { p, clipId } = oneClip(2); // 5 s timeline from 10 s of source, all of it used
    // A 20 s source has 10 s left, which at 2x is only 5 s of timeline.
    const t = trimClipEnd(p, clipId, 99, 20);
    expect(only(t).durS).toBeCloseTo(10, 9);
    expect(only(t).durS * only(t).speed).toBeCloseTo(20, 9); // exactly the whole source
  });

  it("splitting gives the tail a speed-scaled in-point", () => {
    const { p, trackId } = oneClip(2); // 5 s of timeline
    const s = splitAt(p, [trackId], 2); // split 2 timeline seconds in

    const [head, tail] = s.tracks[0].clips;
    expect(head.durS).toBeCloseTo(2, 9);
    expect(tail.startS).toBeCloseTo(2, 9);
    expect(tail.inS).toBeCloseTo(4, 9); // 2 timeline seconds at 2x = 4 source seconds
    expect(tail.speed).toBe(2); // and the halves keep the speed
  });
});
