import type { Project } from "../doc/document";
import type { SourceRecord } from "./project-file";

const DB_NAME = "slop-audio-editor";
const DB_VERSION = 1;
const DOC_STORE = "doc";
const SRC_STORE = "sources";
const DEBOUNCE_MS = 3000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE);
      if (!db.objectStoreNames.contains(SRC_STORE)) db.createObjectStore(SRC_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

/** Source bytes are IMMUTABLE and can be hundreds of megabytes, so they are written exactly once,
 *  on import. Only the document — kilobytes — is written on the debounce. Conflating the two
 *  would rewrite the whole media pool every few seconds. */
export async function putSource(record: SourceRecord): Promise<void> {
  const db = await open();
  tx(db, SRC_STORE, "readwrite").put({ name: record.name, bytes: record.bytes }, record.id);
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** `project` must ALREADY be a plain snapshot — this is a `.ts` module, so `$state.snapshot` is
 *  not available here, and IndexedDB cannot structured-clone a `$state` proxy. The caller in
 *  `appState.svelte.ts` takes the snapshot. */
export function scheduleDocumentSave(project: Project): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    const db = await open();
    tx(db, DOC_STORE, "readwrite").put(project, "project");
  }, DEBOUNCE_MS);
}

export async function readAutosave(): Promise<{ project: Project; sources: SourceRecord[] } | null> {
  const db = await open();
  const project = await new Promise<Project | undefined>((resolve) => {
    const r = tx(db, DOC_STORE, "readonly").get("project");
    r.onsuccess = () => resolve(r.result as Project | undefined);
    r.onerror = () => resolve(undefined);
  });
  if (!project) return null;

  const sources = await new Promise<SourceRecord[]>((resolve) => {
    const store = tx(db, SRC_STORE, "readonly");
    const out: SourceRecord[] = [];
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve(out);
      const v = c.value as { name: string; bytes: Uint8Array };
      out.push({ id: String(c.key), name: v.name, bytes: v.bytes });
      c.continue();
    };
    cursor.onerror = () => resolve(out);
  });
  return { project, sources };
}

export async function clearAutosave(): Promise<void> {
  const db = await open();
  tx(db, DOC_STORE, "readwrite").clear();
  tx(db, SRC_STORE, "readwrite").clear();
}
