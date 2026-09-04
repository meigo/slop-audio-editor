import { describe, expect, it } from "vitest";
import type { Project } from "../doc/document";
import type { Source } from "./pool";
import { renderPlan, scaleCurve } from "./render";
import type { ScheduledClip } from "./schedule";

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
  gain = {
    value: 1,
    setValueCurveAtTime: (_curve: Float32Array, _at: number, _durS: number): void => {},
  };
}

class FakeBufferSourceNode extends FakeNode {
  buffer: unknown = null;
  startCalls: { when: number; offset: number; duration: number }[] = [];
  start(when: number, offset: number, duration: number): void {
    this.startCalls.push({ when, offset, duration });
  }
}

/** Every GainNode's `setValueCurveAtTime` throws on the `throwOnCall`-th invocation across the
 *  WHOLE plan (1-indexed), simulating a fade span the real Web Audio API would reject. */
function makeFakeCtx(throwOnCall = Infinity) {
  const gains: FakeGainNode[] = [];
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
    createBufferSource: (): FakeBufferSourceNode => {
      const s = new FakeBufferSourceNode();
      bufferSources.push(s);
      return s;
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, gains, bufferSources, destination };
}

function fakeProject(trackIds: string[]): Project {
  return {
    name: "p",
    masterGain: 1,
    glue: false,
    tracks: trackIds.map((id) => ({ id, name: id, clips: [], gain: 1, muted: false })),
  };
}

function fakeSource(id: string): Source {
  return {
    id, name: id, bytes: new Uint8Array(),
    buffer: {} as AudioBuffer, peaks: new Float32Array(), durationS: 10, loudnessLufs: -20,
  };
}

function fakeScheduledClip(overrides: Partial<ScheduledClip> = {}): ScheduledClip {
  return {
    trackId: "t1", sourceId: "s1", when: 0, sourceOffset: 0, duration: 1, gain: 1,
    fadeIn: null, fadeOut: null,
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
    renderPlan(ctx, plan, NO_SOLO_POOL, fakeProject(["t1"]), 0);
    expect(bufferSources).toHaveLength(2);
    expect(bufferSources.every((s) => s.startCalls.length === 1)).toBe(true);
  });

  it("starts NO source — not even ones already built — when a later clip's fade throws", () => {
    // Two clips, each with one fade span: the first clip's setValueCurveAtTime call succeeds,
    // the second's throws — simulating setValueCurveAtTime rejecting an overlapping/invalid span.
    const { ctx, bufferSources } = makeFakeCtx(2);
    const plan = [
      fakeScheduledClip({ fadeIn: { atS: 0, durS: 1, shape: "linear", fromT: 0, toT: 1 } }),
      fakeScheduledClip({ when: 2, fadeIn: { atS: 2, durS: 1, shape: "linear", fromT: 0, toT: 1 } }),
    ];
    expect(() => renderPlan(ctx, plan, NO_SOLO_POOL, fakeProject(["t1"]), 0)).toThrow();
    // Nothing was started — including the FIRST clip's already-built node — because starting is
    // deferred until the whole graph has been built without error.
    expect(bufferSources.every((s) => s.startCalls.length === 0)).toBe(true);
  });

  it("disconnects the graph built so far before rethrowing", () => {
    const { ctx, destination } = makeFakeCtx(1);
    const plan = [fakeScheduledClip({ fadeIn: { atS: 0, durS: 1, shape: "linear", fromT: 0, toT: 1 } })];
    expect(() => renderPlan(ctx, plan, NO_SOLO_POOL, fakeProject(["t1"]), 0)).toThrow();
    expect(destination.disconnectCalls).toBe(0); // destination itself is never touched
  });

  it("skips a clip whose source never loaded, without throwing", () => {
    const { ctx, bufferSources } = makeFakeCtx();
    const plan = [fakeScheduledClip({ sourceId: "missing" })];
    const graph = renderPlan(ctx, plan, NO_SOLO_POOL, fakeProject(["t1"]), 0);
    expect(bufferSources).toHaveLength(0);
    expect(graph.sources).toHaveLength(0);
  });
});
