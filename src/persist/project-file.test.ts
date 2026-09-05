import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { __resetIds, createProject } from "../doc/document";
import { addClip, makeClip } from "../doc/edits";
import {
  applyDocumentDefaults,
  PROJECT_FILE_VERSION,
  ProjectFileError,
  packCurrentProject,
  packProject,
  unpackProject,
  type SourceRecord,
} from "./project-file";

const SOURCES: SourceRecord[] = [
  { id: "src-1", name: "take1.wav", bytes: new Uint8Array([1, 2, 3, 4]) },
  { id: "src-2", name: "bed.mp3", bytes: new Uint8Array([9, 8]) },
];

function scene() {
  const base = createProject("My Mix");
  return addClip(base, base.tracks[0].id, makeClip("src-1", 5, 3, 1));
}

beforeEach(() => __resetIds());

describe("packProject", () => {
  it("writes project.json and one file per source", () => {
    const files = unzipSync(packProject(scene(), SOURCES));
    expect(Object.keys(files).sort()).toEqual([
      "project.json",
      "sources/src-1.wav",
      "sources/src-2.mp3",
    ]);
  });

  it("stores source bytes verbatim", () => {
    const files = unzipSync(packProject(scene(), SOURCES));
    expect([...files["sources/src-1.wav"]]).toEqual([1, 2, 3, 4]);
  });

  it("stamps the file version", () => {
    const files = unzipSync(packProject(scene(), SOURCES));
    expect(JSON.parse(new TextDecoder().decode(files["project.json"])).version).toBe(
      PROJECT_FILE_VERSION,
    );
  });
});

describe("round trip", () => {
  it("restores the project exactly", () => {
    const p = scene();
    expect(unpackProject(packProject(p, SOURCES)).project).toEqual(p);
  });

  it("restores source bytes and names", () => {
    const out = unpackProject(packProject(scene(), SOURCES)).sources;
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "src-1", name: "take1.wav" });
    expect([...out[0].bytes]).toEqual([1, 2, 3, 4]);
  });

  it("handles a project with no sources", () => {
    const out = unpackProject(packProject(createProject(), []));
    expect(out.sources).toEqual([]);
    expect(out.project.tracks).toHaveLength(1);
  });

  it("handles a source name with no extension", () => {
    const src: SourceRecord = { id: "src-9", name: "recording", bytes: new Uint8Array([7]) };
    expect(unpackProject(packProject(createProject(), [src])).sources[0].name).toBe("recording");
  });

  it("defaults glue to false for a file saved before glue existed", () => {
    const { glue: _glue, ...oldProject } = createProject();
    const bad = zipSync({
      "project.json": strToU8(
        JSON.stringify({
          version: PROJECT_FILE_VERSION,
          project: oldProject,
          sources: [],
        }),
      ),
    });
    expect(unpackProject(bad).project.glue).toBe(false);
  });
});

describe("errors", () => {
  it("rejects a future file version rather than half-loading", () => {
    const bad = zipSync({
      "project.json": strToU8(
        JSON.stringify({
          version: PROJECT_FILE_VERSION + 1,
          project: createProject(),
          sources: [],
        }),
      ),
    });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
    expect(() => unpackProject(bad)).toThrow(/newer version/i);
  });

  it("rejects a zip with no project.json", () => {
    const bad = zipSync({ "nope.txt": strToU8("hi") });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
  });

  it("rejects malformed JSON", () => {
    const bad = zipSync({ "project.json": strToU8("{not json") });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
  });

  it("rejects a manifest whose source file is missing from the zip", () => {
    const bad = zipSync({
      "project.json": strToU8(
        JSON.stringify({
          version: PROJECT_FILE_VERSION,
          project: createProject(),
          sources: [{ id: "src-1", name: "a.wav", file: "sources/src-1.wav" }],
        }),
      ),
    });
    expect(() => unpackProject(bad)).toThrow(/missing/i);
  });

  it("rejects a manifest whose project has no tracks array", () => {
    const bad = zipSync({
      "project.json": strToU8(
        JSON.stringify({
          version: PROJECT_FILE_VERSION,
          project: { name: "x", masterGain: 1 }, // tracks missing entirely
          sources: [],
        }),
      ),
    });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
    expect(() => unpackProject(bad)).toThrow(/shape/i);
  });

  it("rejects a manifest whose project's masterGain is not a number", () => {
    const bad = zipSync({
      "project.json": strToU8(
        JSON.stringify({
          version: PROJECT_FILE_VERSION,
          project: { name: "x", tracks: [], masterGain: "loud" },
          sources: [],
        }),
      ),
    });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
  });

  it("rejects a manifest with no project field at all", () => {
    const bad = zipSync({
      "project.json": strToU8(JSON.stringify({ version: PROJECT_FILE_VERSION, sources: [] })),
    });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
  });
});

