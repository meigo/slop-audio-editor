export type ClipZone = "fadeIn" | "fadeOut" | "trimStart" | "trimEnd" | "body";

const EDGE_PX = 6;
const FADE_CORNER_PX = 14;
const FADE_CORNER_H_PX = 12;

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
): ClipZone {
  if (widthPx <= 0) return "body";
  const roomForFades = widthPx >= FADE_CORNER_PX * 2 + EDGE_PX;
  if (roomForFades && yPx <= FADE_CORNER_H_PX) {
    if (xPx <= FADE_CORNER_PX) return "fadeIn";
    if (xPx >= widthPx - FADE_CORNER_PX) return "fadeOut";
  }
  if (xPx <= EDGE_PX) return "trimStart";
  if (xPx >= widthPx - EDGE_PX) return "trimEnd";
  return "body";
}
