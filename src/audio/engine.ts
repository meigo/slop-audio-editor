import { projectDurationS, type EqBands, type Project, type TrackFilter } from "../doc/document";
import { getAudioContext } from "./context";
import type { SourcePool } from "./pool";
import { renderPlan, SCHEDULE_LEAD_S, type RenderedGraph } from "./render";
import { peakAmplitude } from "./peak";
import { panGains } from "../lib/geometry";
import { planSchedule } from "./schedule";

/** The app always renders stereo: `AudioContext`'s default destination, and
 *  `OfflineAudioContext(2, …)` for export. The meter splits those same two channels. */
const METER_CHANNELS = 2;

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
   *  analysers are attached HERE, in the caller, rather than inside the graph builder — an
   *  AnalyserNode in an OfflineAudioContext render would measure nothing and mean nothing. */
  #splitter: ChannelSplitterNode | null = null;
  #analysers: AnalyserNode[] = [];
  #meterBufs: Float32Array<ArrayBuffer>[] = [];

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

    this.#graph = renderPlan(
      ctx,
      planSchedule(project, fromS, end, soloed),
      pool,
      project,
      startAt,
      { fromS, toS: end },
    );
    // One analyser PER CHANNEL, fed through a splitter. A single AnalyserNode down-mixes its
    // input to mono before filling the buffer, so a hard-panned mix reads up to 6 dB quieter
    // than it is: full scale in one channel and silence in the other averages to half, and the
    // meter sits comfortably while that channel clips. The splitter's discrete interpretation
    // keeps the channels apart, and `peakAmplitude` takes the max across them.
    //
    // fftSize samples (~43 ms at 48 kHz) is longer than a 60 fps frame, so consecutive reads
    // overlap and no peak can slip between them.
    this.#splitter = ctx.createChannelSplitter(METER_CHANNELS);
    this.#graph.output.connect(this.#splitter);
    for (let c = 0; c < METER_CHANNELS; c++) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      this.#splitter.connect(analyser, c);
      this.#analysers.push(analyser);
      this.#meterBufs.push(new Float32Array(analyser.fftSize));
    }
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
    this.#splitter?.disconnect();
    for (const a of this.#analysers) a.disconnect();
    this.#splitter = null;
    this.#analysers = [];
    this.#meterBufs = [];
    this.#graph = null;
  }

  /** Live mix change — no rescheduling. */
  setTrackGain(trackId: string, gain: number): void {
    const g = this.#graph?.trackGains.get(trackId);
    if (g) g.gain.value = gain;
  }

  /** Live EQ change — no rescheduling, so bands can be swept while listening. Silently does
   *  nothing when the track's EQ was flat at schedule time: no filters were built, so there is
   *  nothing to adjust and the caller's `commit` will rebuild the graph on the next play. */
  setTrackEq(trackId: string, eq: EqBands): void {
    const nodes = this.#graph?.trackEqs.get(trackId);
    if (!nodes) return;
    nodes.low.gain.value = eq.lowDb;
    nodes.mid.gain.value = eq.midDb;
    nodes.high.gain.value = eq.highDb;
  }

  /** Live master-EQ change — no rescheduling, so bands can be swept while listening. Silently
   *  does nothing when the master EQ was flat at schedule time: no filters were built, so there
   *  is nothing to adjust and the caller's `commit` rebuilds the graph on the next play. */
  setMasterEq(eq: EqBands): void {
    const nodes = this.#graph?.masterEq;
    if (!nodes) return;
    nodes.low.gain.value = eq.lowDb;
    nodes.mid.gain.value = eq.midDb;
    nodes.high.gain.value = eq.highDb;
  }

  /** Live filter sweep — no rescheduling, same as the EQ. Silently does nothing when the filter
   *  was OFF at schedule time: no node was built, so there is nothing to adjust and the caller's
   *  `commit` rebuilds the graph on the next play. A biquad's `type` can change in place, so
   *  sweeping across from high-pass to low-pass needs no new node. */
  setTrackFilter(trackId: string, filter: TrackFilter): void {
    const node = this.#graph?.trackFilters.get(trackId);
    if (!node || filter.kind === "off") return;
    node.type = filter.kind;
    node.frequency.value = filter.hz;
  }

  /** Live pan sweep, like the EQ and filter. Does nothing when the track was CENTRED at schedule
   *  time, since no nodes were built then — the caller's `commit` rebuilds the graph on the next
   *  play. */
  setTrackPan(trackId: string, pan: number): void {
    const nodes = this.#graph?.trackPans.get(trackId);
    if (!nodes) return;
    const { left, right } = panGains(pan);
    nodes.left.gain.value = left;
    nodes.right.gain.value = right;
  }

  /** Live master-filter sweep. Same caveat as the rest: does nothing when the filter was OFF at
   *  schedule time, because no node was built then. */
  setMasterFilter(filter: TrackFilter): void {
    const node = this.#graph?.masterFilter;
    if (!node || filter.kind === "off") return;
    node.type = filter.kind;
    node.frequency.value = filter.hz;
  }

  setMasterGain(gain: number): void {
    if (this.#graph) this.#graph.masterGain.gain.value = gain;
  }

  /** Peak amplitude over the last analyser window, as heard: post-master, post-Glue. 0 when
   *  stopped. Values above 1.0 are real overs and are reported as such. */
  peakLevel(): number {
    if (this.#analysers.length === 0) return 0;
    for (let c = 0; c < this.#analysers.length; c++) {
      this.#analysers[c].getFloatTimeDomainData(this.#meterBufs[c]);
    }
    return peakAmplitude(this.#meterBufs);
  }
}
