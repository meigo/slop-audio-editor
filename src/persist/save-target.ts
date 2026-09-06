/** Where a project save should go, decided without touching the DOM so it can be tested. */

export type SaveRoute =
  /** Write straight back to the handle the user already chose. */
  | { kind: "handle" }
  /** Ask for a location, then write — and remember the handle for next time. */
  | { kind: "picker" }
  /** No File System Access API: hand the browser a download and hope. */
  | { kind: "download" };

export interface SaveContext {
  /** `window.showSaveFilePicker` exists — Chrome and Edge today, not Firefox or Safari. */
  canPick: boolean;
  /** A handle from an earlier save in this session. */
  hasHandle: boolean;
  /** The user asked for Save As, so an existing handle is deliberately ignored. */
  saveAs: boolean;
}

/**
 * Which route a save takes.
 *
 * The point of the picker route is not the dialog: it is that a handle can be written back to, so
 * Save OVERWRITES the file the user chose instead of dropping `Untitled (3).slopaudio` into
 * Downloads every time. It also makes the unsaved mark honest — a download gives no signal at all,
 * so `dirty` was cleared the moment the anchor was clicked, whether or not the user then cancelled
 * the browser's own dialog. On the download route it still is; there is nothing better available.
 */
export function saveRoute(ctx: SaveContext): SaveRoute {
  if (!ctx.canPick) return { kind: "download" };
  if (ctx.hasHandle && !ctx.saveAs) return { kind: "handle" };
  return { kind: "picker" };
}

/** Whether the unsaved mark can be trusted to clear for a route that completed. A download is
 *  fire-and-forget: the browser may still show its own dialog, and cancelling it leaves the file
 *  unwritten with nothing to tell us. */
export function clearsDirty(route: SaveRoute): boolean {
  return route.kind !== "download";
}
