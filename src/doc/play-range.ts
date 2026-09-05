/** In/out play-range markers that bound (and loop) playback over part of the project.
 *  Session state only — see `appState.svelte.ts`'s `playRange` field. Never part of `Project`,
 *  never saved, never touched by export (see `export/formats.ts`'s `exportWindow`, which
 *  deliberately keeps using the time-range selection instead). */

export interface PlayRange {
  fromS: number;
  toS: number;
}

/** A range shorter than this is refused rather than created — a marker pair this close together
 *  is indistinguishable from a mis-click and would produce an inaudible "loop." */
export const MIN_PLAY_RANGE_S = 0.05;

/** Move (or create) the IN marker to `atS`.
 *
 * On an existing range, only `fromS` moves, CLAMPED to at most `toS - MIN_PLAY_RANGE_S` — pushing
 * IN past OUT never swaps the two ends. This mirrors how the clip trim handles behave
 * (`trimClipStart`/`trimClipEnd` in `edits.ts`): a handle that swapped past its partner would
 * silently invert what's being trimmed, so both trim and here, the far end holds and the near end
 * stops short of it instead. */
export function setIn(range: PlayRange | null, atS: number, projectEndS: number): PlayRange | null {
  const at = Math.max(0, Math.min(atS, projectEndS));
  if (range === null) {
    if (projectEndS - at < MIN_PLAY_RANGE_S) return null;
    return { fromS: at, toS: projectEndS };
  }
  const fromS = Math.max(0, Math.min(at, range.toS - MIN_PLAY_RANGE_S));
  return fromS === range.fromS ? range : { fromS, toS: range.toS };
}

/** Move (or create) the OUT marker to `atS`. Symmetric to `setIn`: only `toS` moves, clamped to at
 *  least `fromS + MIN_PLAY_RANGE_S`, never swapping the ends. */
export function setOut(
  range: PlayRange | null,
  atS: number,
  projectEndS: number,
): PlayRange | null {
  const at = Math.max(0, Math.min(atS, projectEndS));
  if (range === null) {
    if (at < MIN_PLAY_RANGE_S) return null;
    return { fromS: 0, toS: at };
  }
  const toS = Math.min(projectEndS, Math.max(at, range.fromS + MIN_PLAY_RANGE_S));
  return toS === range.toS ? range : { fromS: range.fromS, toS };
}
