import { projectDurationS, type Project } from "../doc/document";
import { getAudioContext } from "./context";
import type { SourcePool } from "./pool";
import { renderPlan, SCHEDULE_LEAD_S, type RenderedGraph } from "./render";
import { peakAmplitude } from "./peak";
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
  /** Metering tap on the graph's terminal node. Playback-only by design: `planSchedule` and
   *  `renderPlan` stay identical for preview and export (see the shared-planner rule), so the
   *  analyser is attached HERE, in the caller, rather than inside the graph builder — an
   *  AnalyserNode in an OfflineAudioContext render would measure nothing and mean nothing. */
  #analyser: AnalyserNode | null = null;
  #meterBuf: Float32Array<ArrayBuffer> | null = null;

  /** Fired when playback runs off the end of the scheduled window. */
  onEnded: (() => void) | null = null;

  get playing(): boolean {
    return this.#graph !== null;
  }

  /** Where the playhead is now, in project seconds. Derived from the clock, never counted.
   *
   *  Clamped to never read BEFORE `#startOffsetS`: `#startCtxTime` is `SCHEDULE_LEAD_S` ahead of
   *  `ctx.currentTime` at the moment `play` is called, so during that lead-in `elapsed` is
   *  negative. Without the clamp, `stop()` — called right after `play()` on a quick play-then-stop
   *  — would write that negative position back into `#startOffsetS`, nudging the playhead
   *  backwards from where the user asked it to start. */
  positionS(): number {
    if (!this.#graph) return this.#startOffsetS;
    const ctx = getAudioContext();
    const elapsed = Math.max(0, ctx.currentTime - this.#startCtxTime);
    return Math.min(this.#endS, this.#startOffsetS + elapsed);
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
    if (!(end > fromS)) {
      // An empty window still "runs" for zero time. Notify completion the same way the timer
      // below does — asynchronously, so it lands after the caller's own `state.playing = true`
      // rather than racing it — or the caller is left believing playback is running forever:
      // Pause icon shown, playhead frozen, no audio.
      this.#startOffsetS = fromS;
      this.#endS = fromS;
      this.#stopTimer = setTimeout(() => {
        this.stop();
        this.onEnded?.();
      }, 0);
      return;
    }

    const ctx = getAudioContext();
    void ctx.resume();
    const startAt = ctx.currentTime + SCHEDULE_LEAD_S;

    this.#graph = renderPlan(ctx, planSchedule(project, fromS, end, soloed), pool, project, startAt,
      { fromS, toS: end });
    // fftSize samples (~43 ms at 48 kHz) is longer than a 60 fps frame, so consecutive reads
    // overlap and no peak can slip between them.
    this.#analyser = ctx.createAnalyser();
    this.#analyser.fftSize = 2048;
    this.#meterBuf = new Float32Array(this.#analyser.fftSize);
    this.#graph.output.connect(this.#analyser);
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
    this.#analyser?.disconnect();
    this.#analyser = null;
    this.#meterBuf = null;
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

  /** Peak amplitude over the last analyser window, as heard: post-master, post-Glue. 0 when
   *  stopped. Values above 1.0 are real overs and are reported as such. */
  peakLevel(): number {
    if (!this.#analyser || !this.#meterBuf) return 0;
    this.#analyser.getFloatTimeDomainData(this.#meterBuf);
    return peakAmplitude([this.#meterBuf]);
  }
}
