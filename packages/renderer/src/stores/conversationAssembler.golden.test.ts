/**
 * 跨语言 golden 对拍测试（PRD-F42 AC1 / F43 AC5）。
 *
 * 共享 fixture（`@/types/wire.golden.json`，由 ftre 仓
 * `scripts/gen_wire_types.py` 从 `packages/ftre-agent/tests/fixtures/
 * session_events_golden.json` 同步）是双侧 fold 的唯一事实源：
 * 服务端 `ftre_agent.session.derive.derive_messages` 与本仓
 * `ConversationAssembler` 对同一事件序列 fold，输出必须逐字段一致。
 *
 * 归一化规则（两侧运行时固有差异，不构成语义差异）：
 * - null / undefined 剔除（服务端 dump exclude_none ↔ 客户端显式 null）；
 * - created_at / finished_at 的 ISO 字符串转 epoch ms
 *   （Python `+00:00` ↔ JS `toISOString()` 的 `.000Z`）。
 */
import { describe, expect, it } from "vitest";
import { ConversationAssembler } from "./conversationAssembler";
import golden from "@/types/wire.golden.json";
import type { SessionEvent } from "@/types/wire.gen";

const TIMESTAMP_KEYS = new Set(["created_at", "finished_at"]);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === null || item === undefined) continue;
      out[key] = TIMESTAMP_KEYS.has(key) && typeof item === "string"
        ? Date.parse(item)
        : normalize(item);
    }
    return out;
  }
  return value;
}

describe("ConversationAssembler × derive_messages 跨语言 golden 对拍", () => {
  it("fixture 事件流 fold 输出与服务端 expected_messages 逐字段一致", () => {
    const assembler = new ConversationAssembler();
    for (const event of golden.events as SessionEvent[]) {
      assembler.append(event);
    }
    const actual = assembler.messages();
    expect(actual).toHaveLength((golden.expected_messages as unknown[]).length);
    expect(normalize(actual)).toEqual(normalize(golden.expected_messages));
  });

  it("fixture 事件流重放两次输出引用级一致（幂等）", () => {
    const first = new ConversationAssembler();
    const second = new ConversationAssembler();
    for (const event of golden.events as SessionEvent[]) {
      first.append(event);
      second.append(event);
    }
    expect(normalize(first.messages())).toEqual(normalize(second.messages()));
    expect(first.lastSeq).toBe(golden.events.length - 1);
  });
});
