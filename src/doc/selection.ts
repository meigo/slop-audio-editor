import { clipEndS, projectDurationS, type Clip, type Project } from "./document";

export interface TimeRange {
  fromS: number;
  toS: number;
  /** The tracks the range covers. Ripple and range-delete are scoped to exactly these. */
  trackIds: string[];
}

export type Selection =
  { kind: "none" } | { kind: "clips"; clipIds: string[] } | { kind: "range"; range: TimeRange };

export const NO_SELECTION: Selection = { kind: "none" };

/** Whether a range covers a clip: on one of its tracks, and OVERLAPPING it — touching edges do
 *  not count. The single definition of that rule; everything else asks this. */
export function rangeCoversClip(range: TimeRange, trackId: string, clip: Clip): boolean {
  if (!(range.toS > range.fromS)) return false;
  if (!range.trackIds.includes(trackId)) return false;
  return clip.startS < range.toS && clipEndS(clip) > range.fromS;
}

/** Every clip on the range's tracks that OVERLAPS it — touching edges do not count. */
export function clipsInRange(p: Project, range: TimeRange): string[] {
  const out: string[] = [];
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (rangeCoversClip(range, t.id, c)) out.push(c.id);
    }
  }
  return out;
}

/**
 * Whether a clip is part of what the current selection acts on.
 *
 * A RANGE selects the clips it covers, in full — `deleteRange`, a group drag and the context menu
 * all act on exactly these (a clip the range only partly covers still moves or deletes whole,
 * since a clip cannot be half-moved). So the outline has to say so too: before this, a range
 * showed only its own wash, and the clip sticking out past its edge gave no hint that it was
 * about to move with the rest.
 *
 * Takes the clip rather than the project so a component can ask about the one clip it draws,
 * without building a set of every selected id on every render.
 */
export function isClipSelected(selection: Selection, trackId: string, clip: Clip): boolean {
  if (selection.kind === "clips") return selection.clipIds.includes(clip.id);
  if (selection.kind === "range") return rangeCoversClip(selection.range, trackId, clip);
  return false;
}

/** Sorted, de-duplicated clip boundaries on the given tracks, always including 0. These are what
 *  the jump-to-edit-point shortcuts and edge snapping both use. */
export function editPoints(p: Project, trackIds: readonly string[]): number[] {
  const tracks = new Set(trackIds);
  const set = new Set<number>([0]);
  for (const t of p.tracks) {
    if (!tracks.has(t.id)) continue;
    for (const c of t.clips) {
      set.add(c.startS);
      set.add(clipEndS(c));
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function nextEditPoint(points: readonly number[], afterS: number): number | null {
  return points.find((t) => t > afterS) ?? null;
}

export function prevEditPoint(points: readonly number[], beforeS: number): number | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i] < beforeS) return points[i];
  return null;
}

/**
 * The time span "zoom to fit" should frame for a given selection.
 *
 * A range is taken as drawn rather than widened to the clips it covers: the box the user drew is
 * what they asked to look at, and a clip it only partly overlaps would stretch the view past it.
 * Anything that resolves to nothing — no selection, or ids left over from deleted clips — falls
 * back to the whole project, so "fit the selection" degrades into "fit everything" by definition
 * instead of by a special case at each call site.
 */
export function fitSpan(p: Project, selection: Selection): { fromS: number; toS: number } {
  if (selection.kind === "range") {
    return { fromS: selection.range.fromS, toS: selection.range.toS };
  }
  if (selection.kind === "clips") {
    const ids = new Set(selection.clipIds);
    let fromS = Infinity;
    let toS = -Infinity;
    for (const t of p.tracks) {
      for (const c of t.clips) {
        if (!ids.has(c.id)) continue;
        fromS = Math.min(fromS, c.startS);
        toS = Math.max(toS, clipEndS(c));
      }
    }
    if (toS > -Infinity) return { fromS, toS };
  }
  return { fromS: 0, toS: projectDurationS(p) };
}
