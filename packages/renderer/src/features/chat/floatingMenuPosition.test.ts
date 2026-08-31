import { describe, expect, it } from "vitest";
import { calculateFloatingMenuPosition } from "@ftre/ui";

const viewport = { top: 0, left: 0, width: 800, height: 600 };

describe("calculateFloatingMenuPosition", () => {
  it("flips a bottom menu above the trigger when the lower space is insufficient", () => {
    const position = calculateFloatingMenuPosition(
      { top: 540, right: 300, bottom: 568, left: 200, width: 100, height: 28 },
      { width: 240, height: 180 },
      viewport,
      { placement: "bottom", align: "start", gap: 8, padding: 8 },
    );

    expect(position.placement).toBe("top");
    expect(position.top).toBe(352);
    expect(position.maxHeight).toBe(524);
  });

  it("flips a right submenu to the left when the right edge has no room", () => {
    const position = calculateFloatingMenuPosition(
      { top: 120, right: 790, bottom: 148, left: 700, width: 90, height: 28 },
      { width: 260, height: 220 },
      viewport,
      { placement: "right", align: "start", gap: 4, padding: 8 },
    );

    expect(position.placement).toBe("left");
    expect(position.left).toBe(436);
    expect(position.top).toBe(120);
  });

  it("keeps an expanded panel inside the safe viewport bounds", () => {
    const position = calculateFloatingMenuPosition(
      { top: 4, right: 70, bottom: 32, left: 20, width: 50, height: 28 },
      { width: 320, height: 900 },
      viewport,
      { placement: "top", align: "start", gap: 4, padding: 8 },
    );

    expect(position.left).toBe(20);
    expect(position.top).toBe(8);
    expect(position.maxHeight).toBe(556);
  });
});
