import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/stores/chat";
import { shouldShowTurnActions } from "./turnActions";

const message = (
  id: string,
  role: ChatMessage["role"],
  content: string,
  streaming = false,
): ChatMessage => ({ id, role, content, streaming, timestamp: 1 });

describe("shouldShowTurnActions", () => {
  const messages = [
    message("u1", "user", "历史问题"),
    message("a1", "assistant", "历史回答"),
    message("u2", "user", "当前问题"),
    message("a2", "assistant", "当前回答", true),
  ];

  it("session 运行中仍展示已完成历史 Turn 的操作", () => {
    expect(shouldShowTurnActions(messages, 1, true)).toBe(true);
  });

  it("session 运行中隐藏当前活动 Turn 的操作", () => {
    expect(shouldShowTurnActions(messages, 3, true)).toBe(false);
  });

  it("session 空闲后展示最后一个已完成 Turn 的操作", () => {
    const completed = messages.map((item) => ({ ...item, streaming: false }));
    expect(shouldShowTurnActions(completed, 3, false)).toBe(true);
  });
});