it("defaults `ducked` to false on a project saved before background ducking existed", () => {
  // A v1 file written before the field existed: tracks carry no `ducked` at all.
  const legacy = createProject("old");
  const stripped = {
    ...legacy,
    tracks: legacy.tracks.map(({ ducked: _ducked, ...rest }) => rest),
  };
  const bytes = packProject(stripped as typeof legacy, []);
  const { project } = unpackProject(bytes);
  expect(project.tracks.every((t) => t.ducked === false)).toBe(true);
});

describe("packCurrentProject", () => {
  it("leaves out audio no clip references, so a deleted source cannot travel in a shared file", () => {
    __resetIds();
    let p = createProject();
    p = addClip(p, p.tracks[0].id, makeClip("src-1", 0, 1));
    const records: SourceRecord[] = [
      { id: "src-1", name: "used.wav", bytes: new Uint8Array([1, 2, 3]) },
      { id: "src-deleted", name: "secret.wav", bytes: new Uint8Array([9, 9, 9]) },
    ];

    const { sources } = unpackProject(packCurrentProject(p, records));

    expect(sources.map((s) => s.id)).toEqual(["src-1"]);
  });

  it("keeps a source referenced by any track, not just the first", () => {
    __resetIds();
    let p = createProject();
    p = { ...p, tracks: [...p.tracks, { ...p.tracks[0], id: "track-9", clips: [] }] };
    p = addClip(p, "track-9", makeClip("src-2", 0, 1));
    const records: SourceRecord[] = [{ id: "src-2", name: "b.wav", bytes: new Uint8Array([4]) }];

    const { sources } = unpackProject(packCurrentProject(p, records));

    expect(sources.map((s) => s.id)).toEqual(["src-2"]);
  });
});

describe("applyDocumentDefaults", () => {
  // Gotcha: an autosave written before a field existed is handed to loadInto verbatim, so a
  // missing masterEq would install undefined where the master panel dereferences bands.
  it("fills in a master EQ missing from an older document", () => {
    const p = { ...createProject(), masterEq: undefined } as unknown as Parameters<
      typeof applyDocumentDefaults
    >[0];

    applyDocumentDefaults(p);

    expect(p.masterEq).toEqual({ lowDb: 0, midDb: 0, highDb: 0 });
  });

  it("keeps a master EQ that is already there", () => {
    const p = { ...createProject(), masterEq: { lowDb: 3, midDb: -3, highDb: 1 } };
    applyDocumentDefaults(p);
    expect(p.masterEq).toEqual({ lowDb: 3, midDb: -3, highDb: 1 });
  });

  it("survives a round trip through the file format", () => {
    const p = { ...createProject(), masterEq: { lowDb: -2, midDb: 5, highDb: 0 } };
    expect(unpackProject(packProject(p, [])).project.masterEq).toEqual({
      lowDb: -2,
      midDb: 5,
      highDb: 0,
    });
  });
});
