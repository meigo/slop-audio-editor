import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs in a node environment with no DOM", () => {
    expect(typeof document).toBe("undefined");
  });
});
