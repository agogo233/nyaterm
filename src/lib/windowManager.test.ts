import { describe, expect, it } from "vitest";
import { centerWindowRectInWorkArea, rectOverlapsWorkArea } from "./windowManager";

describe("child window work-area helpers", () => {
  const primaryWorkArea = {
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1040 },
  };

  it("detects a child window completely outside disconnected monitor bounds", () => {
    expect(
      rectOverlapsWorkArea({ x: 2500, y: 100, width: 800, height: 560 }, primaryWorkArea),
    ).toBe(false);
  });

  it("keeps a child window that still intersects the visible work area", () => {
    expect(
      rectOverlapsWorkArea({ x: 1800, y: 100, width: 800, height: 560 }, primaryWorkArea),
    ).toBe(true);
  });

  it("centers an off-screen child window in the selected work area", () => {
    expect(centerWindowRectInWorkArea({ width: 800, height: 560 }, primaryWorkArea)).toEqual({
      x: 560,
      y: 240,
    });
  });
});
