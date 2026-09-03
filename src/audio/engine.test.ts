import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../doc/document";
import type { Source, SourcePool } from "./pool";

/** Minimal fakes for the slice of the Web Audio API `AudioEngine`/`renderPlan` touch. Real
 *  `AudioContext` is unavailable under Vitest's default (non-browser) environment, and
 *  `currentTime` needs to be directly controllable to test the schedule lead-in. */
class FakeNode {
  connect(): FakeNode {
    return this;
  }
  disconnect(): void {}
}
class FakeGainNode extends FakeNode {
  gain = { value: 1, setValueCurveAtTime: (): void => {} };
}
class FakeBufferSourceNode extends FakeNode {
  buffer: unknown = null;
  start(): void {}
  stop(): void {}
}
class FakeAudioContext {
  currentTime = 0;
  destination = new FakeNode();
  resume = vi.fn(async (): Promise<void> => {});
  createGain(): FakeGainNode {
    return new FakeGainNode();
  }
  createBufferSource(): FakeBufferSourceNode {
    return new FakeBufferSourceNode();
  }
}

let fakeCtx: FakeAudioContext;

vi.mock("./context", () => ({
  getAudioContext: (): AudioContext => fakeCtx as unknown as AudioContext,
}));

// Imported after the mock is declared — vi.mock is hoisted above imports by Vitest, so this is
// equivalent to importing before, but keeping it below reads clearer next to the mock it depends on.
const { AudioEngine } = await import("./engine");

function emptyPool(): SourcePool {
  return { get: (): Source | undefined => undefined } as unknown as SourcePool;
}

beforeEach(() => {
  fakeCtx = new FakeAudioContext();
});

describe("AudioEngine.play with an empty window", () => {
  it("still notifies onEnded, so the transport does not get stuck showing 'playing'", async () => {
    const engine = new AudioEngine();
    let ended = false;
    engine.onEnded = () => {
      ended = true;
    };
    engine.play(createProject(), emptyPool(), 5, 5, new Set()); // toS === fromS: empty window
    // Must not fire SYNCHRONOUSLY — the caller (appState's togglePlay) sets state.playing = true
    // right after calling play(), and a synchronous onEnded would be overwritten by it.
    expect(ended).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(ended).toBe(true);
  });

  it("does not leave a graph or a pending timer behind", async () => {
    const engine = new AudioEngine();
    engine.play(createProject(), emptyPool(), 5, 5, new Set());
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.playing).toBe(false);
  });
});
