import { describe, expect, it } from "vitest";
import { createProject } from "../doc/document";
import { addClip, addTrack, makeClip } from "../doc/edits";
import { NO_SELECTION } from "../doc/selection";
import { statusSummary } from "./status";

const empty = createProject("p");
const twoTracks = addTrack(empty, "B");

describe("statusSummary", () => {
  it("counts tracks and reports the project length when nothing is selected", () => {
    expect(statusSummary(empty, NO_SELECTION, null)).toBe("1 track · 00:00.000");
  });

  it("pluralises the track count", () => {
    expect(statusSummary(twoTracks, NO_SELECTION, null)).toContain("2 tracks");
  });

  it("reports the project length", () => {
    const p = addClip(twoTracks, twoTracks.tracks[0].id, makeClip("s", 1, 2));
    expect(statusSummary(p, NO_SELECTION, null)).toContain("00:03.000");
  });

  it("reports how many clips are selected", () => {
    const sel = { kind: "clips" as const, clipIds: ["a", "b"] };
    expect(statusSummary(twoTracks, sel, null)).toContain("2 clips selected");
  });

  it("says '1 clip selected', not '1 clips selected'", () => {
    const sel = { kind: "clips" as const, clipIds: ["a"] };
    expect(statusSummary(twoTracks, sel, null)).toContain("1 clip selected");
  });

  it("reports a time range with its duration", () => {
    const sel = {
      kind: "range" as const,
      range: { fromS: 1, toS: 3.5, trackIds: [twoTracks.tracks[0].id] },
    };
    expect(statusSummary(twoTracks, sel, null)).toContain("00:01.000–00:03.500 (2.500 s)");
  });

  // A range selection is the one piece of state that silently changes what an export CONTAINS,
  // and it is easy to paint by accident with a stray drag on a lane. The status line names it,
  // mirroring the "in/out" label on the markers that look similar but never reach a file.
  it("labels a range selection as the export window", () => {
    const sel = {
      kind: "range" as const,
      range: { fromS: 1, toS: 3.5, trackIds: [twoTracks.tracks[0].id] },
    };
    expect(statusSummary(twoTracks, sel, null)).toContain("export 00:01.000–00:03.500");
  });

  it("does not call a range the export window when none of its tracks exist", () => {
    // `exportWindow` ignores such a range; saying "export 1–3.5" here would describe a window the
    // export does not use.
    const sel = { kind: "range" as const, range: { fromS: 1, toS: 3.5, trackIds: ["gone"] } };
    expect(statusSummary(twoTracks, sel, null)).not.toContain("export");
  });

  it("does not call a clip selection an export window — it does not bound the export", () => {
    const sel = { kind: "clips" as const, clipIds: ["a"] };
    expect(statusSummary(twoTracks, sel, null)).not.toContain("export");
  });

  // The in/out markers are session state that bounds playback but never the export (Gotcha 13),
  // so the status line must not describe them as if they were a selection.
  it("reports the in/out play range separately from the selection", () => {
    const s = statusSummary(twoTracks, NO_SELECTION, { fromS: 2, toS: 4 });
    expect(s).toContain("in/out 00:02.000–00:04.000");
  });

  it("can report both a selection and a play range at once", () => {
    const sel = { kind: "clips" as const, clipIds: ["a"] };
    const s = statusSummary(twoTracks, sel, { fromS: 2, toS: 4 });
    expect(s).toContain("1 clip selected");
    expect(s).toContain("in/out");
  });
});
