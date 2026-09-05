import { projectDurationS, type Project } from "../doc/document";
import type { PlayRange } from "../doc/play-range";
import type { Selection } from "../doc/selection";
import { formatTime } from "./geometry";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The status line's resting text: what the project IS, when nothing is being hovered.
 *
 *  Both ranges are LABELLED — `export` for the selection, `in/out` for the markers — because they
 *  are different things that look alike: the selection drives export, the in/out markers only
 *  bound playback and never reach a file. Collapsing them into one "range", or leaving either as
 *  a bare pair of timecodes, would suggest the export follows whichever the user last touched. */
export function statusSummary(
  project: Project,
  selection: Selection,
  playRange: PlayRange | null,
): string {
  const parts = [plural(project.tracks.length, "track"), formatTime(projectDurationS(project))];

  if (selection.kind === "clips" && selection.clipIds.length > 0) {
    parts.push(`${plural(selection.clipIds.length, "clip")} selected`);
  } else if (selection.kind === "range") {
    // Named, not just measured. A range is painted by dragging on a lane — easy to do by
    // accident — and it is the only state that silently changes what an export CONTAINS
    // (`exportWindow`). Without the word the line reported two bare timecodes and left the user
    // to guess which of them bounded a file.
    const { fromS, toS } = selection.range;
    parts.push(`export ${formatTime(fromS)}–${formatTime(toS)} (${(toS - fromS).toFixed(3)} s)`);
  }

  if (playRange) parts.push(`in/out ${formatTime(playRange.fromS)}–${formatTime(playRange.toS)}`);

  return parts.join(" · ");
}
