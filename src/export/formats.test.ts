import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject } from "../doc/document";
import { addClip, makeClip } from "../doc/edits";
import { NO_SELECTION } from "../doc/selection";
import { exportFilename, exportWindow } from "./formats";

beforeEach(() => __resetIds());

describe("exportWindow", () => {
  it("covers the whole project when nothing is selected", () => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 2, 5));
    expect(exportWindow(p, NO_SELECTION)).toEqual({ fromS: 0, toS: 7 });
  });

  it("uses the time-range selection when there is one", () => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 0, 20));
    const selection = {
      kind: "range" as const,
      range: { fromS: 3, toS: 8, trackIds: [p.tracks[0].id] },
    };
    expect(exportWindow(p, selection)).toEqual({ fromS: 3, toS: 8 });
  });

  it("ignores a CLIP selection — that is not a time range", () => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 0, 20));
    const selection = { kind: "clips" as const, clipIds: [p.tracks[0].clips[0].id] };
    expect(exportWindow(p, selection)).toEqual({ fromS: 0, toS: 20 });
  });

  it("is an empty window for an empty project", () => {
    expect(exportWindow(createProject(), NO_SELECTION)).toEqual({ fromS: 0, toS: 0 });
  });
});

describe("exportFilename", () => {
  it("uses the project name and the format extension", () => {
    expect(exportFilename("My Mix", "wav")).toBe("My Mix.wav");
  });

  it("strips characters that are illegal in filenames", () => {
    expect(exportFilename('a/b:c*?"<>|d', "wav")).toBe("a-b-c------d.wav");
  });

  it("falls back to a default for a blank name", () => {
    expect(exportFilename("   ", "m4a")).toBe("Untitled.m4a");
  });
});
