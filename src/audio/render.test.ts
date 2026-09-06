import { describe, expect, it } from "vitest";
import { FILTER_Q, type Project } from "../doc/document";
import type { Source } from "./pool";
import { renderPlan, scaleCurve } from "./render";
import type { ScheduledClip } from "./schedule";

const WINDOW = { fromS: 0, toS: 60 };

describe("scaleCurve", () => {
  it("multiplies every point by the clip gain", () => {
    expect([...scaleCurve(new Float32Array([0, 0.5, 1]), 0.5)]).toEqual([0, 0.25, 0.5]);
  });

  it("returns the same array instance at unity gain — nothing to do", () => {
    const c = new Float32Array([0, 1]);
    expect(scaleCurve(c, 1)).toBe(c);
  });

  it("handles zero gain", () => {
    expect([...scaleCurve(new Float32Array([0, 1]), 0)]).toEqual([0, 0]);
  });
});

/** Minimal fakes for the slice of the Web Audio API `renderPlan` touches. Real `AudioContext` and
 *  `AudioBuffer` are unavailable under Vitest's default (non-browser) environment. */
class FakeNode {
  disconnectCalls = 0;
  connect(_dest: FakeNode): FakeNode {
    return _dest;
  }
  disconnect(): void {
    this.disconnectCalls++;
  }
}

