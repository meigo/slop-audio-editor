import { describe, expect, it } from "vitest";
import { hitTestClip } from "./hit-test";

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
