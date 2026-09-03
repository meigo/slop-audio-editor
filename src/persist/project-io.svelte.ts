import { decodeSource } from "../audio/pool";
import { pool, state as appState } from "../state/appState.svelte";
import { clearAutosave, putSource, readAutosave } from "./autosave";
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

/** Replace everything: clear the pool, re-decode every embedded source, install the document.
 *  Sources are decoded and added to the pool BEFORE `appState.project` is assigned — the pool is
 *  a plain (non-reactive) Map, and `Waveform.svelte` reads it inside an `$effect` Svelte cannot
 *  track. Assigning the project first would put clips into reactive state whose source is not in
 *  the pool yet, rendering blank until some unrelated redraw happened to fix it. */
async function loadInto(project: typeof appState.project, sources: SourceRecord[]): Promise<void> {
  pool.clear();
  for (const s of sources) {
    appState.importing = { name: s.name, fraction: 0 };
    try {
      pool.add(await decodeSource(s.id, s.name, s.bytes, (f) => {
        appState.importing = { name: s.name, fraction: f };
      }));
    } finally {
      appState.importing = null;
    }
  }
  appState.project = project;
  appState.dirty = false;
}

export async function openProjectFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { project, sources } = unpackProject(bytes); // throws ProjectFileError, surfaced by caller
  await clearAutosave();
  await loadInto(project, sources);
  for (const s of sources) await putSource(s);
}

export async function restoreAutosave(): Promise<boolean> {
  const saved = await readAutosave();
  if (!saved) return false;
  await loadInto(saved.project, saved.sources);
  return true;
}

export { ProjectFileError };
