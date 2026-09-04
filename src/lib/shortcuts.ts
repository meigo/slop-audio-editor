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
  | { kind: "zoomFit" }
  | { kind: "setIn" }
  | { kind: "setOut" }
  | { kind: "clearPlayRange" }
  | { kind: "selectAll" };

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
    case "F":
      return { kind: "zoomFit" };
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
