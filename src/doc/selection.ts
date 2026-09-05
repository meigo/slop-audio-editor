import { clipEndS, type Project } from "./document";

export interface TimeRange {
  fromS: number;
  toS: number;
  /** The tracks the range covers. Ripple and range-delete are scoped to exactly these. */
  trackIds: string[];
}

export type Selection =
  { kind: "none" } | { kind: "clips"; clipIds: string[] } | { kind: "range"; range: TimeRange };

export const NO_SELECTION: Selection = { kind: "none" };

/** Every clip on the range's tracks that OVERLAPS it — touching edges do not count. */
export function clipsInRange(p: Project, range: TimeRange): string[] {
  if (!(range.toS > range.fromS)) return [];
  const tracks = new Set(range.trackIds);
  const out: string[] = [];
  for (const t of p.tracks) {
    if (!tracks.has(t.id)) continue;
    for (const c of t.clips) {
      if (c.startS < range.toS && clipEndS(c) > range.fromS) out.push(c.id);
    }
  }
  return out;
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
