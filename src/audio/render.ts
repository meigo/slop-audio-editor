import {
  EQ_HIGH_HZ,
  FILTER_Q,
  EQ_LOW_HZ,
  EQ_MID_HZ,
  EQ_MID_Q,
  isFlatEq,
  type TrackFilter,
  type Project,
  type EqBands,
} from "../doc/document";
import { planDucking } from "./ducking";
import { saturationCurve } from "./saturation";
import { panGains } from "../lib/geometry";
import { FADE_CURVE_POINTS, fadeInCurve, fadeOutCurve } from "./fades";
import type { Source } from "./pool";
import { masterFadeInSpec, masterFadeSpec, type ScheduledClip } from "./schedule";

/** How far ahead of `ctx.currentTime` a live render is anchored, so every scheduled time and
 *  every fade curve lands in the future. `setValueCurveAtTime` in the past is undefined-ish
 *  territory across engines; a 50 ms lead is inaudible and sidesteps it entirely. */
export const SCHEDULE_LEAD_S = 0.05;

/**
 * The lead used for a LOOP RESTART, where it is a gap rather than a delay.
 *
 * Starting playback is a one-off 50 ms nobody notices. A loop pays it on every cycle, as silence
 * at the seam, which is audible on a musical phrase. The lead exists only to keep scheduled times
 * and fade curves out of the past, and building a restart's graph takes a few milliseconds — so
 * 20 ms keeps the guarantee with roughly a fifth of the audible cost.
 *
 * It is not zero, and this is NOT gapless looping: the restart is still triggered by a timer at
 * the end of the window rather than scheduled before it. Truly seamless needs the next cycle
 * pre-scheduled against the current one's end time, with two live graphs — a different piece of
 * work, deliberately not done here.
 */
export const LOOP_LEAD_S = 0.02;

/** "Glue": a gentle master-bus band-limit + compression to make disparate sources cohere. Master
 *  level, not per-clip — it never appears in `planSchedule`. */
const GLUE_HIGHPASS_HZ = 100;
const GLUE_LOWPASS_HZ = 7500;
const GLUE_COMPRESSOR_THRESHOLD_DB = -18;
const GLUE_COMPRESSOR_KNEE_DB = 6;
const GLUE_COMPRESSOR_RATIO = 3;
const GLUE_COMPRESSOR_ATTACK_S = 0.02;
const GLUE_COMPRESSOR_RELEASE_S = 0.25;
/** The Web Audio compressor is NOT a pure attenuator: the spec gives it an internal makeup gain
 *  derived from threshold/knee/ratio, so with these settings it adds a flat +6.1 dB below the
 *  threshold, tapering to attenuation as the input gets loud (measured: +6.13 dB at -20 dBFS peak,
 *  +4.01 at -12, +0.12 at -6, -3.12 at -1). That is exactly the levelling Glue wants — quiet
 *  material up, loud material down — but it means an ADDED makeup would double the boost. This
 *  trim cancels the below-threshold portion, so switching Glue on is level-neutral for quiet
 *  material and progressively tames louder material, rather than acting as a volume control.
 *
 *  Measured for THESE compressor settings. If threshold, knee or ratio change, re-measure it. */
const GLUE_TRIM_DB = -6;
const GLUE_TRIM_GAIN = 10 ** (GLUE_TRIM_DB / 20);

/** `setValueCurveAtTime` sets ABSOLUTE values, so a fade on a clip with non-unity gain has to be
 *  scaled — otherwise the fade would ramp to 1.0 and undo the clip's gain. */
export function scaleCurve(curve: Float32Array, gain: number): Float32Array {
  if (gain === 1) return curve;
  const out = new Float32Array(curve.length);
  for (let i = 0; i < curve.length; i++) out[i] = curve[i] * gain;
  return out;
}

/** The three biquads of one track's EQ, retained so the bands can be adjusted during playback
 *  without rescheduling — the same reason `trackGains` is retained. */
