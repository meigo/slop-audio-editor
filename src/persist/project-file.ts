import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DEFAULT_DUCK_DEPTH_DB, type Project } from "../doc/document";

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
    typeof project !== "object" || project === null ||
    !Array.isArray(project.tracks) || typeof project.masterGain !== "number"
  ) {
    throw new ProjectFileError("Project file is corrupt — the project data has an unexpected shape.");
  }

  const sources = (manifest.sources ?? []).map((s) => {
    const bytes = files[s.file];
    if (!bytes) throw new ProjectFileError(`Project file is missing audio for "${s.name}".`);
    return { id: s.id, name: s.name, bytes };
  });

  // `glue` was added after the initial file format; a file saved before that has no such field.
  // No version bump — it's an optional field with a well-defined default, not a shape change.
  if (typeof project.glue !== "boolean") project.glue = false;
  // Likewise `ducked`, added with background ducking. Same reasoning: optional field, well-defined
  // default, no version bump — and defaulting it here means `planDucking` never sees `undefined`.
  for (const t of project.tracks) {
    if (typeof t.ducked !== "boolean") t.ducked = false;
  }
  if (typeof project.duckDepthDb !== "number") project.duckDepthDb = DEFAULT_DUCK_DEPTH_DB;

  return { project, sources };
}
