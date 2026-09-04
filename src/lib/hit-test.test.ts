import { describe, expect, it } from "vitest";
import { MOUSE_ZONES, TOUCH_ZONES, hitTestClip, hitTestRuler } from "./hit-test";

const W = 200;
const H = 80;

describe("hitTestClip", () => {
  it("reports the body in the middle", () => {
    expect(hitTestClip(100, 40, W, H)).toBe("body");
  });

  it("reports trim handles at the left and right edges", () => {
    expect(hitTestClip(2, 40, W, H)).toBe("trimStart");
    expect(hitTestClip(W - 2, 40, W, H)).toBe("trimEnd");
  });

  it("reports fade handles in the TOP corners, winning over the trim edge", () => {
    expect(hitTestClip(2, 3, W, H)).toBe("fadeIn");
    expect(hitTestClip(W - 2, 3, W, H)).toBe("fadeOut");
  });

  it("keeps the trim handle below the fade corner", () => {
    expect(hitTestClip(2, 40, W, H)).toBe("trimStart");
  });

  it("falls back to trim handles on a clip too narrow for two fade corners", () => {
    expect(hitTestClip(1, 3, 8, H)).toBe("trimStart");
    expect(hitTestClip(7, 3, 8, H)).toBe("trimEnd");
  });

  it("never returns a zone for a zero-width clip", () => {
    expect(hitTestClip(0, 0, 0, H)).toBe("body");
  });
});

describe("hitTestRuler", () => {
  it("reports the in handle within threshold of its position", () => {
    expect(hitTestRuler(100, 100, null)).toBe("in");
    expect(hitTestRuler(103, 100, null)).toBe("in");
  });

  it("reports the out handle within threshold of its position", () => {
    expect(hitTestRuler(200, null, 200)).toBe("out");
    expect(hitTestRuler(197, null, 200)).toBe("out");
  });

  it("reports a seek for a miss", () => {
    expect(hitTestRuler(150, 100, 200)).toBe("seek");
  });

  it("picks the NEARER handle when both are in range", () => {
    expect(hitTestRuler(101, 100, 105)).toBe("in");
    expect(hitTestRuler(104, 100, 105)).toBe("out");
  });

  it("never hits a null marker position", () => {
    expect(hitTestRuler(100, null, null)).toBe("seek");
    expect(hitTestRuler(100, null, 100)).toBe("out");
  });

  it("hits exactly at the threshold boundary, misses just past it", () => {
    expect(hitTestRuler(106, 100, null, 6)).toBe("in");
    expect(hitTestRuler(107, 100, null, 6)).toBe("seek");
  });
});

describe("hitTestClip with touch-sized zones", () => {
  it("widens the trim edges for a finger", () => {
    expect(hitTestClip(10, 40, 400, 60, MOUSE_ZONES)).toBe("body");
    expect(hitTestClip(10, 40, 400, 60, TOUCH_ZONES)).toBe("trimStart");
  });

  it("still leaves a body to grab on a narrow clip", () => {
    // 30 px wide with 18 px touch edges would be trim-only from both sides; the width/3 cap keeps
    // the middle grabbable, so a short clip can still be MOVED on a touchscreen.
    expect(hitTestClip(15, 40, 30, 60, TOUCH_ZONES)).toBe("body");
  });

  it("leaves mouse behaviour exactly as it was", () => {
    expect(hitTestClip(3, 40, 400, 60)).toBe("trimStart");
    expect(hitTestClip(10, 40, 400, 60)).toBe("body");
    expect(hitTestClip(397, 40, 400, 60)).toBe("trimEnd");
  });
});
