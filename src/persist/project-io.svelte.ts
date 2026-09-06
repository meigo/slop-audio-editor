import { decodeSource, type Source } from "../audio/pool";
import { adoptIds, referencedSourceIdsAcross, type Project } from "../doc/document";
import { pool, resetHistory, resetSessionState, state as appState } from "../state/appState.svelte";
import {
  deleteSource,
  disableDocumentSaves,
  listSourceIds,
  pauseDocumentSaves,
  putDocument,
  putSources,
  readAutosave,
  resumeDocumentSaves,
} from "./autosave";
import {
  applyDocumentDefaults,
  PROJECT_FILE_EXT,
  ProjectFileError,
  packCurrentProject,
  unpackProject,
  type SourceRecord,
} from "./project-file";
import { exportFilename } from "../export/formats";
import { saveRoute } from "./save-target";

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Minimal shape of the File System Access API this module uses. Typed here rather than pulled in
 *  wholesale: it is two calls, and the DOM lib's own definitions are not in every TS version. */
interface FileHandle {
  name: string;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileHandle>;
};

/** The file this session is saving to, so a second Save OVERWRITES it. Session state, not
 *  document state — it describes where the project came from, not what it is, and it cannot be
 *  serialised anyway. */
let fileHandle: FileHandle | null = null;

/** Cleared whenever the open document is REPLACED, or Save would write the new project over the
 *  file the previous one came from. */
export function forgetSaveTarget(): void {
  fileHandle = null;
}

/** The name of the file being saved to, for the UI. Null when there is none yet. */
export function saveTargetName(): string | null {
  return fileHandle?.name ?? null;
}

/**
 * Save the project.
 *
 * With the File System Access API this writes back to the handle the user chose, so Save means
 * save rather than "add another copy to Downloads", and the unsaved mark clears only once the
 * write has actually reported success. Without it (Firefox, Safari) this is the old download, and
 * `dirty` is cleared optimistically because a download gives no signal at all — see `saveRoute`.
 */
export async function saveProjectFile(saveAs = false): Promise<void> {
  const win = window as PickerWindow;
  const route = saveRoute({
    canPick: typeof win.showSaveFilePicker === "function",
    hasHandle: fileHandle !== null,
    saveAs,
  });
  const bytes = packCurrentProject($state.snapshot(appState.project), pool.records());
  // `packCurrentProject`'s return type is the bare `Uint8Array`, which TS widens to
  // `Uint8Array<ArrayBufferLike>` — Blob wants the concrete `ArrayBuffer` form. `zipSync` (its
  // implementation) always backs the array with a real ArrayBuffer, so this narrows a type, not a fact.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" });
  const filename = exportFilename(appState.project.name, PROJECT_FILE_EXT.slice(1));

  if (route.kind === "download") {
    download(blob, filename);
    appState.dirty = false;
    return;
  }

  if (route.kind === "picker") {
    try {
      fileHandle = await win.showSaveFilePicker!({
        suggestedName: filename,
        types: [
          {
            description: "Slop audio project",
            accept: { "application/zip": [PROJECT_FILE_EXT] },
          },
        ],
      });
    } catch (err) {
      // The user dismissed the dialog. That is a decision, not a failure: leave the document
      // dirty and say nothing.
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
  }

  const writable = await fileHandle!.createWritable();
  await writable.write(blob);
  await writable.close();
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
  // Session state first: it is keyed to the OUTGOING document, and stopping the engine before the
  // pool is emptied means nothing is left playing buffers this project no longer owns.
  resetSessionState();
  // The handle points at where the PREVIOUS project came from; keeping it would let the next Save
  // write this document straight over that file.
  forgetSaveTarget();
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
  // The debounce is HELD for the whole section. `loadInto`'s swap has already queued a document
  // save, and `putSources` is the hundreds-of-megabytes write: if it takes longer than the 3 s
  // debounce, that queued save lands first and the doc store describes this project while the
  // source store still holds the previous one's audio. Pausing is reversible — nothing has gone
  // wrong here, the writes are merely out of order — unlike the permanent disable below.
  pauseDocumentSaves();
  try {
    const previousIds = await listSourceIds();
    await putSources(sources);
    // The CURRENT document, not the one that was loaded: the UI stayed live through a write that
    // may have taken seconds, and any edit made in that time is already in `appState.project`.
    // Writing the loaded snapshot would silently roll those edits back on the next reload.
    await putDocument($state.snapshot(appState.project));
    const written = new Set(sources.map((s) => s.id));
    await pruneUnreferencedSources(
      appState.project,
      previousIds.filter((id) => !written.has(id)),
    );
    resumeDocumentSaves();
  } catch (err) {
    // The in-memory session has ALREADY been swapped by `loadInto` — deliberately, so a corrupt
    // file cannot destroy the open project. That leaves the app showing a document whose audio
    // was never stored, so the next edit's debounce would overwrite a perfectly good backup with
    // one whose clips resolve to nothing. Stop autosaving instead, and let the caller tell the
    // user; the previous session stays restorable until they reload.
    // Both halves matter: `disableDocumentSaves` also CANCELS the save `loadInto`'s swap has
    // already queued, which would otherwise land 3 s from now and overwrite the still-good
    // backup with this document.
    disableDocumentSaves();
    appState.autosaveBroken = true;
    throw err;
  }
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
