import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { copyClips, cutClips, pasteClips } from "./clipboard";
import { addClip, addTrack, makeClip } from "./edits";

/** Track A: clips at t=10 (2s) and t=14 (2s). Track B: clip at t=10 (2s). */
function scene(): Project {
  let p = addTrack(createProject(), "B");
  p = addClip(p, p.tracks[0].id, makeClip("s", 10, 2));
  p = addClip(p, p.tracks[0].id, makeClip("s", 14, 2));
  p = addClip(p, p.tracks[1].id, makeClip("s", 10, 2));
  return p;
}

beforeEach(() => __resetIds());

describe("copyClips", () => {
  it("normalises startS so the earliest copied clip sits at 0", () => {
    const p = scene();
    const ids = p.tracks[0].clips.map((c) => c.id);
    const data = copyClips(p, ids);
    expect(data.entries.map((e) => e.clip.startS)).toEqual([0, 4]);
  });

  it("records each clip's track offset relative to the topmost copied track", () => {
    const p = scene();
    const ids = [p.tracks[1].clips[0].id, p.tracks[0].clips[0].id];
    expect(copyClips(p, ids).entries.map((e) => e.trackOffset).sort()).toEqual([0, 1]);
  });

  it("does not mutate or remove anything", () => {
    const p = scene();
    copyClips(p, [p.tracks[0].clips[0].id]);
    expect(p.tracks[0].clips).toHaveLength(2);
  });

  it("returns an empty clipboard for no ids", () => {
    const data = copyClips(scene(), []);
    expect(data.entries).toEqual([]);
    expect(data.sourceTrackId).toBeNull();
  });

  it("records the topmost copied clip's track as sourceTrackId", () => {
    const p = scene();
    expect(copyClips(p, [p.tracks[0].clips[0].id]).sourceTrackId).toBe(p.tracks[0].id);
    // Order of the passed-in ids does not matter — it's the topmost TRACK that wins.
    const ids = [p.tracks[1].clips[0].id, p.tracks[0].clips[0].id];
    expect(copyClips(p, ids).sourceTrackId).toBe(p.tracks[0].id);
  });
});

describe("cutClips", () => {
  it("returns the clipboard AND a project with those clips gone", () => {
    const p = scene();
    const id = p.tracks[0].clips[0].id;
    const { project, clipboard } = cutClips(p, [id]);
    expect(clipboard.entries).toHaveLength(1);
    expect(project.tracks[0].clips.map((c) => c.startS)).toEqual([14]);
  });
});

describe("pasteClips", () => {
  it("places clips at atS, preserving their relative spacing", () => {
    const p = scene();
    const data = copyClips(p, p.tracks[0].clips.map((c) => c.id));
    const next = pasteClips(p, data, p.tracks[1].id, 30);
    expect(next.tracks[1].clips.map((c) => c.startS)).toEqual([10, 30, 34]);
  });

  it("gives pasted clips fresh ids so a paste-onto-self does not collide", () => {
    const p = scene();
    const original = p.tracks[0].clips[0];
    const data = copyClips(p, [original.id]);
    const next = pasteClips(p, data, p.tracks[0].id, 30);

    const pasted = next.tracks[0].clips.find((c) => c.startS === 30);
    expect(pasted).toBeDefined();
    expect(pasted!.id).not.toBe(original.id);

    // The real invariant: no track ever holds two clips with the same id.
    const ids = next.tracks[0].clips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    // ...and the original survives the copy exactly once.
    expect(next.tracks[0].clips.filter((c) => c.id === original.id)).toHaveLength(1);
  });

  it("preserves gain and fades", () => {
    let p = scene();
    p.tracks[0].clips[0].gain = 0.5;
    p.tracks[0].clips[0].fadeInS = 0.25;
    const data = copyClips(p, [p.tracks[0].clips[0].id]);
    const c = pasteClips(p, data, p.tracks[1].id, 30).tracks[1].clips[1];
    expect(c).toMatchObject({ gain: 0.5, fadeInS: 0.25 });
  });

  it("spills onto lower tracks by trackOffset, clamped at the last track", () => {
    const p = scene();
    const data = copyClips(p, [p.tracks[0].clips[0].id, p.tracks[1].clips[0].id]);
    const next = pasteClips(p, data, p.tracks[1].id, 30);
    // Both land on the last track because there is no track below it.
    expect(next.tracks[1].clips).toHaveLength(2);
  });

  it("overwrites whatever it lands on", () => {
    const p = scene();
    const data = copyClips(p, [p.tracks[0].clips[0].id]);
    const next = pasteClips(p, data, p.tracks[1].id, 11);
    expect(next.tracks[1].clips.map((c) => [c.startS, c.durS])).toEqual([[10, 1], [11, 2]]);
  });

  it("is a no-op for an empty clipboard or unknown track", () => {
    const p = scene();
    expect(pasteClips(p, { entries: [], sourceTrackId: null }, p.tracks[0].id, 5)).toBe(p);
    expect(pasteClips(p, copyClips(p, [p.tracks[0].clips[0].id]), "nope", 5)).toBe(p);
  });
});
