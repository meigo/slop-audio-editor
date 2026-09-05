import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../doc/document";
import type { Source, SourcePool } from "./pool";

/** Minimal fakes for the slice of the Web Audio API `AudioEngine`/`renderPlan` touch. Real
 *  `AudioContext` is unavailable under Vitest's default (non-browser) environment, and
 *  `currentTime` needs to be directly controllable to test the schedule lead-in. */
class FakeNode {
  connect(_dest?: unknown, _output?: number): FakeNode {
    return this;
  }
  disconnect(): void {}
}
class FakeGainNode extends FakeNode {
  gain = { value: 1, setValueCurveAtTime: (): void => {} };
}
/** The meter tap. This fake models the one Web Audio behaviour the meter depends on: an analyser
 *  fed a stereo node directly sees the DOWN-MIX (the channels averaged), while one fed from a
 *  splitter output sees that channel alone. `fakeCtx.channelSignal` is the signal on the graph's
 *  terminal node — without this distinction a test could not tell a per-channel meter from a
 *  down-mixing one, which is exactly the bug. */
class FakeAnalyserNode extends FakeNode {
  fftSize = 2048;
  /** Splitter output this analyser is fed from; null when fed the full stereo node. */
  channel: number | null = null;
  constructor(private readonly ctx: FakeAudioContext) {
    super();
  }
  getFloatTimeDomainData(out: Float32Array): void {
    const sig = this.ctx.channelSignal;
    out.fill(
      this.channel === null
        ? sig.reduce((a, b) => a + b, 0) / sig.length
        : (sig[this.channel] ?? 0),
    );
  }
}
class FakeChannelSplitterNode extends FakeNode {
  connect(dest?: unknown, output = 0): FakeNode {
    if (dest instanceof FakeAnalyserNode) dest.channel = output;
    return this;
  }
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
  /** Per-channel signal on the graph's terminal node, as amplitude. */
  channelSignal: number[] = [0, 0];
  createAnalyser(): FakeAnalyserNode {
    return new FakeAnalyserNode(this);
  }
  createChannelSplitter(): FakeChannelSplitterNode {
    return new FakeChannelSplitterNode();
  }
}

let fakeCtx: FakeAudioContext;

vi.mock("./context", () => ({
  getAudioContext: (): AudioContext => fakeCtx as unknown as AudioContext,
}));

// Imported after the mock is declared — vi.mock is hoisted above imports by Vitest, so this is
// equivalent to importing before, but keeping it below reads clearer next to the mock it depends on.
const { AudioEngine } = await import("./engine");
const { SCHEDULE_LEAD_S } = await import("./render");

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

describe("AudioEngine.positionS", () => {
  it("does not read before startOffsetS during the schedule lead-in", () => {
    const engine = new AudioEngine();
    fakeCtx.currentTime = 0;
    engine.play(createProject(), emptyPool(), 3, 10, new Set());
    // ctx.currentTime has not advanced past the lead-in yet (#startCtxTime is SCHEDULE_LEAD_S
    // ahead of it) — without the clamp this reads 3 - SCHEDULE_LEAD_S.
    expect(engine.positionS()).toBe(3);
    expect(SCHEDULE_LEAD_S).toBeGreaterThan(0); // sanity: the lead-in this test relies on exists
  });

  it("stop() does not nudge the playhead backwards during the lead-in", () => {
    const engine = new AudioEngine();
    fakeCtx.currentTime = 0;
    engine.play(createProject(), emptyPool(), 3, 10, new Set());
    engine.stop();
    expect(engine.positionS()).toBe(3);
  });

  it("advances normally once real playback time has passed", () => {
    const engine = new AudioEngine();
    fakeCtx.currentTime = 0;
    engine.play(createProject(), emptyPool(), 3, 10, new Set());
    fakeCtx.currentTime = SCHEDULE_LEAD_S + 2; // 2s of real playback since the lead-in ended
    expect(engine.positionS()).toBe(5);
  });
});

describe("AudioEngine.peakLevel", () => {
  it("is 0 while stopped, so a stale meter cannot linger after the transport stops", () => {
    expect(new AudioEngine().peakLevel()).toBe(0);
  });

  it("reports the level on the graph's terminal node while playing", () => {
    const engine = new AudioEngine();
    engine.play(createProject(), emptyPool(), 0, 10, new Set());
    fakeCtx.channelSignal = [-0.75, -0.75]; // magnitude, so a trough must register
    expect(engine.peakLevel()).toBeCloseTo(0.75, 6);
    engine.stop();
  });

  it("measures each channel separately, so a hard-panned mix is not read as half its level", () => {
    const engine = new AudioEngine();
    engine.play(createProject(), emptyPool(), 0, 10, new Set());
    // Full scale in one channel, silence in the other — a single analyser down-mixes this to
    // 0.45 and shows a comfortable mix while that channel is on the edge of clipping.
    fakeCtx.channelSignal = [0.9, 0];
    expect(engine.peakLevel()).toBeCloseTo(0.9, 6);
    engine.stop();
  });

  it("returns to 0 once stopped, releasing the analysers", () => {
    const engine = new AudioEngine();
    engine.play(createProject(), emptyPool(), 0, 10, new Set());
    fakeCtx.channelSignal = [0.9, 0.9];
    expect(engine.peakLevel()).toBeCloseTo(0.9, 6);
    engine.stop();
    expect(engine.peakLevel()).toBe(0);
  });

  it("reports an over above 1.0 rather than clamping to full scale", () => {
    const engine = new AudioEngine();
    engine.play(createProject(), emptyPool(), 0, 10, new Set());
    fakeCtx.channelSignal = [1.4, 1.4];
    expect(engine.peakLevel()).toBeCloseTo(1.4, 6);
    engine.stop();
  });
});
