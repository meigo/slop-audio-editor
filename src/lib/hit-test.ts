export type ClipZone = "fadeIn" | "fadeOut" | "trimStart" | "trimEnd" | "body";
export type RulerZone = "in" | "out" | "seek";

const EDGE_PX = 6;
const FADE_CORNER_PX = 14;
const FADE_CORNER_H_PX = 12;

export interface ClipZoneSizes {
  edgePx: number;
  fadeCornerPx: number;
  fadeCornerHPx: number;
}

/** Mouse: a 6 px edge is precise and easy to hit with a cursor you can see. */
export const MOUSE_ZONES: ClipZoneSizes = {
  edgePx: EDGE_PX,
  fadeCornerPx: FADE_CORNER_PX,
  fadeCornerHPx: FADE_CORNER_H_PX,
};

/** Touch: a fingertip covers roughly 44 px and there is no cursor to aim with, so the bands are
 *  widened. They are NOT the full 44 px, because every pixel given to trim is taken from the
 *  clip's body — grabbing a trim edge when you meant to move the clip is the worse error, since
 *  moving is the far more common gesture. */
export const TOUCH_ZONES: ClipZoneSizes = {
  edgePx: 18,
  fadeCornerPx: 28,
  fadeCornerHPx: 24,
};

/** Which part of a clip a pointer is over, in clip-local pixels.
 *  Fade corners sit ON TOP of the trim edges, so they need the narrower band and win the test —
 *  but only when the clip is wide enough for both corners plus some body.
 *  `_heightPx` is part of the interface (callers pass the clip's full pixel height) but is not
 *  read: only the fixed `FADE_CORNER_H_PX` band matters, not the clip's own height. Prefixed with
 *  `_` to satisfy `noUnusedParameters` without dropping the parameter from the signature. */
export function hitTestClip(
  xPx: number,
  yPx: number,
  widthPx: number,
  _heightPx: number,
  sizes: ClipZoneSizes = MOUSE_ZONES,
): ClipZone {
  if (widthPx <= 0) return "body";
  const roomForFades = widthPx >= sizes.fadeCornerPx * 2 + sizes.edgePx;
  if (roomForFades && yPx <= sizes.fadeCornerHPx) {
    if (xPx <= sizes.fadeCornerPx) return "fadeIn";
    if (xPx >= widthPx - sizes.fadeCornerPx) return "fadeOut";
  }
  // On a narrow clip the two trim bands would meet and leave no body to grab, which on touch
  // would make the clip impossible to MOVE. Give each edge at most a third of the width.
  const edge = Math.min(sizes.edgePx, widthPx / 3);
  if (xPx <= edge) return "trimStart";
  if (xPx >= widthPx - edge) return "trimEnd";
  return "body";
}

const RULER_HANDLE_PX = 6;

/** Which part of the ruler a pointer is over. A `null` position means that marker isn't set and
 *  can never be hit. When both handles are within `thresholdPx`, the NEARER one wins. */
export function hitTestRuler(
  xPx: number,
  inPx: number | null,
  outPx: number | null,
  thresholdPx = RULER_HANDLE_PX,
): RulerZone {
  const dIn = inPx === null ? Infinity : Math.abs(xPx - inPx);
  const dOut = outPx === null ? Infinity : Math.abs(xPx - outPx);
  if (dIn > thresholdPx && dOut > thresholdPx) return "seek";
  return dIn <= dOut ? "in" : "out";
}
