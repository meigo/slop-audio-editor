import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, FILTER_OFF, type Project } from "../doc/document";
import { FILTER_HP_MIN_HZ } from "../lib/geometry";
import type { Source, SourcePool } from "./pool";

/** Minimal fakes for the slice of the Web Audio API `AudioEngine`/`renderPlan` touch. Real
 *  `AudioContext` is unavailable under Vitest's default (non-browser) environment, and
 *  `currentTime` needs to be directly controllable to test the schedule lead-in. */
class FakeNode {
  disconnectCalls = 0;
  connect(dest?: unknown, _output?: number): FakeNode {
    // Record what ends up wired to the destination: `stop()` must let go of THAT node, whatever
    // the master chain happens to end in.
    if (dest instanceof FakeDestinationNode) dest.inputs.push(this);
    return this;
  }
  disconnect(): void {
    this.disconnectCalls++;
  }
}
class FakeDestinationNode extends FakeNode {
  inputs: FakeNode[] = [];
}
class FakeWaveShaperNode extends FakeNode {
  curve: Float32Array | null = null;
  oversample = "none";
}
class FakeBiquadNode extends FakeNode {
  type = "";
  frequency = { value: 0 };
  gain = { value: 0 };
  Q = { value: 0 };
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
  destination = new FakeDestinationNode();
  shapers: FakeWaveShaperNode[] = [];
  biquads: FakeBiquadNode[] = [];
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
  createChannelMerger(): FakeNode {
    return new FakeNode();
  }
  createWaveShaper(): FakeWaveShaperNode {
    const n = new FakeWaveShaperNode();
    this.shapers.push(n);
    return n;
  }
  createBiquadFilter(): FakeBiquadNode {
    const n = new FakeBiquadNode();
    this.biquads.push(n);
    return n;
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

/** A project whose MASTER chain runs past `masterGain`, so the graph's terminal node is not the
 *  fader: saturation builds a waveshaper and the master filter a biquad. Master-bus nodes are
 *  built whether or not any clip is scheduled, which a track's own filter is not — the track path
 *  goes through the same `applyFilter`, and is exercised in a browser instead. */
function shapedProject(): Project {
  return { ...createProject(), saturation: 0.5, masterFilter: { kind: "highpass", hz: 500 } };
}

describe("AudioEngine.stop", () => {
  it("lets go of the node wired to the destination, not just the master fader", () => {
    // With Glue, saturation, mix fades, master EQ or the master filter on, `output !== masterGain`
    // and that tail stays connected to the destination with no JS reference once `#graph` is
    // dropped. Chrome keeps destination-connected nodes alive, so every reschedule leaked another
    // master chain for the rest of the session.
    const engine = new AudioEngine();
    engine.play(shapedProject(), emptyPool(), 0, 10, new Set());
    const terminal = fakeCtx.destination.inputs.at(-1)!;
    expect(terminal).not.toBeUndefined();

    engine.stop();
    expect(terminal.disconnectCalls).toBeGreaterThan(0);
  });
});

describe("AudioEngine live mix changes, turning something OFF", () => {
  it("bypasses the waveshaper when drive returns to zero", () => {
    // The node was BUILT this time round, so an early return leaves the last curve in the graph:
    // preview keeps saturating while the document — and any export — says off.
    const engine = new AudioEngine();
    engine.play(shapedProject(), emptyPool(), 0, 10, new Set());
    const shaper = fakeCtx.shapers.at(-1)!;
    expect(shaper.curve).not.toBeNull();

    engine.setSaturation(0);
    expect(shaper.curve).toBeNull(); // a null curve IS the Web Audio bypass
    engine.stop();
  });

  it("opens the filter fully when it returns to off", () => {
    const engine = new AudioEngine();
    engine.play(shapedProject(), emptyPool(), 0, 10, new Set());
    const biquad = fakeCtx.biquads.at(-1)!;
    expect(biquad.frequency.value).toBe(500);

    engine.setMasterFilter(FILTER_OFF);
    expect(biquad.frequency.value).toBe(FILTER_HP_MIN_HZ); // out of the way, not left at 500 Hz
    engine.stop();
  });
});

describe("AudioEngine.needsRebuild", () => {
  it("is false while nothing is playing, and false for a graph that matches the document", () => {
    const engine = new AudioEngine();
    expect(engine.needsRebuild(shapedProject())).toBe(false);
    engine.play(shapedProject(), emptyPool(), 0, 10, new Set());
    expect(engine.needsRebuild(shapedProject())).toBe(false);
    engine.stop();
  });

  it("is true once the document asks for a master node the graph never built", () => {
    // Neutral builds nothing, so sweeping the master EQ away from flat during playback had no
    // biquad to write onto — and a "mix" gesture never rescheduled, so the sweep was inaudible
    // until the next play.
    const engine = new AudioEngine();
    engine.play(createProject(), emptyPool(), 0, 10, new Set());
    const shaped: Project = { ...createProject(), masterEq: { lowDb: 3, midDb: 0, highDb: 0 } };
    expect(engine.needsRebuild(shaped)).toBe(true);
    expect(engine.needsRebuild({ ...createProject(), saturation: 0.3 })).toBe(true);
    expect(
      engine.needsRebuild({ ...createProject(), masterFilter: { kind: "lowpass", hz: 800 } }),
    ).toBe(true);
    engine.stop();
  });

  it("ignores a track that built no nodes at all", () => {
    // No clip in the window means no track chain; asking for its EQ is not a missing node, and
    // treating it as one would rebuild on every release forever.
    const engine = new AudioEngine();
    const p = createProject();
    engine.play(p, emptyPool(), 0, 10, new Set());
    const withEq: Project = {
      ...p,
      tracks: p.tracks.map((t) => ({ ...t, eq: { lowDb: 6, midDb: 0, highDb: 0 } })),
    };
    expect(engine.needsRebuild(withEq)).toBe(false);
    engine.stop();
  });
});
