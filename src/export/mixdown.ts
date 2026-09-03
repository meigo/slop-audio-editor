import { PROJECT_SAMPLE_RATE, type Project } from "../doc/document";
import type { SourcePool } from "../audio/pool";
import { renderPlan } from "../audio/render";
import { planSchedule } from "../audio/schedule";

/** Solo is monitoring, never a document field, and MUST NOT reach an export. Passing this frozen
 *  empty set is the enforcement, not a convention a caller has to remember. */
const NO_SOLO: ReadonlySet<string> = new Set();

/**
 * Render `[fromS, toS)` to one stereo 48 kHz buffer.
 *
 * The plan and the graph builder are the SAME ones live playback uses — only the context differs.
 * That is what makes the exported file match what you heard.
 */
export async function mixdown(
  project: Project,
  pool: SourcePool,
  fromS: number,
  toS: number,
): Promise<AudioBuffer> {
  const lengthS = Math.max(0, toS - fromS);
  const ctx = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(lengthS * PROJECT_SAMPLE_RATE)),
    PROJECT_SAMPLE_RATE,
  );
  renderPlan(ctx, planSchedule(project, fromS, toS, NO_SOLO), pool, project, 0);
  return ctx.startRendering();
}
