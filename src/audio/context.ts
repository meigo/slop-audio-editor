import { PROJECT_SAMPLE_RATE } from "../doc/document";

let ctx: AudioContext | null = null;

/** One shared 48 kHz AudioContext, constructed lazily on first use (i.e. from a user gesture).
 *  Fixing the rate here is what makes `decodeAudioData` resample every import on the way in, so
 *  the engine and the mixdown never resample and never drift. */
export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ sampleRate: PROJECT_SAMPLE_RATE });
  return ctx;
}
