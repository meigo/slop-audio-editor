import { describe, expect, it } from "vitest";
import {
  GESTURE_GROUPS,
  GESTURES,
  isTypingTarget,
  repeatsOnHold,
  resolveShortcut,
  SHORTCUTS,
  type KeyEventLike,
} from "./shortcuts";

function key(k: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

describe("resolveShortcut", () => {
  it("maps transport and edit keys", () => {
    expect(resolveShortcut(key(" "))).toEqual({ kind: "togglePlay" });
    expect(resolveShortcut(key("s"))).toEqual({ kind: "split" });
    expect(resolveShortcut(key("l"))).toEqual({ kind: "toggleLoop" });
    expect(resolveShortcut(key("m"))).toEqual({ kind: "toggleMute" });
    expect(resolveShortcut(key("S", { shiftKey: true }))).toEqual({ kind: "toggleSolo" });
  });

  it("maps delete, with shift meaning ripple", () => {
    expect(resolveShortcut(key("Backspace"))).toEqual({ kind: "delete", ripple: false });
    expect(resolveShortcut(key("Delete"))).toEqual({ kind: "delete", ripple: false });
    expect(resolveShortcut(key("Delete", { shiftKey: true }))).toEqual({
      kind: "delete",
      ripple: true,
    });
  });

  it("maps the clipboard on either meta or ctrl", () => {
    expect(resolveShortcut(key("c", { metaKey: true }))).toEqual({ kind: "copy" });
    expect(resolveShortcut(key("x", { ctrlKey: true }))).toEqual({ kind: "cut" });
    expect(resolveShortcut(key("v", { metaKey: true }))).toEqual({ kind: "paste" });
    expect(resolveShortcut(key("d", { metaKey: true }))).toEqual({ kind: "duplicate" });
  });

  it("maps undo and redo, with shift for redo", () => {
    expect(resolveShortcut(key("z", { metaKey: true }))).toEqual({ kind: "undo" });
    expect(resolveShortcut(key("z", { metaKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
  });

  it("nudges by 100 ms, or 10 ms with shift", () => {
    expect(resolveShortcut(key("ArrowRight"))).toEqual({ kind: "nudge", deltaS: 0.1 });
    expect(resolveShortcut(key("ArrowLeft"))).toEqual({ kind: "nudge", deltaS: -0.1 });
    expect(resolveShortcut(key("ArrowRight", { shiftKey: true }))).toEqual({
      kind: "nudge",
      deltaS: 0.01,
    });
  });

  it("jumps between edit points with meta+arrow", () => {
    expect(resolveShortcut(key("ArrowRight", { metaKey: true }))).toEqual({
      kind: "jumpEdit",
      direction: 1,
    });
    expect(resolveShortcut(key("ArrowLeft", { metaKey: true }))).toEqual({
      kind: "jumpEdit",
      direction: -1,
    });
  });

  it("maps zoom", () => {
    expect(resolveShortcut(key("="))).toEqual({ kind: "zoom", factor: 1.5 });
    expect(resolveShortcut(key("+"))).toEqual({ kind: "zoom", factor: 1.5 });
    expect(resolveShortcut(key("-"))).toEqual({ kind: "zoom", factor: 1 / 1.5 });
    expect(resolveShortcut(key("F", { shiftKey: true }))).toEqual({
      kind: "zoomFit",
      scope: "project",
    });
  });

  it("fits the selection unshifted and the whole project shifted", () => {
    // The scope is the only difference between the two, and no other test can catch it being the
    // wrong way round: both keys resolve to the same command kind.
    expect(resolveShortcut(key("f"))).toEqual({ kind: "zoomFit", scope: "selection" });
    expect(resolveShortcut(key("F", { shiftKey: true }))).toEqual({
      kind: "zoomFit",
      scope: "project",
    });
  });

  it("returns null for anything unmapped", () => {
    expect(resolveShortcut(key("q"))).toBeNull();
    expect(resolveShortcut(key("F1"))).toBeNull();
  });

  it("does not confuse ⌘S with the split key", () => {
    expect(resolveShortcut(key("s", { metaKey: true }))).toEqual({ kind: "save" });
  });

  it("maps bare i/o to setIn/setOut", () => {
    expect(resolveShortcut(key("i"))).toEqual({ kind: "setIn" });
    expect(resolveShortcut(key("o"))).toEqual({ kind: "setOut" });
  });

  it("maps ⌘I/Ctrl+I to clearPlayRange", () => {
    expect(resolveShortcut(key("i", { metaKey: true }))).toEqual({ kind: "clearPlayRange" });
    expect(resolveShortcut(key("i", { ctrlKey: true }))).toEqual({ kind: "clearPlayRange" });
  });

  it("does not confuse ⌘I with the setIn key", () => {
    expect(resolveShortcut(key("i", { metaKey: true }))).toEqual({ kind: "clearPlayRange" });
  });
});

describe("select all", () => {
  it("resolves Cmd+A to selectAll", () => {
    expect(resolveShortcut(key("a", { metaKey: true }))).toEqual({ kind: "selectAll" });
  });

  it("resolves Ctrl+A too, for non-Mac keyboards", () => {
    expect(resolveShortcut(key("a", { ctrlKey: true }))).toEqual({ kind: "selectAll" });
  });

  it("leaves a bare 'a' unbound, so typing is not hijacked", () => {
    expect(resolveShortcut(key("a"))).toBeNull();
  });
});

describe("the documented shortcut list", () => {
  it("opens the help overlay on ?", () => {
    expect(resolveShortcut(key("?", { shiftKey: true }))).toEqual({ kind: "showHelp" });
  });

  // Without this the overlay could advertise a key that does nothing — the failure mode of every
  // hand-written shortcut list.
  it("only lists keys that really resolve to the command they claim", () => {
    for (const entry of SHORTCUTS) {
      expect(resolveShortcut(entry.event)?.kind, `${entry.keys} (${entry.label})`).toBe(
        entry.command,
      );
    }
  });

  // ...and this is the other direction: a shortcut added to the parser but never documented.
  // Sweeping the key space is what makes that detectable at all — a switch statement cannot be
  // reflected over.
  it("documents every command the parser can produce", () => {
    const keys = [
      " ",
      "Delete",
      "Backspace",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "=",
      "+",
      "-",
      "_",
      "?",
      "/",
      "Escape",
      "Enter",
      "Tab",
      ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)),
      ...Array.from({ length: 10 }, (_, i) => String(i)),
    ];
    const resolvable = new Set<string>();
    for (const k of keys) {
      for (const mod of [false, true]) {
        for (const shift of [false, true]) {
          // Real browsers report the SHIFTED character, so a shifted letter arrives uppercase —
          // "S" is a different key event from "s", and the parser distinguishes them.
          const sent = shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k;
          const cmd = resolveShortcut(key(sent, { metaKey: mod, shiftKey: shift }));
          if (cmd) resolvable.add(cmd.kind);
        }
      }
    }

    expect([...resolvable].sort()).toEqual([...new Set(SHORTCUTS.map((s) => s.command))].sort());
  });
});

describe("GESTURES", () => {
  // Nothing here can be joined to a parser the way the key table is (see the table's own comment),
  // so this only catches a duplicated row — a real copy-paste slip, and the one mistake in that
  // table a test CAN see.
  it("lists each gesture once per group", () => {
    const keys = GESTURES.map((g) => `${g.group}/${g.gesture}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("orders the groups by first appearance, with none left stranded", () => {
    expect(new Set(GESTURES.map((g) => g.group))).toEqual(new Set(GESTURE_GROUPS));
  });
});

describe("isTypingTarget", () => {
  it("blocks shortcuts for real text entry", () => {
    expect(isTypingTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTypingTarget({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("lets shortcuts through for sliders and other non-text inputs", () => {
    // Every fader, band, filter, pan and drive control is a range input. Blocking on those meant
    // Space stopped working the moment you touched the mixer.
    expect(isTypingTarget({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isTypingTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
  });

  it("treats an input with no type as text, the HTML default", () => {
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });
});

describe("repeatsOnHold", () => {
  it("lets movement commands repeat", () => {
    expect(repeatsOnHold("nudge")).toBe(true);
    expect(repeatsOnHold("zoom")).toBe(true);
  });

  it("stops toggles repeating — a held Space stuttered playback", () => {
    expect(repeatsOnHold("togglePlay")).toBe(false);
    expect(repeatsOnHold("toggleMute")).toBe(false);
    expect(repeatsOnHold("toggleSolo")).toBe(false);
    expect(repeatsOnHold("toggleLoop")).toBe(false);
    expect(repeatsOnHold("delete")).toBe(false);
  });
});
