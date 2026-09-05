import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, makeClip, setClipFade, setClipGain } from "./edits";

function oneClip(durS = 10): { p: Project; clipId: string } {
  const base = createProject();
  const p = addClip(base, base.tracks[0].id, makeClip("s", 0, durS));
  return { p, clipId: p.tracks[0].clips[0].id };
}

beforeEach(() => __resetIds());

describe("setClipGain", () => {
  it("sets gain", () => {
    const { p, clipId } = oneClip();
    expect(setClipGain(p, clipId, 0.25).tracks[0].clips[0].gain).toBe(0.25);
  });

  it("clamps to >= 0", () => {
    const { p, clipId } = oneClip();
    expect(setClipGain(p, clipId, -2).tracks[0].clips[0].gain).toBe(0);
  });

  it("is a no-op for an unknown clip", () => {
    const { p } = oneClip();
    expect(setClipGain(p, "nope", 0.5)).toBe(p);
  });
});

describe("setClipFade", () => {
  it("sets fade in and fade out independently", () => {
    const { p, clipId } = oneClip();
    const c = setClipFade(p, clipId, { fadeInS: 1, fadeOutS: 2 }).tracks[0].clips[0];
    expect(c).toMatchObject({ fadeInS: 1, fadeOutS: 2 });
  });

  it("leaves unspecified fields alone", () => {
    const { p, clipId } = oneClip();
    let next = setClipFade(p, clipId, { fadeInS: 1 });
    next = setClipFade(next, clipId, { fadeOutS: 2 });
    expect(next.tracks[0].clips[0].fadeInS).toBe(1);
  });

  it("sets the curve shape", () => {
    const { p, clipId } = oneClip();
    expect(setClipFade(p, clipId, { fadeShape: "equalPower" }).tracks[0].clips[0].fadeShape).toBe(
      "equalPower",
    );
  });

  it("pushes the other fade back rather than rejecting an overlong drag", () => {
    const { p, clipId } = oneClip(4);
    let next = setClipFade(p, clipId, { fadeInS: 1, fadeOutS: 3 });
    next = setClipFade(next, clipId, { fadeInS: 3 });
    const c = next.tracks[0].clips[0];
    expect(c.fadeInS + c.fadeOutS).toBeCloseTo(4);
    expect(c.fadeInS).toBeGreaterThan(1);
  });

  it("clamps a fade longer than the clip", () => {
    const { p, clipId } = oneClip(2);
    expect(setClipFade(p, clipId, { fadeInS: 99 }).tracks[0].clips[0].fadeInS).toBe(2);
  });

  it("rejects negative fades", () => {
    const { p, clipId } = oneClip();
    expect(setClipFade(p, clipId, { fadeInS: -1 }).tracks[0].clips[0].fadeInS).toBe(0);
  });
});
