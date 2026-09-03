import { projectDurationS, type Project } from "../doc/document";
import { getAudioContext } from "./context";
import type { SourcePool } from "./pool";
import { renderPlan, SCHEDULE_LEAD_S, type RenderedGraph } from "./render";
import { planSchedule } from "./schedule";

/**
 * Transport. Schedules the ENTIRE remaining project up front — sample-accurate by construction,
 * no timer, no drift. Structural edits stop and restart from the current position; mix changes
 * (gain, master) are applied live on the retained nodes, so a fader can be ridden while playing.
 */
export class AudioEngine {
  #graph: RenderedGraph | null = null;
  #startCtxTime = 0;
  #startOffsetS = 0;
  #endS = 0;
  #stopTimer: ReturnType<typeof setTimeout> | null = null;

  /** Fired when playback runs off the end of the scheduled window. */
  onEnded: (() => void) | null = null;

  get playing(): boolean {
    return this.#graph !== null;
  }

  /** Where the playhead is now, in project seconds. Derived from the clock, never counted. */
  positionS(): number {
    if (!this.#graph) return this.#startOffsetS;
    const ctx = getAudioContext();
    return Math.min(this.#endS, this.#startOffsetS + (ctx.currentTime - this.#startCtxTime));
  }

  play(
    project: Project,
    pool: SourcePool,
    fromS: number,
    toS: number,
    soloed: ReadonlySet<string>,
  ): void {
    this.stop();
    const end = toS > 0 ? toS : projectDurationS(project);
    if (!(end > fromS)) return;

    const ctx = getAudioContext();
    void ctx.resume();
    const startAt = ctx.currentTime + SCHEDULE_LEAD_S;

    this.#graph = renderPlan(ctx, planSchedule(project, fromS, end, soloed), pool, project, startAt);
    this.#startCtxTime = startAt;
    this.#startOffsetS = fromS;
    this.#endS = end;

    // The plan may be entirely silent (no clips in the window), so the end is driven by the
    // window length rather than by any node's `ended` event.
    this.#stopTimer = setTimeout(
      () => {
        this.stop();
        this.onEnded?.();
      },
      (SCHEDULE_LEAD_S + (end - fromS)) * 1000,
    );
  }

  stop(): void {
    if (this.#stopTimer !== null) {
      clearTimeout(this.#stopTimer);
      this.#stopTimer = null;
    }
    if (!this.#graph) return;
    this.#startOffsetS = this.positionS();
    for (const s of this.#graph.sources) {
      try {
        s.stop();
      } catch {
        // Already ended — stopping twice is not an error worth surfacing.
      }
      s.disconnect();
    }
    this.#graph.masterGain.disconnect();
    this.#graph = null;
  }

  /** Live mix change — no rescheduling. */
  setTrackGain(trackId: string, gain: number): void {
    const g = this.#graph?.trackGains.get(trackId);
    if (g) g.gain.value = gain;
  }

  setMasterGain(gain: number): void {
    if (this.#graph) this.#graph.masterGain.gain.value = gain;
  }
}
