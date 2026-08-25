import { describe, expect, it } from "vitest";
import {
  hasActiveTurn,
  hasPendingWork,
  hasRuntimeActivity,
  hasStreamingAssistant,
} from "./runtimeState";

describe("runtime state selectors", () => {
  it("不把 dispatching 或 pending-only 当成 active Turn", () => {
    expect(hasActiveTurn("running", "dispatching")).toBe(false);
    expect(hasActiveTurn("running", "executing")).toBe(true);
    expect(hasPendingWork(1, [])).toBe(true);
    expect(hasPendingWork(0, [])).toBe(false);
  });

  it("压缩和等待确认仍属于运行详情，但不属于普通推理占位", () => {
    expect(hasRuntimeActivity("compacting", "compacting", null)).toBe(true);
    expect(hasActiveTurn("running", "paused")).toBe(false);
    expect(hasRuntimeActivity("idle", "idle", 123)).toBe(true);
  });

  it("streaming 只由 Assistant 消息的 streaming 标记决定", () => {
    expect(hasStreamingAssistant([
      { id: "u", role: "user", content: "queued", timestamp: 1 },
    ])).toBe(false);
    expect(hasStreamingAssistant([
      { id: "a", role: "assistant", content: "", timestamp: 1, streaming: true },
    ])).toBe(true);
  });
});