export interface EqNodes {
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
}

export interface RenderedGraph {
  trackGains: Map<string, GainNode>;
  /** Only tracks whose EQ is NOT flat appear here. */
  trackEqs: Map<string, EqNodes>;
  /** Only tracks whose filter is NOT off appear here — the rest built no node to adjust. */
  trackFilters: Map<string, BiquadFilterNode>;
  /** Null when the master filter is off — in that case no biquad was built. */
  masterFilter: BiquadFilterNode | null;
  /** Null when saturation is off. */
  saturator: WaveShaperNode | null;
  /** Null when the project has no mix fade at that end, or the window does not reach it. */
  masterFadeIn: GainNode | null;
  masterFadeOut: GainNode | null;
  /** Only tracks that are actually panned. The pair is [left, right] channel gains. */
  trackPans: Map<string, { left: GainNode; right: GainNode }>;
  masterGain: GainNode;
  /** Null when the master EQ is flat — in that case no biquads were built at all. */
  masterEq: EqNodes | null;
  sources: AudioBufferSourceNode[];
  /** Last node before the destination: `masterGain` when nothing else is on, otherwise whichever
   *  of the master EQ, filter, Glue's trim, the saturator or the mix-fade gains ends the chain.
   *  Metering taps THIS, not `masterGain` — everything after the fader changes the level, so a
   *  meter on `masterGain` would show a number the listener never hears — and `stop()` disconnects
   *  THIS, since it is the node actually wired to the destination. */
  output: AudioNode;
}

/**
 * Build the node graph for a plan against ANY BaseAudioContext.
 *
 * Live playback passes an `AudioContext` and `startAt = ctx.currentTime + SCHEDULE_LEAD_S`;
 * the mixdown passes an `OfflineAudioContext` and `startAt = 0`. Same function, same plan — that
 * is what makes preview and export incapable of drifting apart.
 *
 * Track and master gains are REAL nodes rather than folded into each clip's gain, so the faders
 * can be ridden during playback without rescheduling anything.
 */
/**
 * Builds the whole graph and only THEN starts any node (in a second pass below). If building the
 * graph throws partway — e.g. a fade curve `setValueCurveAtTime` rejects — no node has been
 * started yet, so there is nothing left connected to the destination playing with no reference to
 * stop it. The catch below disconnects whatever was built so far and rethrows, rather than
 * leaving a half-built graph dangling off `ctx.destination`.
 */
