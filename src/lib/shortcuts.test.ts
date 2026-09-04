import { describe, expect, it } from "vitest";
import { resolveShortcut, type KeyEventLike } from "./shortcuts";

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
      kind: "delete", ripple: true,
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
      kind: "nudge", deltaS: 0.01,
    });
  });

  it("jumps between edit points with meta+arrow", () => {
    expect(resolveShortcut(key("ArrowRight", { metaKey: true }))).toEqual({
      kind: "jumpEdit", direction: 1,
    });
    expect(resolveShortcut(key("ArrowLeft", { metaKey: true }))).toEqual({
      kind: "jumpEdit", direction: -1,
    });
  });

  it("maps zoom", () => {
    expect(resolveShortcut(key("="))).toEqual({ kind: "zoom", factor: 1.5 });
    expect(resolveShortcut(key("+"))).toEqual({ kind: "zoom", factor: 1.5 });
    expect(resolveShortcut(key("-"))).toEqual({ kind: "zoom", factor: 1 / 1.5 });
    expect(resolveShortcut(key("F", { shiftKey: true }))).toEqual({ kind: "zoomFit" });
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
