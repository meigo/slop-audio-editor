import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  DEFAULT_DUCK_DEPTH_DB,
  referencedSourceIdsAcross,
  type Project,
  type TrackFilter,
  type EqBands,
} from "../doc/document";

export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXT = ".slopaudio";

export interface SourceRecord {
  id: string;
  name: string;
  /** The ORIGINAL encoded file bytes — a 30 MB mp3 stays 30 MB rather than becoming PCM. */
  bytes: Uint8Array;
}

export class ProjectFileError extends Error {}

interface Manifest {
  version: number;
  project: Project;
  sources: { id: string; name: string; file: string }[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** A self-contained `.slopaudio` zip: project.json plus each source's original bytes. A browser
 *  has no stable file paths to relink to, so the audio travels with the edit. */
export function packProject(project: Project, sources: readonly SourceRecord[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const manifestSources = sources.map((s) => {
    const file = `sources/${s.id}${extensionOf(s.name)}`;
    files[file] = s.bytes;
    return { id: s.id, name: s.name, file };
  });
  const manifest: Manifest = { version: PROJECT_FILE_VERSION, project, sources: manifestSources };
  files["project.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

/** Fill in fields added after a document was written.
 *
 *  Every one of these is an optional field with a well-defined default rather than a shape change,
 *  which is why the file format has no version bump for them. It is exported because BOTH load
 *  paths need it: a `.slopaudio` file goes through `unpackProject`, but an IndexedDB autosave does
 *  not — it is handed to `loadInto` verbatim. Defaulting in only one of them left the autosave path
 *  installing a document with no `eq`, which the inspector dereferences on render. */
/** Coerces a possibly-absent, possibly-malformed EQ into three real numbers. Shared by tracks and
 *  the master bus, so a document saved before either existed cannot install `undefined` where the
 *  UI dereferences bands on render. */
function eqOrFlat(eq: unknown): EqBands {
  const e = eq as Partial<EqBands> | undefined;
  return {
    lowDb: typeof e?.lowDb === "number" ? e.lowDb : 0,
    midDb: typeof e?.midDb === "number" ? e.midDb : 0,
    highDb: typeof e?.highDb === "number" ? e.highDb : 0,
  };
}

/** Coerces a possibly-absent filter into a real one. Shared by tracks and the master bus so a
 *  document saved before either existed cannot install `undefined` where the UI reads `kind`. */
function filterOrOff(filter: unknown): TrackFilter {
  const f = filter as Partial<TrackFilter> | undefined;
  return (f?.kind === "highpass" || f?.kind === "lowpass") && typeof f.hz === "number" && f.hz > 0
    ? { kind: f.kind, hz: f.hz }
    : { kind: "off", hz: 0 };
}

export function applyDocumentDefaults(project: Project): void {
  if (typeof project.glue !== "boolean") project.glue = false;
  if (typeof project.duckDepthDb !== "number") project.duckDepthDb = DEFAULT_DUCK_DEPTH_DB;
  project.masterEq = eqOrFlat(project.masterEq);
  project.masterFilter = filterOrOff(project.masterFilter);
  project.fadeOutS =
    typeof project.fadeOutS === "number" && project.fadeOutS > 0 ? project.fadeOutS : 0;
  project.saturation =
    typeof project.saturation === "number" && project.saturation > 0
      ? Math.min(1, project.saturation)
      : 0;
  for (const t of project.tracks) {
    if (typeof t.ducked !== "boolean") t.ducked = false;
    t.eq = eqOrFlat(t.eq);
    if (typeof t.pan !== "number" || !Number.isFinite(t.pan)) t.pan = 0;
    t.filter = filterOrOff(t.filter);
    for (const c of t.clips) {
      if (typeof c.speed !== "number" || !(c.speed > 0)) c.speed = 1;
    }
  }
}

export function unpackProject(zip: Uint8Array): { project: Project; sources: SourceRecord[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new ProjectFileError("Not a valid project file.");
  }

  const raw = files["project.json"];
  if (!raw) throw new ProjectFileError("Not a project file — project.json is missing.");

  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(raw)) as Manifest;
  } catch {
    throw new ProjectFileError("Project file is corrupt — project.json could not be read.");
  }

  // Refuse outright rather than half-loading something written by a newer app.
  if (manifest.version > PROJECT_FILE_VERSION) {
    throw new ProjectFileError(
      `This project was saved by a newer version of slop-audio-editor (file version ${manifest.version}).`,
    );
  }

  // A version check alone lets a malformed-but-parseable file (e.g. hand-edited, or truncated by
  // a bad transfer) through as a valid manifest, which surfaces as a white screen far from this
  // function rather than the file-load banner. Check the shape the rest of this function and
  // `loadInto` assume.
  const project = manifest.project;
  if (
    typeof project !== "object" ||
    project === null ||
    !Array.isArray(project.tracks) ||
    typeof project.masterGain !== "number"
  ) {
    throw new ProjectFileError(
      "Project file is corrupt — the project data has an unexpected shape.",
    );
  }

  const sources = (manifest.sources ?? []).map((s) => {
    const bytes = files[s.file];
    if (!bytes) throw new ProjectFileError(`Project file is missing audio for "${s.name}".`);
    return { id: s.id, name: s.name, bytes };
  });

  applyDocumentDefaults(project);

  return { project, sources };
}

/** Packs only the audio the document actually references.
 *
 *  The pool holds everything imported this session, including sources whose every clip was since
 *  deleted — `packProject` faithfully writes whatever it is handed, so passing `pool.records()`
 *  put audio the user had removed inside a file they might share, and inflated it for no benefit.
 *  Nothing in the file can ever need those bytes: undo history is not saved (`loadInto` resets
 *  it), so no reachable document references them. */
export function packCurrentProject(project: Project, records: readonly SourceRecord[]): Uint8Array {
  const referenced = referencedSourceIdsAcross([project]);
  return packProject(
    project,
    records.filter((r) => referenced.has(r.id)),
  );
}