export function renderPlan(
  ctx: BaseAudioContext,
  plan: readonly ScheduledClip[],
  pool: { get(id: string): Source | undefined },
  project: Project,
  startAt: number,
  window: { fromS: number; toS: number },
): RenderedGraph {
  // Computed here rather than passed in, so no caller can build a graph WITHOUT ducking and
  // silently produce a mix that differs from every other path. Ducking changes the mix, so unlike
  // the analyser tap it belongs on the shared preview/export path, not in the caller.
  const duck = planDucking(project, window.fromS, window.toS);
  const masterGain = ctx.createGain();
  masterGain.gain.value = project.masterGain;

  const trackGains = new Map<string, GainNode>();
  const trackEqs = new Map<string, EqNodes>();
  const trackFilters = new Map<string, BiquadFilterNode>();
  const trackPans = new Map<string, { left: GainNode; right: GainNode }>();
  const panNodes: AudioNode[] = [];
  const eqNodes: BiquadFilterNode[] = [];
  const duckGains: GainNode[] = [];

  /** Build an EQ chain and return its tail, or the input untouched when the EQ is flat.
   *  A flat EQ builds NOTHING: three biquads at 0 dB are not quite transparent (each still runs
   *  its difference equation, and shelves at 0 dB are only nominally unity), and more to the
   *  point, a project that never touches EQ should render exactly the graph it always did. The
   *  same builder serves tracks and the master bus — the bands are identical, so a second copy
   *  would be a second place for that guarantee to be broken. */
  function buildEq(input: AudioNode, eq: EqBands): { tail: AudioNode; nodes: EqNodes | null } {
    if (isFlatEq(eq)) return { tail: input, nodes: null };
    const band = (type: BiquadFilterType, hz: number, db: number, q?: number): BiquadFilterNode => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = hz;
      n.gain.value = db;
      if (q !== undefined) n.Q.value = q;
      eqNodes.push(n);
      return n;
    };
    const low = band("lowshelf", EQ_LOW_HZ, eq.lowDb);
    const mid = band("peaking", EQ_MID_HZ, eq.midDb, EQ_MID_Q);
    const high = band("highshelf", EQ_HIGH_HZ, eq.highDb);
    input.connect(low);
    low.connect(mid);
    mid.connect(high);
    return { tail: high, nodes: { low, mid, high } };
  }

  /** One biquad, or the input untouched when the filter is off — the same rule the EQ follows,
   *  and for the same reason: a "neutral" biquad is not bit-transparent, and a project that never
   *  touches the filter must render exactly the graph it always did.
   *
   *  Cascaded linear filters commute, so where this sits relative to the EQ makes no difference
   *  to the result; it goes after for no deeper reason than reading order. */
  function buildFilter(
    input: AudioNode,
    filter: TrackFilter,
  ): { tail: AudioNode; node: BiquadFilterNode | null } {
    if (filter.kind === "off") return { tail: input, node: null };
    const n = ctx.createBiquadFilter();
    n.type = filter.kind;
    n.frequency.value = filter.hz;
    n.Q.value = FILTER_Q;
    eqNodes.push(n);
    input.connect(n);
    return { tail: n, node: n };
  }

  /**
   * Equal-power pan, as an explicit per-channel balance rather than a `StereoPannerNode`.
   *
   * MEASURED, because the obvious choice is wrong here. `StereoPannerNode` applies two different
   * laws: a mono input gets textbook equal power, but a STEREO input gets the spec's folding
   * algorithm, which mixes the far channel into the near one. A track carrying both a mono clip
   * and a stereo clip sums to two channels at its gain node, and panning that hard left measured
   * +12.04 dB — instant clipping. The same case through this network measures +6.02 dB, which is
   * just the two sources summing, and a mono-only track measures identically to the node's own
   * mono law (-3.01 dB centre, 0.00 hard left).
   *
   * The `widen` gain is not optional: a `ChannelSplitter` up-mixes DISCRETELY, so feeding it a
   * mono signal leaves the right channel silent. Forcing two channels with `speakers`
   * interpretation duplicates it first, which is what the rest of the graph does anyway.
   */
  function withPan(input: AudioNode, trackId: string, pan: number): AudioNode {
    if (pan === 0) return input;
    const { left, right } = panGains(pan);
    const widen = ctx.createGain();
    widen.channelCount = 2;
    widen.channelCountMode = "explicit";
    widen.channelInterpretation = "speakers";
    const splitter = ctx.createChannelSplitter(2);
    const gainL = ctx.createGain();
    const gainR = ctx.createGain();
    const merger = ctx.createChannelMerger(2);
    gainL.gain.value = left;
    gainR.gain.value = right;
    input.connect(widen);
    widen.connect(splitter);
    splitter.connect(gainL, 0);
    splitter.connect(gainR, 1);
    gainL.connect(merger, 0, 0);
    gainR.connect(merger, 0, 1);
    trackPans.set(trackId, { left: gainL, right: gainR });
    panNodes.push(widen, splitter, gainL, gainR, merger);
    return merger;
  }

  // Master EQ sits between the fader and Glue, so Glue's compressor reacts to the shaped signal
  // rather than fighting it — the usual order for a mastering chain.
  const master = buildEq(masterGain, project.masterEq);
  const masterFilter = buildFilter(master.tail, project.masterFilter);
  let output: AudioNode = masterFilter.tail;

  // When Glue is off, this is the ENTIRE master chain — bit-identical to the graph before Glue
  // existed. The nodes below are only ever created when `project.glue` is true.
  const glueNodes: AudioNode[] = [];
  if (project.glue) {
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = GLUE_HIGHPASS_HZ;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = GLUE_LOWPASS_HZ;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = GLUE_COMPRESSOR_THRESHOLD_DB;
    compressor.knee.value = GLUE_COMPRESSOR_KNEE_DB;
    compressor.ratio.value = GLUE_COMPRESSOR_RATIO;
    compressor.attack.value = GLUE_COMPRESSOR_ATTACK_S;
    compressor.release.value = GLUE_COMPRESSOR_RELEASE_S;

    const trim = ctx.createGain();
    trim.gain.value = GLUE_TRIM_GAIN;

    masterFilter.tail.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(trim);
    glueNodes.push(highpass, lowpass, compressor, trim);
    output = trim;
  }

  /** Saturation is LAST, after Glue: tape goes after the bus compressor, and it is the final
   *  colour rather than something the compressor then reacts to.
   *
   *  `oversample: "4x"` because a waveshaper aliases — it generates harmonics above Nyquist that
   *  fold back as inharmonic tones. Low fidelity is fine as a character; aliasing is not a
   *  character, it is a defect, and one master-bus node can afford the oversampling.
   *
   *  The metering tap follows `output`, so it reads AFTER this — the same reason it moved past
   *  Glue's trim. */
  const curve = saturationCurve(project.saturation);
  let saturator: WaveShaperNode | null = null;
  if (curve) {
    saturator = ctx.createWaveShaper();
    saturator.curve = curve;
    saturator.oversample = "4x";
    output.connect(saturator);
    output = saturator;
  }
  /** Each mix fade rides its OWN gain node, and never `masterGain`: an automation curve written
   *  onto the fader would fight `setMasterGain`, so riding the master during a scheduled fade
   *  would cancel one or the other — the same reason ducking has a node of its own.
   *
   *  A node PER FADE rather than two curves on one param, because `setValueCurveAtTime` throws on
   *  overlapping curves, and a project shorter than its two fades combined would overlap them. As
   *  separate gains they simply multiply, which dips the middle — predictable, and the honest
   *  answer to asking for more fade than there is material.
   *
   *  They sit LAST, after Glue and saturation, so they fade those too, and the final one becomes
   *  the graph's `output` — the meter shows the mix fading rather than the level before it. */
  const fadeIn = masterFadeInSpec(project, window);
  const fadeOut = masterFadeSpec(project, window);
  let masterFadeIn: GainNode | null = null;
  let masterFadeOut: GainNode | null = null;
  if (fadeIn) {
    masterFadeIn = ctx.createGain();
    masterFadeIn.gain.setValueCurveAtTime(
      fadeInCurve(fadeIn.shape, FADE_CURVE_POINTS, fadeIn.fromT, fadeIn.toT),
      startAt + fadeIn.atS,
      fadeIn.durS,
    );
    output.connect(masterFadeIn);
    output = masterFadeIn;
  }
  if (fadeOut) {
    masterFadeOut = ctx.createGain();
    masterFadeOut.gain.setValueCurveAtTime(
      fadeOutCurve(fadeOut.shape, FADE_CURVE_POINTS, fadeOut.fromT, fadeOut.toT),
      startAt + fadeOut.atS,
      fadeOut.durS,
    );
    output.connect(masterFadeOut);
    output = masterFadeOut;
  }

  output.connect(ctx.destination);

  const sources: AudioBufferSourceNode[] = [];
  const toStart: { node: AudioBufferSourceNode; when: number; offset: number; duration: number }[] =
    [];

  try {
    for (const sc of plan) {
      const source = pool.get(sc.sourceId);
      if (!source) continue; // a clip whose media never loaded is silent, not a crash

      let trackGain = trackGains.get(sc.trackId);
      if (!trackGain) {
        trackGain = ctx.createGain();
        const track = project.tracks.find((t) => t.id === sc.trackId);
        trackGain.gain.value = track?.gain ?? 1;
        // EQ sits AFTER the fader: the fader is only a level, so filtering before or after it is
        // equivalent, and this way one chain per track covers every clip on it.
        const trackEq = buildEq(trackGain, track?.eq ?? { lowDb: 0, midDb: 0, highDb: 0 });
        if (trackEq.nodes) trackEqs.set(sc.trackId, trackEq.nodes);
        const trackFilter = buildFilter(trackEq.tail, track?.filter ?? { kind: "off", hz: 0 });
        if (trackFilter.node) trackFilters.set(sc.trackId, trackFilter.node);
        const tail = withPan(trackFilter.tail, sc.trackId, track?.pan ?? 0);
        const points = duck.get(sc.trackId);
        if (points && points.length > 0) {
          // A SEPARATE node from the fader's. Writing the envelope onto `trackGain` itself would
          // fight `setTrackGain`, so riding the fader mid-playback (the "mix" gesture) would
          // cancel the ducking or be cancelled by it.
          const duckGain = ctx.createGain();
          duckGain.gain.setValueAtTime(points[0].gain, startAt + points[0].t);
          for (let i = 1; i < points.length; i++) {
            duckGain.gain.linearRampToValueAtTime(points[i].gain, startAt + points[i].t);
          }
          tail.connect(duckGain);
          duckGain.connect(masterGain);
          duckGains.push(duckGain);
        } else {
          tail.connect(masterGain);
        }
        trackGains.set(sc.trackId, trackGain);
      }

      const clipGain = ctx.createGain();
      clipGain.gain.value = sc.gain;
      clipGain.connect(trackGain);

      if (sc.fadeIn) {
        const c = scaleCurve(
          fadeInCurve(sc.fadeIn.shape, FADE_CURVE_POINTS, sc.fadeIn.fromT, sc.fadeIn.toT),
          sc.gain,
        );
        clipGain.gain.setValueCurveAtTime(c, startAt + sc.fadeIn.atS, sc.fadeIn.durS);
      }
      if (sc.fadeOut) {
        const c = scaleCurve(
          fadeOutCurve(sc.fadeOut.shape, FADE_CURVE_POINTS, sc.fadeOut.fromT, sc.fadeOut.toT),
          sc.gain,
        );
        clipGain.gain.setValueCurveAtTime(c, startAt + sc.fadeOut.atS, sc.fadeOut.durS);
      }

      const node = ctx.createBufferSource();
      node.buffer = source.buffer;
      node.connect(clipGain);
      // `sc.duration` is in the BUFFER's timebase (measured: `start`'s duration argument is not
      // wall time), so the rate is what turns it back into the right span of wall clock. Set
      // before `start`, which the second pass below calls.
      node.playbackRate.value = sc.speed;
      sources.push(node);
      toStart.push({
        node,
        when: startAt + sc.when,
        offset: sc.sourceOffset,
        duration: sc.duration,
      });
    }
  } catch (err) {
    masterGain.disconnect();
    for (const g of trackGains.values()) g.disconnect();
    for (const g of duckGains) g.disconnect();
    for (const n of eqNodes) n.disconnect();
    for (const n of panNodes) n.disconnect();
    for (const n of sources) n.disconnect();
    for (const g of glueNodes) g.disconnect();
    saturator?.disconnect();
    masterFadeIn?.disconnect();
    masterFadeOut?.disconnect();
    throw err;
  }

  for (const { node, when, offset, duration } of toStart) node.start(when, offset, duration);

  return {
    trackGains,
    trackEqs,
    trackFilters,
    trackPans,
    masterEq: master.nodes,
    masterFilter: masterFilter.node,
    saturator,
    masterFadeIn,
    masterFadeOut,
    masterGain,
    sources,
    output,
  };
}