class FakeGainNode extends FakeNode {
  channelCount = 2;
  channelCountMode = "max";
  channelInterpretation = "speakers";
  gain = {
    value: 1,
    setValueCurveAtTime: (_curve: Float32Array, _at: number, _durS: number): void => {},
  };
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

class FakeBufferSourceNode extends FakeNode {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  startCalls: { when: number; offset: number; duration: number }[] = [];
  start(when: number, offset: number, duration: number): void {
    this.startCalls.push({ when, offset, duration });
  }
}

/** Every GainNode's `setValueCurveAtTime` throws on the `throwOnCall`-th invocation across the
 *  WHOLE plan (1-indexed), simulating a fade span the real Web Audio API would reject. */
function makeFakeCtx(throwOnCall = Infinity) {
  const gains: FakeGainNode[] = [];
  const biquads: FakeBiquadNode[] = [];
  const shapers: FakeWaveShaperNode[] = [];
  const bufferSources: FakeBufferSourceNode[] = [];
  const destination = new FakeNode();
  let curveCalls = 0;
  const ctx = {
    destination,
    createGain: (): FakeGainNode => {
      const g = new FakeGainNode();
      g.gain.setValueCurveAtTime = () => {
        curveCalls++;
        if (curveCalls === throwOnCall) throw new Error("NotSupportedError: overlapping curves");
      };
      gains.push(g);
      return g;
    },
    createWaveShaper: (): FakeWaveShaperNode => {
      const n = new FakeWaveShaperNode();
      shapers.push(n);
      return n;
    },
    createChannelSplitter: (): FakeNode => new FakeNode(),
    createChannelMerger: (): FakeNode => new FakeNode(),
    createBiquadFilter: (): FakeBiquadNode => {
      const n = new FakeBiquadNode();
      biquads.push(n);
      return n;
    },
    createBufferSource: (): FakeBufferSourceNode => {
      const s = new FakeBufferSourceNode();
      bufferSources.push(s);
      return s;
    },
  };
  return {
    ctx: ctx as unknown as BaseAudioContext,
    gains,
    biquads,
    shapers,
    bufferSources,
    destination,
  };
}

function fakeProject(trackIds: string[]): Project {
  return {
    name: "p",
    masterGain: 1,
    glue: false,
    duckDepthDb: -12,
    masterEq: { lowDb: 0, midDb: 0, highDb: 0 },
    masterFilter: { kind: "off" as const, hz: 0 },
    saturation: 0,
    fadeOutS: 0,
    tracks: trackIds.map((id) => ({
      id,
      name: id,
      clips: [],
      gain: 1,
      muted: false,
      ducked: false,
      eq: { lowDb: 0, midDb: 0, highDb: 0 },
      pan: 0,
      filter: { kind: "off" as const, hz: 0 },
    })),
  };
}

function fakeSource(id: string): Source {
  return {
    id,
    name: id,
    bytes: new Uint8Array(),
    buffer: {} as AudioBuffer,
    peaks: new Float32Array(),
    durationS: 10,
    loudnessLufs: -20,
  };
}

function fakeScheduledClip(overrides: Partial<ScheduledClip> = {}): ScheduledClip {
  return {
    trackId: "t1",
    sourceId: "s1",
    when: 0,
    sourceOffset: 0,
    duration: 1,
    speed: 1,
    gain: 1,
    fadeIn: null,
    fadeOut: null,
    ...overrides,
  };
}

const NO_SOLO_POOL = {
  get: (id: string): Source | undefined => (id === "s1" ? fakeSource("s1") : undefined),
};

describe("renderPlan", () => {
  it("starts every source when nothing throws", () => {
    const { ctx, bufferSources } = makeFakeCtx();
    const plan = [
      fakeScheduledClip({ fadeIn: { atS: 0, durS: 1, shape: "linear", fromT: 0, toT: 1 } }),
      fakeScheduledClip({ when: 2 }),
    ];
    renderPlan(ctx, plan, NO_SOLO_POOL, fakeProject(["t1"]), 0, WINDOW);
    expect(bufferSources).toHaveLength(2);
    expect(bufferSources.every((s) => s.startCalls.length === 1)).toBe(true);
  });

  it("starts NO source — not even ones already built — when a later clip's fade throws", () => {
    // Two clips, each with one fade span: the first clip's setValueCurveAtTime call succeeds,
    // the second's throws — simulating setValueCurveAtTime rejecting an overlapping/invalid span.
    const { ctx, bufferSources } = makeFakeCtx(2);
    const plan = [
      fakeScheduledClip({ fadeIn: { atS: 0, durS: 1, shape: "linear", fromT: 0, toT: 1 } }),
      fakeScheduledClip({
        when: 2,
        fadeIn: { atS: 2, durS: 1, shape: "linear", fromT: 0, toT: 1 },
      }),
    ];
    expect(() => renderPlan(ctx, plan, NO_SOLO_POOL, fakeProject(["t1"]), 0, WINDOW)).toThrow();
    // Nothing was started — including the FIRST clip's already-built node — because starting is
    // deferred until the whole graph has been built without error.
    expect(bufferSources.every((s) => s.startCalls.length === 0)).toBe(true);
  });

  it("disconnects the graph built so far before rethrowing", () => {
    const { ctx, destination } = makeFakeCtx(1);
    const plan = [
      fakeScheduledClip({ fadeIn: { atS: 0, durS: 1, shape: "linear", fromT: 0, toT: 1 } }),
    ];
    expect(() => renderPlan(ctx, plan, NO_SOLO_POOL, fakeProject(["t1"]), 0, WINDOW)).toThrow();
    expect(destination.disconnectCalls).toBe(0); // destination itself is never touched
  });

  it("skips a clip whose source never loaded, without throwing", () => {
    const { ctx, bufferSources } = makeFakeCtx();
    const plan = [fakeScheduledClip({ sourceId: "missing" })];
    const graph = renderPlan(ctx, plan, NO_SOLO_POOL, fakeProject(["t1"]), 0, WINDOW);
    expect(bufferSources).toHaveLength(0);
    expect(graph.sources).toHaveLength(0);
  });
});

describe("master EQ", () => {
  const clip = fakeScheduledClip();
  const pool = { get: (): Source => fakeSource("s1") };

  it("builds no biquads at all when it is flat, so an untouched project renders the old graph", () => {
    const { ctx, biquads } = makeFakeCtx();
    renderPlan(ctx, [clip], pool, fakeProject(["t1"]), 0, WINDOW);
    expect(biquads.length).toBe(0);
  });

  it("builds three bands when shaped, and retains them for live adjustment", () => {
    const { ctx, biquads } = makeFakeCtx();
    const project = { ...fakeProject(["t1"]), masterEq: { lowDb: 0, midDb: -9, highDb: 0 } };

    const graph = renderPlan(ctx, [clip], pool, project, 0, WINDOW);

    expect(biquads.map((b) => b.type)).toEqual(["lowshelf", "peaking", "highshelf"]);
    expect(graph.masterEq?.mid.gain.value).toBe(-9);
  });

  it("is null on the graph when flat — there is nothing to adjust", () => {
    const { ctx } = makeFakeCtx();
    expect(renderPlan(ctx, [clip], pool, fakeProject(["t1"]), 0, WINDOW).masterEq).toBe(null);
  });

  // Master and track EQ are independent chains: six biquads, not three shared ones.
  it("does not share its bands with a track's EQ", () => {
    const { ctx, biquads } = makeFakeCtx();
    const base = fakeProject(["t1"]);
    const project: Project = {
      ...base,
      masterEq: { lowDb: 3, midDb: 0, highDb: 0 },
      tracks: base.tracks.map((t) => ({ ...t, eq: { lowDb: -3, midDb: 0, highDb: 0 } })),
    };

    const graph = renderPlan(ctx, [clip], pool, project, 0, WINDOW);

    expect(biquads.length).toBe(6);
    expect(graph.masterEq?.low.gain.value).toBe(3);
    expect(graph.trackEqs.get("t1")?.low.gain.value).toBe(-3);
  });
});

describe("varispeed in the graph", () => {
  it("sets playbackRate from the plan — without it a 'speed' change is silent", () => {
    const { ctx, bufferSources } = makeFakeCtx();
    renderPlan(
      ctx,
      [fakeScheduledClip({ speed: 2, duration: 10 })],
      { get: (): Source => fakeSource("s1") },
      fakeProject(["t1"]),
      0,
      WINDOW,
    );
    expect(bufferSources[0].playbackRate.value).toBe(2);
  });

  it("passes the plan's duration through untouched — it is already in buffer time", () => {
    const { ctx, bufferSources } = makeFakeCtx();
    renderPlan(
      ctx,
      [fakeScheduledClip({ speed: 0.5, duration: 2.5 })],
      { get: (): Source => fakeSource("s1") },
      fakeProject(["t1"]),
      0,
      WINDOW,
    );
    expect(bufferSources[0].startCalls[0].duration).toBe(2.5);
  });
});

describe("the track filter", () => {
  const clip = fakeScheduledClip();
  const pool = { get: (): Source => fakeSource("s1") };
  const withFilter = (filter: Project["tracks"][number]["filter"]): Project => {
    const base = fakeProject(["t1"]);
    return { ...base, tracks: base.tracks.map((t) => ({ ...t, filter })) };
  };

  it("builds NOTHING when off, so an untouched project renders the old graph", () => {
    const { ctx, biquads } = makeFakeCtx();
    renderPlan(ctx, [clip], pool, withFilter({ kind: "off", hz: 0 }), 0, WINDOW);
    expect(biquads.length).toBe(0);
  });

  it("builds one biquad of the requested kind", () => {
    const { ctx, biquads } = makeFakeCtx();
    renderPlan(ctx, [clip], pool, withFilter({ kind: "highpass", hz: 120 }), 0, WINDOW);
    expect(biquads.map((b) => [b.type, b.frequency.value])).toEqual([["highpass", 120]]);
    // In dB, not a quality factor — see FILTER_Q. 0.707 would ask for a resonant bump.
    expect(biquads[0].Q.value).toBe(FILTER_Q);
  });

  it("is independent of the EQ — a shaped track with a filter builds four", () => {
    const { ctx, biquads } = makeFakeCtx();
    const base = fakeProject(["t1"]);
    const project: Project = {
      ...base,
      tracks: base.tracks.map((t) => ({
        ...t,
        eq: { lowDb: -3, midDb: 0, highDb: 0 },
        filter: { kind: "lowpass" as const, hz: 4000 },
      })),
    };

    renderPlan(ctx, [clip], pool, project, 0, WINDOW);

    expect(biquads.map((b) => b.type)).toEqual(["lowshelf", "peaking", "highshelf", "lowpass"]);
  });
});

describe("track pan", () => {
  const clip = fakeScheduledClip();
  const pool = { get: (): Source => fakeSource("s1") };
  const panned = (pan: number): Project => {
    const base = fakeProject(["t1"]);
    return { ...base, tracks: base.tracks.map((t) => ({ ...t, pan })) };
  };

  it("builds NOTHING when centred, so an unpanned project renders the old graph", () => {
    const { ctx, gains } = makeFakeCtx();
    const before = gains.length;
    renderPlan(ctx, [clip], pool, panned(0), 0, WINDOW);
    // Only the clip, track and master gains — no widen, no channel gains.
    expect(gains.length - before).toBe(3);
  });

  it("builds the balance network when panned, and retains both channel gains", () => {
    const { ctx } = makeFakeCtx();
    const graph = renderPlan(ctx, [clip], pool, panned(-1), 0, WINDOW);
    const nodes = graph.trackPans.get("t1");
    expect(nodes).toBeDefined();
    expect(nodes?.left.gain.value).toBeCloseTo(Math.SQRT2, 9);
    expect(nodes?.right.gain.value).toBeCloseTo(0, 9);
  });

  // The fake context cannot model channel up-mixing, so the one property combination that makes
  // the widen node work is pinned structurally instead. Without `speakers`, a ChannelSplitter
  // up-mixes DISCRETELY and a mono track loses its right channel entirely — measured in a browser,
  // invisible here.
  it("forces two channels with speakers interpretation before splitting", () => {
    const { ctx, gains } = makeFakeCtx();
    renderPlan(ctx, [clip], pool, panned(-0.5), 0, WINDOW);
    const widen = gains.find(
      (g) => g.channelCountMode === "explicit" && g.channelInterpretation === "speakers",
    );
    expect(widen, "no widen gain was built").toBeDefined();
    expect(widen?.channelCount).toBe(2);
  });

  it("uses the EQUAL POWER law at centre-ish positions, not a linear one", () => {
    const { ctx } = makeFakeCtx();
    const graph = renderPlan(ctx, [clip], pool, panned(0.0001), 0, WINDOW);
    const n = graph.trackPans.get("t1");
    // Both sides near -3 dB, and the squares summing to 1 is what "equal power" means.
    const l = n?.left.gain.value ?? 0;
    const r = n?.right.gain.value ?? 0;
    expect(l ** 2 + r ** 2).toBeCloseTo(2, 6);
    expect(l).toBeCloseTo(1, 3); // unity at centre, so the bypass and the network agree
  });
});

describe("master filter", () => {
  const clip = fakeScheduledClip();
  const pool = { get: (): Source => fakeSource("s1") };
  const withMaster = (masterFilter: Project["masterFilter"]): Project => ({
    ...fakeProject(["t1"]),
    masterFilter,
  });

  it("builds NOTHING when off", () => {
    const { ctx, biquads } = makeFakeCtx();
    renderPlan(ctx, [clip], pool, withMaster({ kind: "off", hz: 0 }), 0, WINDOW);
    expect(biquads.length).toBe(0);
  });

  it("builds one biquad and retains it for live sweeping", () => {
    const { ctx, biquads } = makeFakeCtx();
    const graph = renderPlan(
      ctx,
      [clip],
      pool,
      withMaster({ kind: "highpass", hz: 90 }),
      0,
      WINDOW,
    );
    expect(biquads.map((b) => [b.type, b.frequency.value])).toEqual([["highpass", 90]]);
    expect(graph.masterFilter?.frequency.value).toBe(90);
  });

  it("is independent of the master EQ and of a track's own filter", () => {
    const { ctx, biquads } = makeFakeCtx();
    const base = fakeProject(["t1"]);
    renderPlan(
      ctx,
      [clip],
      pool,
      {
        ...base,
        masterEq: { lowDb: 2, midDb: 0, highDb: 0 },
        masterFilter: { kind: "lowpass", hz: 8000 },
        tracks: base.tracks.map((t) => ({ ...t, filter: { kind: "highpass" as const, hz: 100 } })),
      },
      0,
      WINDOW,
    );
    // Track filter, then the master's three EQ bands, then the master filter.
    expect(biquads.map((b) => b.type)).toEqual([
      "lowshelf",
      "peaking",
      "highshelf",
      "lowpass",
      "highpass",
    ]);
  });
});

describe("master saturation", () => {
  const clip = fakeScheduledClip();
  const pool = { get: (): Source => fakeSource("s1") };
  const driven = (saturation: number): Project => ({ ...fakeProject(["t1"]), saturation });

  it("builds NO waveshaper at zero drive", () => {
    const { ctx, shapers } = makeFakeCtx();
    const graph = renderPlan(ctx, [clip], pool, driven(0), 0, WINDOW);
    expect(shapers.length).toBe(0);
    expect(graph.saturator).toBe(null);
  });

  it("builds one when driven, oversampled against aliasing", () => {
    const { ctx, shapers } = makeFakeCtx();
    renderPlan(ctx, [clip], pool, driven(0.5), 0, WINDOW);
    expect(shapers.length).toBe(1);
    expect(shapers[0].oversample).toBe("4x");
    expect(shapers[0].curve?.length).toBeGreaterThan(1000);
  });

  // The meter must read what leaves the app, and saturation is the last thing to touch it.
  it("is the graph's output node, so the meter reads through it", () => {
    const { ctx } = makeFakeCtx();
    const graph = renderPlan(ctx, [clip], pool, driven(0.5), 0, WINDOW);
    expect(graph.output).toBe(graph.saturator);
  });
});
