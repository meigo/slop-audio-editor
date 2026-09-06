import { describe, expect, it } from "vitest";
import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  resizedPanelWidth,
} from "./panel-layout";

describe("clampPanelWidth", () => {
  it("leaves a sensible width alone", () => {
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, 1400)).toBe(DEFAULT_PANEL_WIDTH);
  });

  it("will not go narrower than its own controls", () => {
    expect(clampPanelWidth(20, 1400)).toBe(MIN_PANEL_WIDTH);
  });

  it("will not take more than half the window, or the timeline gets nothing", () => {
    expect(clampPanelWidth(2000, 1000)).toBe(500);
  });

  // The floor beats the ceiling: on a very narrow window a panel that respected 50% would be
  // narrower than the sliders inside it, which is worse than overflowing.
  it("keeps the minimum even when half the viewport is smaller than it", () => {
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, 200)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(20, 200)).toBe(MIN_PANEL_WIDTH);
  });

  it("rounds the ceiling rather than leaving a fractional width", () => {
    expect(clampPanelWidth(9999, 1001)).toBe(501);
  });
});

describe("resizedPanelWidth", () => {
  const VIEW = 1400;

  // The panel is docked right, so dragging the grip LEFT must make it wider. Getting this
  // backwards is the classic bug with a right-docked panel, and it is pure arithmetic — which is
  // why it lives here rather than inside the pointer handler, where it cannot be tested.
  it("widens when the grip moves left", () => {
    expect(resizedPanelWidth(224, 1000, 900, VIEW)).toBe(324);
  });

  it("narrows when the grip moves right", () => {
    expect(resizedPanelWidth(324, 1000, 1050, VIEW)).toBe(274);
  });

  it("is computed from the grip's START, not accumulated per move", () => {
    // Two moves to the same place give the same width, however the pointer got there.
    expect(resizedPanelWidth(224, 1000, 940, VIEW)).toBe(resizedPanelWidth(224, 1000, 940, VIEW));
    expect(resizedPanelWidth(224, 1000, 940, VIEW)).toBe(284);
  });

  it("stays clamped mid-drag", () => {
    expect(resizedPanelWidth(224, 1000, 5000, VIEW)).toBe(MIN_PANEL_WIDTH);
    expect(resizedPanelWidth(224, 1000, -5000, VIEW)).toBe(700);
  });

  it("returns the starting width when the pointer has not moved", () => {
    expect(resizedPanelWidth(DEFAULT_PANEL_WIDTH, 1000, 1000, VIEW)).toBe(DEFAULT_PANEL_WIDTH);
  });
});
