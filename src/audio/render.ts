import type { Project } from "../doc/document";
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
/** The compressor only ever turns things down, so without a fixed makeup gain, Glue would just be
 *  a volume cut — the makeup is what makes it read as "character" rather than "quieter". */
const GLUE_MAKEUP_DB = 3;
const GLUE_MAKEUP_GAIN = 10 ** (GLUE_MAKEUP_DB / 20);

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
): RenderedGraph {
  const masterGain = ctx.createGain();
  masterGain.gain.value = project.masterGain;

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

    const makeup = ctx.createGain();
    makeup.gain.value = GLUE_MAKEUP_GAIN;

    masterGain.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(makeup);
    makeup.connect(ctx.destination);
    glueNodes.push(highpass, lowpass, compressor, makeup);
  } else {
    masterGain.connect(ctx.destination);
  }

  const trackGains = new Map<string, GainNode>();
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
        trackGain.connect(masterGain);
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
    for (const n of sources) n.disconnect();
    for (const g of glueNodes) g.disconnect();
    throw err;
  }

  for (const { node, when, offset, duration } of toStart) node.start(when, offset, duration);

  return { trackGains, masterGain, sources };
}
