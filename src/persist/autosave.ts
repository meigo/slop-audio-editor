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

/** Resolve when the request actually completes, reject if it fails.
 *
 *  The reads in this file already do this. The writes did not: they resolved as soon as the
 *  database opened, so a failed put — quota exceeded, aborted transaction, evicted storage —
 *  was invisible. A later restore would then load a project that is silently missing audio and
 *  show no error, which for an autosave is worse than failing loudly. */
function awaitRequest(req: IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB write failed"));
  });
}

/** Source bytes are IMMUTABLE and can be hundreds of megabytes, so they are written exactly once,
 *  on import. Only the document — kilobytes — is written on the debounce. Conflating the two
 *  would rewrite the whole media pool every few seconds. */
export async function putSource(record: SourceRecord): Promise<void> {
  const db = await open();
  await awaitRequest(
    tx(db, SRC_STORE, "readwrite").put({ name: record.name, bytes: record.bytes }, record.id),
  );
}

/** Every record in ONE transaction, so replacing a whole session is all-or-nothing.
 *  `putSource` writes one record per transaction, which is right for import — one file at a
 *  time, and a failure loses only that file — but wrong here. The sources being written are the
 *  ones just loaded, hundreds of megabytes, which is exactly when a quota error happens; a
 *  per-record loop that fails partway would leave the store holding some of the new project's
 *  audio and some of the previous one's, a mix that looks intact and is not. IndexedDB aborts a
 *  transaction wholesale when any request in it fails, so either every source lands or the
 *  previous session is untouched. Awaiting the TRANSACTION rather than each request is what
 *  makes that guarantee observable — a per-request await would resolve for the puts that
 *  succeeded before the abort. */
export async function putSources(records: readonly SourceRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await open();
  const t = db.transaction(SRC_STORE, "readwrite");
  const store = t.objectStore(SRC_STORE);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
    t.onerror = () => reject(t.error ?? new Error("IndexedDB write failed"));
    for (const r of records) store.put({ name: r.name, bytes: r.bytes }, r.id);
  });
}

/** Writes the document NOW and propagates failure, unlike `scheduleDocumentSave`.
 *
 *  The debounce is right for editing: the document is rewritten every few seconds regardless, so
 *  a dropped tick costs nothing. Replacing the whole session has a window the debounce cannot
 *  cover — until the new document lands, the doc store still describes the PREVIOUS project
 *  while the source store already holds this one's audio. Closing that window is the caller's
 *  reason for existing, so this one reports its failures.
 *
 *  Same constraint as `scheduleDocumentSave`: `project` must already be a plain snapshot. */
export async function putDocument(project: Project): Promise<void> {
  const db = await open();
  await awaitRequest(tx(db, DOC_STORE, "readwrite").put(project, "project"));
}

/** Keys only. The values are the audio itself and can be hundreds of megabytes, so a caller that
 *  merely wants to know WHICH sources are stored must never reach for `readAutosave`. */
export async function listSourceIds(): Promise<string[]> {
  const db = await open();
  return new Promise((resolve) => {
    const r = tx(db, SRC_STORE, "readonly").getAllKeys();
    r.onsuccess = () => resolve(r.result.map(String));
    r.onerror = () => resolve([]);
  });
}

/** Removes one source record. `putSource` is otherwise append-only, so this is the only way an
 *  orphaned source — no longer referenced by any clip in the document — stops taking up space. */
export async function deleteSource(id: string): Promise<void> {
  const db = await open();
  await awaitRequest(tx(db, SRC_STORE, "readwrite").delete(id));
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** `project` must ALREADY be a plain snapshot — this is a `.ts` module, so `$state.snapshot` is
 *  not available here, and IndexedDB cannot structured-clone a `$state` proxy. The caller in
 *  `appState.svelte.ts` takes the snapshot. */
export function scheduleDocumentSave(project: Project): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    // No caller is waiting on this timer callback to reject to, so — unlike `putSource` and
    // `putDocument` — a failure here is swallowed rather than propagated. Crashing the app over
    // a missed autosave tick would be a worse outcome than the tick itself: the document is
    // rewritten every few seconds regardless of user action, so the next edit's debounce will
    // simply retry the same write.
    try {
      const db = await open();
      await awaitRequest(tx(db, DOC_STORE, "readwrite").put(project, "project"));
    } catch (err) {
      console.warn("Autosave: failed to write document", err);
    }
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
