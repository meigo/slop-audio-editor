import { decodeSource, type Source } from "../audio/pool";
import type { Project } from "../doc/document";
import { pool, state as appState } from "../state/appState.svelte";
import { clearAutosave, deleteSource, putSource, readAutosave } from "./autosave";
import {
  PROJECT_FILE_EXT, ProjectFileError, packProject, unpackProject, type SourceRecord,
} from "./project-file";
import { exportFilename } from "../export/formats";

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function saveProjectFile(): void {
  const bytes = packProject($state.snapshot(appState.project), pool.records());
  // `packProject`'s return type is the bare `Uint8Array`, which TS widens to
  // `Uint8Array<ArrayBufferLike>` — Blob wants the concrete `ArrayBuffer` form. `zipSync` (its
  // implementation) always backs the array with a real ArrayBuffer, so this narrows a type, not a fact.
  download(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
    exportFilename(appState.project.name, PROJECT_FILE_EXT.slice(1)),
  );
  appState.dirty = false;
}

/** Replace everything: decode every source, and only then install the new pool and document.
 *
 *  The decode loop runs BEFORE any state is touched, on purpose. A corrupt source inside an
 *  otherwise-valid file must leave the current project exactly as it was — clearing the pool
 *  first would strand the still-installed project on sources that no longer exist, turning one
 *  bad import into a lost session. This also strengthens the pool-before-project ordering rule:
 *  every source is now decoded before ANY state is touched, not merely before `appState.project`
 *  is assigned. */
async function loadInto(project: typeof appState.project, sources: SourceRecord[]): Promise<void> {
  const decoded: Source[] = [];
  for (const s of sources) {
    appState.importing = { name: s.name, fraction: 0 };
    try {
      decoded.push(
        await decodeSource(s.id, s.name, s.bytes, (f) => {
          appState.importing = { name: s.name, fraction: f };
        }),
      );
    } finally {
      appState.importing = null;
    }
  }
  // Past this line nothing can fail, so the swap is effectively atomic.
  pool.clear();
  for (const d of decoded) pool.add(d);
  appState.project = project;
  appState.dirty = false;
}

export async function openProjectFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { project, sources } = unpackProject(bytes); // throws ProjectFileError, surfaced by caller
  await loadInto(project, sources); // may throw — must happen before anything is destroyed
  await clearAutosave();
  for (const s of sources) await putSource(s);
}

export function referencedSourceIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const t of project.tracks) for (const c of t.clips) ids.add(c.sourceId);
  return ids;
}

/** Deletes any of `candidateIds` the given project's clips do not reference. `putSource` is
 *  append-only, so this is the only pruning path — called after restoring an autosave (against the
 *  ids it just read) and after starting a new project (against the ids already in the pool) — that
 *  keeps orphaned sources from accumulating in IndexedDB forever. Best-effort: a failed delete is
 *  logged and skipped rather than surfaced, since the orphan it leaves behind is exactly the
 *  pre-existing (non-broken) state. */
export async function pruneUnreferencedSources(
  project: Project,
  candidateIds: Iterable<string>,
): Promise<void> {
  const referenced = referencedSourceIds(project);
  for (const id of candidateIds) {
    if (referenced.has(id)) continue;
    try {
      await deleteSource(id);
    } catch (err) {
      console.warn("Autosave: failed to prune orphaned source", id, err);
    }
  }
}

export async function restoreAutosave(): Promise<boolean> {
  const saved = await readAutosave();
  if (!saved) return false;
  const referenced = referencedSourceIds(saved.project);
  const sources = saved.sources.filter((s) => referenced.has(s.id));
  await loadInto(saved.project, sources);
  await pruneUnreferencedSources(
    saved.project,
    saved.sources.map((s) => s.id),
  );
  return true;
}

export { ProjectFileError };
