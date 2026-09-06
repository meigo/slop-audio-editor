/** Geometry for the resizable side panel (pure; no DOM). Mirrors slop-animator's module of the
 *  same name, so the family's panels behave identically. */

/** Below this a `BandSlider` row stops fitting: 80px of track, a 28px label, a 48px readout and
 *  the gaps between them, plus the panel's own padding. A floor, not a target. */
export const MIN_PANEL_WIDTH = 190;

/** What the panel opens at. Wide enough for the clip fields stacked vertically without the
 *  numbers crowding their labels. */
export const DEFAULT_PANEL_WIDTH = 224;

/** The collapsed rail. Wide enough for the toggle at its natural size — narrower and flex shrinks
 *  the button, which shifts it by a pixel or two as the panel opens. */
export const PANEL_RAIL_WIDTH = 30;

/**
 * Clamp a proposed panel width to [MIN, half the viewport], with MIN always winning.
 *
 * MIN wins so a very narrow window cannot produce a panel narrower than its own controls; the 50%
 * ceiling stops a drag (or a stored width from a bigger screen) leaving the timeline with nothing.
 */
export function clampPanelWidth(px: number, viewportW: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, Math.round(viewportW * 0.5));
  return Math.max(MIN_PANEL_WIDTH, Math.min(px, max));
}

/**
 * The panel's width part-way through a resize drag.
 *
 * Both grip values are captured at pointer-DOWN and the width recomputed from them, never
 * accumulated per frame: accumulating lets rounding pull the edge away from the pointer over a
 * long drag, the same reason the pinch gesture works from its start values.
 *
 * The subtraction is the part that looks wrong and is not — the panel is docked RIGHT, so moving
 * the grip LEFT (a smaller clientX) has to make it WIDER.
 */
export function resizedPanelWidth(
  gripStartW: number,
  gripStartX: number,
  clientX: number,
  viewportW: number,
): number {
  return clampPanelWidth(gripStartW + (gripStartX - clientX), viewportW);
}

/**
 * Which index a track header dragged to `pointerY` should land at.
 *
 * Every header is exactly `heightPx` tall, so this is arithmetic rather than hit-testing: the
 * index is how many whole rows down from the first header's top the pointer sits, clamped to the
 * track list. Taking the row under the POINTER (not under the dragged header's edge) is what
 * makes the swap happen when the pointer crosses a row's midpoint the way it looks like it should.
 */
export function trackDropIndex(
  pointerY: number,
  firstHeaderTop: number,
  heightPx: number,
  count: number,
): number {
  if (count <= 0 || heightPx <= 0) return 0;
  const raw = Math.floor((pointerY - firstHeaderTop) / heightPx);
  return Math.max(0, Math.min(raw, count - 1));
}
