import { projectDurationS, type Project } from "../doc/document";
import type { PlayRange } from "../doc/play-range";
import type { Selection } from "../doc/selection";
import { formatTime } from "./geometry";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The status line's resting text: what the project IS, when nothing is being hovered.
 *
 *  The in/out range is reported separately from the selection, and labelled as such, because they
 *  are different things that look alike: the selection drives export, the in/out markers only
 *  bound playback and never reach a file. Collapsing them into one "range" would suggest the
 *  export follows the markers. */
export function statusSummary(
  project: Project,
  selection: Selection,
  playRange: PlayRange | null,
): string {
  const parts = [
    plural(project.tracks.length, "track"),
    formatTime(projectDurationS(project)),
  ];

  if (selection.kind === "clips" && selection.clipIds.length > 0) {
    parts.push(`${plural(selection.clipIds.length, "clip")} selected`);
  } else if (selection.kind === "range") {
    const { fromS, toS } = selection.range;
    parts.push(`${formatTime(fromS)}–${formatTime(toS)} (${(toS - fromS).toFixed(3)} s)`);
  }

  if (playRange) parts.push(`in/out ${formatTime(playRange.fromS)}–${formatTime(playRange.toS)}`);

  return parts.join(" · ");
}
