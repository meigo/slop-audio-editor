export type Command =
  | { kind: "togglePlay" }
  | { kind: "split" }
  | { kind: "toggleLoop" }
  | { kind: "toggleMute" }
  | { kind: "toggleSolo" }
  | { kind: "delete"; ripple: boolean }
  | { kind: "copy" }
  | { kind: "cut" }
  | { kind: "paste" }
  | { kind: "duplicate" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "save" }
  | { kind: "nudge"; deltaS: number }
  | { kind: "jumpEdit"; direction: 1 | -1 }
  | { kind: "zoom"; factor: number }
  | { kind: "zoomFit"; scope: "project" | "selection" }
  | { kind: "setIn" }
  | { kind: "setOut" }
  | { kind: "clearPlayRange" }
  | { kind: "selectAll" }
  | { kind: "showHelp" };

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const NUDGE_S = 0.1;
const FINE_NUDGE_S = 0.01;
const ZOOM_FACTOR = 1.5;

export function resolveShortcut(e: KeyEventLike): Command | null {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;

  // The modifier branch is checked FIRST so that ⌘S resolves to "save" rather than falling
  // through to the unmodified "s" -> "split" case below.
  if (mod) {
    switch (k.toLowerCase()) {
      case "z":
        return { kind: e.shiftKey ? "redo" : "undo" };
      case "c":
        return { kind: "copy" };
      case "x":
        return { kind: "cut" };
      case "v":
        return { kind: "paste" };
      case "d":
        return { kind: "duplicate" };
      case "a":
        return { kind: "selectAll" };
      case "s":
        return { kind: "save" };
      case "arrowright":
        return { kind: "jumpEdit", direction: 1 };
      case "arrowleft":
        return { kind: "jumpEdit", direction: -1 };
      case "i":
        return { kind: "clearPlayRange" };
      default:
        return null;
    }
  }

  switch (k) {
    case " ":
      return { kind: "togglePlay" };
    case "s":
      return { kind: "split" };
    case "S":
      return { kind: "toggleSolo" };
    case "l":
      return { kind: "toggleLoop" };
    case "m":
      return { kind: "toggleMute" };
    case "i":
      return { kind: "setIn" };
    case "o":
      return { kind: "setOut" };
    case "f":
      return { kind: "zoomFit", scope: "selection" };
    case "F":
      return { kind: "zoomFit", scope: "project" };
    case "?":
      return { kind: "showHelp" };
    case "Delete":
    case "Backspace":
      return { kind: "delete", ripple: e.shiftKey };
    case "ArrowRight":
      return { kind: "nudge", deltaS: e.shiftKey ? FINE_NUDGE_S : NUDGE_S };
    case "ArrowLeft":
      return { kind: "nudge", deltaS: -(e.shiftKey ? FINE_NUDGE_S : NUDGE_S) };
    case "=":
    case "+":
      return { kind: "zoom", factor: ZOOM_FACTOR };
    case "-":
    case "_":
      return { kind: "zoom", factor: 1 / ZOOM_FACTOR };
    default:
      return null;
  }
}

const ev = (key: string, mods: { mod?: boolean; shift?: boolean } = {}): KeyEventLike => ({
  key,
  metaKey: mods.mod ?? false,
  ctrlKey: false,
  shiftKey: mods.shift ?? false,
  altKey: false,
});

export interface ShortcutDoc {
  /** Column heading in the help overlay. */
  group: "Transport" | "Editing" | "Tracks" | "View" | "File";
  /** How the key is written for a reader, e.g. "⌘Z". Follows the ⌘/⇧ convention the tooltips
   *  already use, on every platform — `resolveShortcut` accepts ctrl as well as meta. */
  keys: string;
  label: string;
  /** The event this entry claims to describe, and the command it must produce. Both are checked
   *  against `resolveShortcut` by a test, so the overlay cannot advertise a key that does
   *  nothing; a second test sweeps the key space so a shortcut cannot be added without being
   *  documented here. What no test can catch is a wrong LABEL — that stays on the author. */
  event: KeyEventLike;
  command: Command["kind"];
}

/** The overlay's contents. Deliberately a separate table rather than something `resolveShortcut`
 *  is refactored to consume: that parser is small, pure and well tested, and turning it into a
 *  data-driven dispatcher to generate its own documentation would put the riskier code in the
 *  more important place. The tests do the joining instead. */
