/** Test-only assertions shared across the doc/edits test suites. */
import { expect } from "vitest";
import { clipEndS, type Project } from "./document";

/** Fails the test if any track in `p` has two clips that overlap in time. A clip ending exactly
 *  where the next one starts is NOT an overlap. */
export function expectNoOverlaps(p: Project): void {
  for (const t of p.tracks) {
    const sorted = [...t.clips].sort((a, b) => a.startS - b.startS);
    for (let i = 1; i < sorted.length; i++) {
      expect(
        sorted[i].startS,
        `track "${t.name}": clip ${sorted[i].id} at ${sorted[i].startS} overlaps ` +
          `clip ${sorted[i - 1].id} ending at ${clipEndS(sorted[i - 1])}`,
      ).toBeGreaterThanOrEqual(clipEndS(sorted[i - 1]));
    }
  }
}
