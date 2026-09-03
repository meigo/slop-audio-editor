import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, makeClip, splitAt, trimClipEnd, trimClipStart } from "./edits";

/** One track holding one clip: 4s of a 20s source, starting 2s in, placed at t=5. */
function oneClip(): { p: Project; clipId: string; trackId: string } {
  const base = createProject();
  const trackId = base.tracks[0].id;
  const p = addClip(base, trackId, makeClip("s", 5, 4, 2));
  return { p, clipId: p.tracks[0].clips[0].id, trackId };
}

beforeEach(() => __resetIds());

describe("trimClipStart", () => {
  it("moves startS and inS by the SAME delta, so kept audio stays put", () => {
    const { p, clipId } = oneClip();
    const c = trimClipStart(p, clipId, 1).tracks[0].clips[0];
    expect(c.startS).toBe(6);
    expect(c.inS).toBe(3); // both +1 — the audio under t=6 is unchanged
    expect(c.durS).toBe(3);
  });

  it("extends the head back out, un-trimming", () => {
    const { p, clipId } = oneClip();
    const c = trimClipStart(p, clipId, -1).tracks[0].clips[0];
    expect(c).toMatchObject({ startS: 4, inS: 1, durS: 5 });
  });

  it("cannot pull inS below 0", () => {
    const { p, clipId } = oneClip();
    const c = trimClipStart(p, clipId, -10).tracks[0].clips[0];
    expect(c.inS).toBe(0);
    expect(c.startS).toBe(3); // clamped by the same amount, so the invariant holds
  });

  it("cannot eat the clip below MIN_CLIP_S", () => {
    const { p, clipId } = oneClip();
    const c = trimClipStart(p, clipId, 99).tracks[0].clips[0];
    expect(c.durS).toBeCloseTo(0.01);
  });

  it("cannot extend back into the previous clip", () => {
    let { p, trackId } = oneClip();
    p = addClip(p, trackId, makeClip("s", 0, 4, 0)); // occupies 0..4
    const clipId = p.tracks[0].clips[1].id;
    const c = trimClipStart(p, clipId, -10).tracks[0].clips[1];
    expect(c.startS).toBe(4);
  });

  it("clamps fades that no longer fit", () => {
    const { p, clipId } = oneClip();
    const withFade = { ...p };
    withFade.tracks[0].clips[0].fadeInS = 3;
    const c = trimClipStart(withFade, clipId, 2).tracks[0].clips[0];
    expect(c.fadeInS).toBeLessThanOrEqual(c.durS);
  });
});

describe("trimClipEnd", () => {
  it("lengthens the clip without touching startS or inS", () => {
    const { p, clipId } = oneClip();
    const c = trimClipEnd(p, clipId, 2, 20).tracks[0].clips[0];
    expect(c).toMatchObject({ startS: 5, inS: 2, durS: 6 });
  });

  it("shortens the clip", () => {
    const { p, clipId } = oneClip();
    expect(trimClipEnd(p, clipId, -1, 20).tracks[0].clips[0].durS).toBe(3);
  });

  it("cannot run past the end of the source", () => {
    const { p, clipId } = oneClip();
    // inS=2 of a 6s source leaves 4s available, which is exactly the current length.
    expect(trimClipEnd(p, clipId, 5, 6).tracks[0].clips[0].durS).toBe(4);
  });

  it("cannot eat the clip below MIN_CLIP_S", () => {
    const { p, clipId } = oneClip();
    expect(trimClipEnd(p, clipId, -99, 20).tracks[0].clips[0].durS).toBeCloseTo(0.01);
  });

  it("cannot extend into the next clip", () => {
    let { p, trackId } = oneClip();
    p = addClip(p, trackId, makeClip("s", 11, 2, 0)); // occupies 11..13
    const clipId = p.tracks[0].clips[0].id;
    expect(trimClipEnd(p, clipId, 99, 20).tracks[0].clips[0].durS).toBe(6); // 5..11
  });
});

describe("splitAt", () => {
  it("splits a clip crossing the point into two, the tail getting a new id", () => {
    const { p, clipId, trackId } = oneClip();
    const clips = splitAt(p, [trackId], 7).tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ id: clipId, startS: 5, inS: 2, durS: 2 });
    expect(clips[1]).toMatchObject({ startS: 7, inS: 4, durS: 2 });
    expect(clips[1].id).not.toBe(clipId);
  });

  it("leaves clips that do not cross the point alone", () => {
    const { p, trackId } = oneClip();
    expect(splitAt(p, [trackId], 20)).toBe(p);
  });

  it("does not split exactly on a clip boundary", () => {
    const { p, trackId } = oneClip();
    expect(splitAt(p, [trackId], 5)).toBe(p);
    expect(splitAt(p, [trackId], 9)).toBe(p);
  });

  it("refuses a split that would produce a sliver shorter than MIN_CLIP_S", () => {
    const { p, trackId } = oneClip();
    expect(splitAt(p, [trackId], 5.001)).toBe(p);
  });

  it("only touches the tracks it is given", () => {
    const { p, trackId } = oneClip();
    expect(splitAt(p, ["other"], 7)).toBe(p);
    expect(splitAt(p, [trackId], 7).tracks[0].clips).toHaveLength(2);
  });
});
