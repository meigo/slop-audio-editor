import type { Project } from "../doc/document";
import { planDucking } from "./ducking";
import { FADE_CURVE_POINTS, fadeInCurve, fadeOutCurve } from "./fades";
import type { Source } from "./pool";
import type { ScheduledClip } from "./schedule";

/** How far ahead of `ctx.currentTime` a live render is anchored, so every scheduled time and
 *  every fade curve lands in the future. `setValueCurveAtTime` in the past is undefined-ish
 *  territory across engines; a 50 ms lead is inaudible and sidesteps it entirely. */
export const SCHEDULE_LEAD_S = 0.05;

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

export interface RenderedGraph {
  trackGains: Map<string, GainNode>;
  masterGain: GainNode;
  sources: AudioBufferSourceNode[];
  /** Last node before the destination — `masterGain`, or Glue's trim when Glue is on. Metering
   *  taps THIS, not `masterGain`: Glue's compressor and trim change the level, so a meter on
   *  `masterGain` would show a number the listener never hears. */
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
  let output: AudioNode = masterGain;

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

    masterGain.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(trim);
    trim.connect(ctx.destination);
    glueNodes.push(highpass, lowpass, compressor, trim);
    output = trim;
  } else {
    masterGain.connect(ctx.destination);
  }

  const trackGains = new Map<string, GainNode>();
  const duckGains: GainNode[] = [];
  const sources: AudioBufferSourceNode[] = [];
  const toStart: { node: AudioBufferSourceNode; when: number; offset: number; duration: number }[] = [];

  try {
    for (const sc of plan) {
      const source = pool.get(sc.sourceId);
      if (!source) continue; // a clip whose media never loaded is silent, not a crash

      let trackGain = trackGains.get(sc.trackId);
      if (!trackGain) {
        trackGain = ctx.createGain();
        trackGain.gain.value = project.tracks.find((t) => t.id === sc.trackId)?.gain ?? 1;
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
          trackGain.connect(duckGain);
          duckGain.connect(masterGain);
          duckGains.push(duckGain);
        } else {
          trackGain.connect(masterGain);
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
      sources.push(node);
      toStart.push({ node, when: startAt + sc.when, offset: sc.sourceOffset, duration: sc.duration });
    }
  } catch (err) {
    masterGain.disconnect();
    for (const g of trackGains.values()) g.disconnect();
    for (const g of duckGains) g.disconnect();
    for (const n of sources) n.disconnect();
    for (const g of glueNodes) g.disconnect();
    throw err;
  }

  for (const { node, when, offset, duration } of toStart) node.start(when, offset, duration);

  return { trackGains, masterGain, sources, output };
}