export const SHORTCUTS: readonly ShortcutDoc[] = [
  {
    group: "Transport",
    keys: "Space",
    label: "Play / pause",
    event: ev(" "),
    command: "togglePlay",
  },
  { group: "Transport", keys: "L", label: "Loop", event: ev("l"), command: "toggleLoop" },
  { group: "Transport", keys: "I", label: "Set in point", event: ev("i"), command: "setIn" },
  { group: "Transport", keys: "O", label: "Set out point", event: ev("o"), command: "setOut" },
  {
    group: "Transport",
    keys: "⌘I",
    label: "Clear in/out",
    event: ev("i", { mod: true }),
    command: "clearPlayRange",
  },
  {
    group: "Transport",
    keys: "⌘←  ⌘→",
    label: "Jump to previous / next edit",
    event: ev("ArrowRight", { mod: true }),
    command: "jumpEdit",
  },

  { group: "Editing", keys: "S", label: "Split at playhead", event: ev("s"), command: "split" },
  { group: "Editing", keys: "⌘X", label: "Cut", event: ev("x", { mod: true }), command: "cut" },
  { group: "Editing", keys: "⌘C", label: "Copy", event: ev("c", { mod: true }), command: "copy" },
  {
    group: "Editing",
    keys: "⌘V",
    label: "Paste at playhead, on the current track",
    event: ev("v", { mod: true }),
    command: "paste",
  },
  {
    group: "Editing",
    keys: "⌘D",
    label: "Duplicate",
    event: ev("d", { mod: true }),
    command: "duplicate",
  },
  {
    group: "Editing",
    keys: "Delete",
    label: "Delete selection",
    event: ev("Delete"),
    command: "delete",
  },
  {
    group: "Editing",
    keys: "←  →",
    label: "Nudge by 0.1 s (⇧ for 0.01 s)",
    event: ev("ArrowRight"),
    command: "nudge",
  },
  { group: "Editing", keys: "⌘Z", label: "Undo", event: ev("z", { mod: true }), command: "undo" },
  {
    group: "Editing",
    keys: "⇧⌘Z",
    label: "Redo",
    event: ev("z", { mod: true, shift: true }),
    command: "redo",
  },
  {
    group: "Editing",
    keys: "⌘A",
    label: "Select all clips",
    event: ev("a", { mod: true }),
    command: "selectAll",
  },

  {
    group: "Tracks",
    keys: "M",
    label: "Mute current track",
    event: ev("m"),
    command: "toggleMute",
  },
  {
    group: "Tracks",
    keys: "⇧S",
    label: "Solo current track",
    event: ev("S", { shift: true }),
    command: "toggleSolo",
  },

  { group: "View", keys: "+  −", label: "Zoom in / out", event: ev("="), command: "zoom" },
  {
    group: "View",
    keys: "F",
    label: "Zoom to fit the selection",
    event: ev("f"),
    command: "zoomFit",
  },
  {
    group: "View",
    keys: "⇧F",
    label: "Zoom to fit the whole project",
    event: ev("F", { shift: true }),
    command: "zoomFit",
  },
  {
    group: "View",
    keys: "?",
    label: "This list",
    event: ev("?", { shift: true }),
    command: "showHelp",
  },

  {
    group: "File",
    keys: "⌘S",
    label: "Save project",
    event: ev("s", { mod: true }),
    command: "save",
  },
];

/** Group order for the overlay — the order of `SHORTCUTS` itself, deduplicated, so adding an
 *  entry to a group never leaves it stranded under a heading that is rendered somewhere else. */
export const SHORTCUT_GROUPS: readonly ShortcutDoc["group"][] = [
  ...new Set(SHORTCUTS.map((s) => s.group)),
];

export interface GestureDoc {
  group: "Clips" | "Timeline" | "Tracks" | "Panels";
  /** How the gesture is performed — the chip's text. */
  gesture: string;
  label: string;
}

/**
 * Pointer and touch gestures, for the same overlay as `SHORTCUTS`.
 *
 * Nothing here can be checked the way the key table is: `resolveShortcut` is a pure function a
 * test can drive, while these gestures live in `clip-drag`, `hit-test`, `long-press` and the
 * components' own handlers, with no single function to ask. So this table is documentation that
 * can drift — the same hole that already exists for a shortcut's LABEL (see `ShortcutDoc`).
 *
 * The mitigation is to name no NUMBERS: no hit-zone widths, no long-press duration, no scrub
 * step. A gesture description stays true when a constant is retuned; a number quietly stops being
 * true. Importing those constants instead would be worse here — `long-press.ts` reaches into
 * `appState`, and this module is deliberately pure.
 */
export const GESTURES: readonly GestureDoc[] = [
  { group: "Clips", gesture: "Drag", label: "Move the clip, or the whole selection" },
  { group: "Clips", gesture: "Drag an edge", label: "Trim the start or the end" },
  { group: "Clips", gesture: "⌘ or ⇧ click", label: "Add or remove a clip from the selection" },
  { group: "Clips", gesture: "⇧ while dragging", label: "Ignore snapping" },
  { group: "Clips", gesture: "Right-click", label: "Cut, copy, paste, delete, zoom to fit" },
  { group: "Clips", gesture: "Press and hold", label: "The same menu, on a touchscreen" },

  { group: "Timeline", gesture: "Drag empty lane", label: "Select a time range" },
  { group: "Timeline", gesture: "Click or drag the ruler", label: "Move the playhead" },
  { group: "Timeline", gesture: "Drag an in/out marker", label: "Move that end of the play range" },
  { group: "Timeline", gesture: "⌘ wheel", label: "Zoom about the pointer" },
  { group: "Timeline", gesture: "Wheel or two-finger swipe", label: "Scroll through time" },
  { group: "Timeline", gesture: "Pinch", label: "Zoom and pan together, on a touchscreen" },

  { group: "Tracks", gesture: "Drag the grip", label: "Reorder the track" },
  { group: "Tracks", gesture: "Double-click the name", label: "Rename the track" },
  {
    group: "Tracks",
    gesture: "Click a header",
    label: "Make it the current track, which M, ⇧S and paste act on",
  },

  { group: "Panels", gesture: "Drag a number field", label: "Scrub its value (⇧ for finer steps)" },
  { group: "Panels", gesture: "Drag the panel's edge", label: "Resize the side panel" },
];

/** Group order for the overlay, derived like `SHORTCUT_GROUPS`. */
export const GESTURE_GROUPS: readonly GestureDoc["group"][] = [
  ...new Set(GESTURES.map((g) => g.group)),
];
