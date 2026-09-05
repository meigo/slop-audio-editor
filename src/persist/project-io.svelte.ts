import { decodeSource, type Source } from "../audio/pool";
import { adoptIds, referencedSourceIdsAcross, type Project } from "../doc/document";
import { pool, resetHistory, state as appState } from "../state/appState.svelte";
import { deleteSource, listSourceIds, putDocument, putSources, readAutosave } from "./autosave";
import {
  applyDocumentDefaults,
  PROJECT_FILE_EXT, ProjectFileError, packCurrentProject, unpackProject, type SourceRecord,
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
  const bytes = packCurrentProject($state.snapshot(appState.project), pool.records());
  // `packCurrentProject`'s return type is the bare `Uint8Array`, which TS widens to
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
  // Fill in fields added after this document was written. Done HERE rather than only in
  // `unpackProject`, because an autosave is handed to this function verbatim and would otherwise
  // install a document the UI dereferences fields on.
  applyDocumentDefaults(project);

  // Adopt the loaded ids BEFORE decoding, not after. Decoding is slow and yields to the event
  // loop on every chunk, so the UI is live throughout: an import started while the banner is up
  // calls `newId` with the counter still at 0 and mints an id the loading project already uses —
  // and `putSource` is a keyed put, so it overwrites that source's bytes in IndexedDB. Advancing
  // the counter early is safe even if the load then fails; it only skips some numbers.
  const ids: string[] = [];
  for (const t of project.tracks) {
    ids.push(t.id);
    for (const c of t.clips) ids.push(c.id);
  }
  for (const s of sources) ids.push(s.id);
  adoptIds(ids);

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
  // History belongs to one document. The pool has just been emptied and refilled with THIS
  // project's sources, so every entry still on the stack refers to audio that is no longer
  // loaded — undoing into one yields clips that resolve to nothing and export as silence.
  resetHistory();
}

export async function openProjectFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { project, sources } = unpackProject(bytes); // throws ProjectFileError, surfaced by caller
  await loadInto(project, sources); // may throw — must happen before anything is destroyed

  // The previous autosave is never cleared, and the order below is the whole point. Clearing
  // first emptied both stores and then wrote the sources one transaction at a time — so a quota
  // error (likely: this is the audio that was just loaded) left NOTHING restorable, and the
  // document debounce then wrote the new project 3 s later referencing sources that were never
  // stored. Next launch: a project whose clips resolve to nothing, reported as a clean restore.
  // Nothing is destroyed until the replacement is safely in place. `putSources` is atomic, so a
  // failure here leaves the previous session exactly as it was; `putDocument` bypasses the
  // debounce so the two stores never describe different projects; and only then are the sources
  // the replaced session left behind pruned — never the ones just written, which the pool holds.
  const previousIds = await listSourceIds();
  await putSources(sources);
  await putDocument(project);
  const written = new Set(sources.map((s) => s.id));
  await pruneUnreferencedSources(project, previousIds.filter((id) => !written.has(id)));
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
  projects: Project | Project[],
  candidateIds: Iterable<string>,
): Promise<void> {
  // Every document the user can still reach, not merely the open one: New project is an undoable
  // commit, so pruning against the empty document alone deletes the audio that undo would need
  // to bring back — invisibly, because the in-memory pool still has it until the next reload.
  const referenced = referencedSourceIdsAcross(Array.isArray(projects) ? projects : [projects]);
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
