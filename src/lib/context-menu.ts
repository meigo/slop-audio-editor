import type { Selection } from "../doc/selection";

export interface ContextItem {
  id: "cut" | "copy" | "duplicate" | "delete" | "paste" | "zoomFit";
  label: string;
  enabled: boolean;
}

/** Keeps the menu from opening off the edge of the window. Flips to the other side of the pointer
 *  when there is no room, rather than sliding along the edge — a menu that overlaps what was
 *  right-clicked hides the thing being acted on. */
export function clampMenuPosition(
  x: number,
  y: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 4,
): { x: number; y: number } {
  const fitX = x + size.width + margin > viewport.width ? x - size.width : x;
  const fitY = y + size.height + margin > viewport.height ? y - size.height : y;
  return { x: Math.max(margin, fitX), y: Math.max(margin, fitY) };
}

/**
 * What the menu offers for a given selection and clipboard.
 *
 * Items are DISABLED rather than removed: a menu that changes shape between openings moves its
 * own items under the pointer, and a greyed row still teaches that the action exists — which is
 * the whole reason this menu was added, since on a touch device it is the only way to reach
 * delete and the clipboard at all.
 */
export function contextItems(selection: Selection, hasClipboard: boolean): ContextItem[] {
  const hasSelection =
    (selection.kind === "clips" && selection.clipIds.length > 0) || selection.kind === "range";
  // Cut, copy and duplicate go through the clipboard, which only handles whole clips; a time
  // range can be deleted but not copied.
  const clips = selection.kind === "clips" && selection.clipIds.length > 0;
  return [
    { id: "cut", label: "Cut", enabled: clips },
    { id: "copy", label: "Copy", enabled: clips },
    { id: "paste", label: "Paste", enabled: hasClipboard },
    { id: "duplicate", label: "Duplicate", enabled: clips },
    { id: "delete", label: "Delete", enabled: hasSelection },
    // Always enabled: with nothing selected it frames the whole project, and this menu is the
    // only place zoom-to-fit can be reached on a touch device.
    { id: "zoomFit", label: "Zoom to fit", enabled: true },
  ];
}
