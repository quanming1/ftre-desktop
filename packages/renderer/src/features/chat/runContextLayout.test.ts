import { describe, expect, it } from "vitest";

import {
  initialRunContextLayoutMode,
  nextRunContextLayoutMode,
} from "./runContextLayout";

describe("run context responsive layout", () => {
  it("uses the floating panel when the chat container cannot keep a readable rail layout", () => {
    expect(initialRunContextLayoutMode(1_183)).toBe("floating");
    expect(nextRunContextLayoutMode(1_183, "rail")).toBe("floating");
  });

  it("keeps its current mode inside the hysteresis range", () => {
    expect(nextRunContextLayoutMode(1_220, "rail")).toBe("rail");
    expect(nextRunContextLayoutMode(1_220, "floating")).toBe("floating");
  });

  it("restores the rail only after the container has enough extra width", () => {
    expect(initialRunContextLayoutMode(1_264)).toBe("rail");
    expect(nextRunContextLayoutMode(1_264, "floating")).toBe("rail");
  });
});
