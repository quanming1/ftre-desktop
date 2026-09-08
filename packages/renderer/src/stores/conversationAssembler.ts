/**
 * ConversationAssembler —— 事件日志 → Msg 列表的幂等 fold 引擎（PRD-F42 FR1）。
 *
 * 表面事件的折叠规则与后端 `ftre_agent/session/derive.py::_apply_event` 完全一致
 * （跨语言 golden 对拍）；客户端额外折叠直播中的流式事件（chunk / result-start /
 * approval/asked），使直播期间也能渲染进行中的消息。whole-value
 * `assistant/message` 到达后整条替换，先前 chunk 聚合仅作历史（F41 I3）。
 *
 * 幂等：`append` 对 `seq <= lastSeq` 的事件直接跳过，同一段事件流重放 N 次结果相同。
 * 性能红线：text/thinking 块只做字符串追加；变更消息经 `takeDirty()` 报告，
 * 未触碰的消息保持对象引用稳定（memo 契约）。
 */
import type {
  AssistantChunkData,
  CompactData,
  SessionEvent,
  ToolResultData,
  WireBlock,
  WireMsg,
  WireToolCallBlock,
  WireToolResultBlock,
  WireUserPart,
} from "@/types/wire.gen";

let blockSequence = 0;
const genId = (prefix = "blk") => `${prefix}_${Date.now().toString(36)}_${++blockSequence}`;

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/** approval/asked 的确认上下文；tool_call 离开 asking 态后清除。 */
export interface AskContext {
  reason?: string;
  ruleId?: string;
}

function findBlock<T extends WireBlock>(
  message: WireMsg,
  type: T["type"],
  id: string,
): T | undefined {
  for (const block of message.content) {
    if (block.type === type && (block as T).id === id) return block as T;
  }
  return undefined;
}

function isToolResultBlock(
  block: WireBlock | WireUserPart,
): block is WireToolResultBlock {
  return block.type === "tool_result";
}

function normalizeOutputParts(output: unknown): unknown {
  if (Array.isArray(output)) return output;
  return output === undefined || output === null ? [] : [output];
}

export class ConversationAssembler {
  /** 已 fold 的最大事件 seq；-1 表示尚未消费任何事件。 */
  public lastSeq = -1;
  /** 未知事件类型计数（F41 FR6/F42 FR8 诊断用；不影响游标推进）。 */
  public unknownEventCount = 0;

  private messagesById = new Map<string, WireMsg>();
  private order: string[] = [];
  /** tool_call_id → 归属消息 id（配对索引，与 derive._FoldState.tool_calls 一致）。 */
  private toolCallOwner = new Map<string, string>();
  /** tool_call_id → 确认卡上下文（asking 期间）。 */
  public readonly askContext = new Map<string, AskContext>();
  private dirty = new Set<string>();

  // ─── 读侧 ──────────────────────────────────────────────────────────

  /** 有序 Msg 视图（按事件插入序；全量 transcript，含 hide 消息）。 */
  messages(): WireMsg[] {
    return this.order.map((id) => this.messagesById.get(id)!);
  }

  messageById(id: string): WireMsg | undefined {
    return this.messagesById.get(id);
  }

  has(id: string): boolean {
    return this.messagesById.has(id);
  }

  /** 取走自上次调用以来变更过的消息 id 集合（投影层据此做引用稳定合并）。 */
  takeDirty(): Set<string> {
    const changed = this.dirty;
    this.dirty = new Set<string>();
    return changed;
  }

  /** 当前未封口的 assistant 消息（hydrate 时保留 in-flight 流式态用）。 */
  takeInflightAssistants(): WireMsg[] {
    const inFlight: WireMsg[] = [];
    for (const id of this.order) {
      const message = this.messagesById.get(id)!;
      if (message.role === "assistant" && message.finished_at == null) {
        inFlight.push(message);
      }
    }
    return inFlight;
  }

  // ─── 历史种子（HTTP /messages → 本地 fold 基线）────────────────────

  /** 用持久化 Msg 重建 fold 状态；调用方随后写入 HTTP 返回的 Session seq。 */
  reset(seeds: WireMsg[]): void {
    this.lastSeq = -1;
    this.messagesById.clear();
    this.order = [];
    this.toolCallOwner.clear();
    this.askContext.clear();
    this.dirty.clear();
    for (const message of seeds) {
      this.insert(message);
    }
  }

  /** 追加一条已有消息（hydrate 保留 in-flight / 外部注入）；标记 dirty。 */
  insert(message: WireMsg): void {
    if (!Number.isFinite(message.seq)) message.seq = -1;
    if (message.id && !this.messagesById.has(message.id)) {
      this.order.push(message.id);
    }
    this.messagesById.set(message.id, message);
    this.indexToolCalls(message);
    this.dirty.add(message.id);
  }

  /**
   * paused 会话恢复确认卡：turn 以 paused 收尾且存在未闭合 tool_call 时，
   * derive 视图（state=pending）无法表达"等待确认"；这里合成 asking 态，
   * 让确认卡片在切换会话/刷新后仍可渲染（reason 未持久化，用通用文案）。
   */
  synthesizePausedAsking(): void {
    for (const id of this.order) {
      const message = this.messagesById.get(id)!;
      if (message.role !== "assistant" || message.finished_reason !== "paused") continue;
      const resulted = new Set(
        message.content.filter(isToolResultBlock).map((block) => block.id),
      );
      for (const block of message.content) {
        if (block.type !== "tool_call") continue;
        const call = block as WireToolCallBlock;
        if (resulted.has(call.id)) continue;
        if (call.state === "asking" || call.state === "finished") continue;
        call.state = "asking";
        if (!this.askContext.has(call.id)) {
          this.askContext.set(call.id, {});
        }
        this.dirty.add(id);
      }
    }
  }

  // ─── fold 入口 ─────────────────────────────────────────────────────

  /** 幂等消费一个事件：seq ≤ lastSeq 跳过；未知 type 计数后跳过。 */
  append(event: SessionEvent): void {
    if (!event || typeof event.type !== "string") return;
    const seq = typeof event.seq === "number" ? event.seq : -1;
    if (seq >= 0) {
      if (seq <= this.lastSeq) return;
      this.lastSeq = seq;
    }
    switch (event.type) {
      case "user/message":
        this.foldUserMessage(event);
        return;
      case "assistant/message":
        this.foldAssistantMessage(event);
        return;
      case "hint/message":
        this.foldHintMessage(event);
        return;
      case "compact/message":
        this.foldCompactMessage(event);
        return;
      case "tool/call-start":
        this.foldToolCallStart(event);
        return;
      case "tool/result-start":
        this.foldToolResultStart(event);
        return;
      case "tool/result":
        this.foldToolResult(event);
        return;
      case "approval/asked":
        this.foldApprovalAsked(event);
        return;
      case "assistant/chunk":
        this.foldChunk(event);
        return;
      case "turn/end":
        this.foldTurnEnd(event);
        return;
      case "turn/start":
      case "turn/retry":
      case "session/status":
        // 生命周期事件不改变消息表面（状态机在投影层处理）。
        return;
      default:
        this.unknownEventCount += 1;
        return;
    }
  }

  // ─── 表面事件（与 derive._apply_event 逐条对齐）────────────────────

  private foldUserMessage(event: SessionEvent): void {
    const data = (event.data ?? {}) as { content?: unknown[]; metadata?: Record<string, unknown>; request_id?: string };
    const timeMs = event.time || 0;
    this.sealPreviousAssistant(timeMs, event.seq);
    const metadata = { ...(data.metadata ?? {}) };
    if (data.request_id && metadata.request_id === undefined) {
      metadata.request_id = data.request_id;
    }
    const message: WireMsg = {
      id: event.message_id || genId("user"),
      name: typeof metadata.name === "string" ? metadata.name : "default",
      role: "user",
      content: (Array.isArray(data.content)
        ? [...data.content]
        : []) as WireMsg["content"],
      metadata,
      created_at: isoFromMs(timeMs),
      seq: event.seq,
      finished_at: null,
      finished_reason: null,
    };
    this.insert(message);
  }

  private foldAssistantMessage(event: SessionEvent): void {
    const data = (event.data ?? {}) as { message?: WireMsg };
    const payload = data.message;
    if (!payload || typeof payload !== "object") return;
    const message: WireMsg = { ...payload, content: [...(payload.content ?? [])] };
    // whole-value 载荷与信封坐标不一致时以信封为准（防御性对齐，同 derive）。
    if (event.message_id && message.id !== event.message_id) {
      message.id = event.message_id;
    }
    message.seq = Math.max(message.seq ?? -1, event.seq);
    this.insert(message);
  }

  private foldHintMessage(event: SessionEvent): void {
    if (!event.message_id) return;
    const data = (event.data ?? {}) as { hint?: string | unknown[]; source?: string | null };
    const message = this.ensureAssistant(event.message_id, event.time || 0, event.seq);
    const timeIso = isoFromMs(event.time || 0);
    message.content.push({
      // 块 id 派生自事件 seq（与服务端 derive 同规则，golden 对拍确定性要求）
      type: "hint",
      id: `hint_${event.seq}`,
      hint: data.hint ?? "",
      source: data.source ?? null,
      created_at: timeIso,
      finished_at: timeIso,
    });
    this.dirty.add(message.id);
    message.seq = Math.max(message.seq ?? -1, event.seq);
  }

  private foldCompactMessage(event: SessionEvent): void {
    const data = (event.data ?? {}) as CompactData;
    const timeMs = event.time || 0;
    this.sealPreviousAssistant(timeMs, event.seq);
    const id = event.message_id || genId("compact");
    // 摘要块 id 派生自 message_id（与服务端 derive 同规则，golden 对拍确定性要求）
    const compactBlockId = `compact_${id}`;
    if (String(data.mode ?? "summary") === "fast") {
      const toolResults = Number(data.tool_results ?? 0);
      const tokensBefore = Number(data.tokens_before ?? 0);
      const tokensAfter = Number(data.tokens_after ?? 0);
      const saved = Math.max(0, tokensBefore - tokensAfter);
      const toolResultIds = Array.isArray(data.tool_result_ids)
        ? data.tool_result_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
      const text =
        `已快速压缩：${toolResults} 个较早的工具输出已被裁剪，`
        + `其原始内容不再可见（约节省 ${saved} tokens）。后续如需相关信息请重新获取。`;
      const message: WireMsg = {
        id,
        name: "compact_fast",
        role: "assistant",
        content: [{ type: "text", id: compactBlockId, text, created_at: isoFromMs(timeMs) }],
        metadata: {
          context_compact: {
            mode: "fast",
            tool_results: toolResults,
            tokens_before: tokensBefore,
            tokens_after: tokensAfter,
            ...(toolResultIds.length > 0 ? { tool_result_ids: toolResultIds } : {}),
          },
        },
        created_at: isoFromMs(timeMs),
        seq: event.seq,
        finished_at: isoFromMs(timeMs),
        finished_reason: "completed",
      };
      this.insert(message);
      return;
    }
    const message: WireMsg = {
      id,
      name: "compact",
      role: "user",
      content: [{ type: "text", id: compactBlockId, text: String(data.summary_text ?? ""), created_at: isoFromMs(timeMs) }],
      metadata: {
        hide: true,
        context_compact: {
          through_message_id: data.through_message_id ?? "",
          trigger: data.trigger ?? "auto",
          tokens_before: data.tokens_before ?? 0,
          tokens_after: data.tokens_after ?? 0,
        },
      },
      created_at: isoFromMs(timeMs),
      seq: event.seq,
      finished_at: null,
      finished_reason: null,
    };
    this.insert(message);
  }

  private foldToolCallStart(event: SessionEvent): void {
    if (!event.message_id) return;
    const data = (event.data ?? {}) as { tool_call_id?: string; name?: string; arguments?: Record<string, unknown> };
    const toolCallId = String(data.tool_call_id ?? "");
    if (!toolCallId) return;
    const message = this.ensureAssistant(event.message_id, event.time || 0, event.seq);
    if (findBlock<WireToolCallBlock>(message, "tool_call", toolCallId)) return;
    message.content.push({
      type: "tool_call",
      id: toolCallId,
      name: String(data.name ?? ""),
      arguments: { ...(data.arguments ?? {}) },
      state: "pending",
      created_at: isoFromMs(event.time || 0),
    });
    this.toolCallOwner.set(toolCallId, message.id);
    this.dirty.add(message.id);
    message.seq = Math.max(message.seq ?? -1, event.seq);
  }

  private foldToolResult(event: SessionEvent): void {
    const data = (event.data ?? {}) as ToolResultData;
    const toolCallId = String(data.tool_call_id ?? "");
    if (!toolCallId) return;
    const owner = this.ownerOf(toolCallId);
    if (!owner) return;
    const message = this.messagesById.get(owner)!;
    const existing = findBlock<WireToolResultBlock>(message, "tool_result", toolCallId);
    if (existing) {
      const index = message.content.indexOf(existing);
      if (index >= 0) message.content.splice(index, 1);
    }
    const state = ["success", "error", "interrupted", "denied", "running"].includes(
      String(data.state ?? ""),
    )
      ? String(data.state)
      : "success";
    const finishedAt = isoFromMs(event.time || 0);
    message.content.push({
      type: "tool_result",
      id: toolCallId,
      name: String(data.name ?? ""),
      output: normalizeOutputParts(data.output),
      state,
      metadata: { ...(data.metadata ?? {}) },
      created_at: finishedAt,
      finished_at: finishedAt,
    });
    const call = findBlock<WireToolCallBlock>(message, "tool_call", toolCallId);
    if (call) {
      call.state = "finished";
      call.finished_at = finishedAt;
    }
    this.askContext.delete(toolCallId);
    this.dirty.add(message.id);
    message.seq = Math.max(message.seq ?? -1, event.seq);
  }

  private foldTurnEnd(event: SessionEvent): void {
    if (!event.message_id) return;
    const message = this.messagesById.get(event.message_id);
    if (!message || message.role !== "assistant") return;
    const data = (event.data ?? {}) as {
      outcome?: string;
      reason?: string;
      error?: WireMsg["error"];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
    };
    if (message.finished_at == null) {
      message.finished_at = isoFromMs(event.time || 0);
    }
    const rawReason = String(data.reason || data.outcome || "completed");
    // Keep live folding identical to the server derive() contract. paused and
    // cancelled are turn outcomes, not Msg.finished_reason values; a crashed
    // Gateway is represented as interrupted in the durable Msg snapshot.
    message.finished_reason = rawReason === "crashed"
      ? "interrupted"
      : rawReason === "cancelled" || rawReason === "paused"
        ? "completed"
        : rawReason;
    if (data.error && typeof data.error === "object") {
      message.error = { ...data.error };
    }
    if (data.usage && data.usage.total_tokens != null) {
      const usage = {
        prompt_tokens: Number(data.usage.prompt_tokens ?? 0),
        completion_tokens: Number(data.usage.completion_tokens ?? 0),
        total_tokens: Number(data.usage.total_tokens ?? 0),
      };
      // turn/end 是整轮累计用量；如果 assistant/message 已带最近一次
      // LLM 调用锚点，只更新 usage，不能把 last_call_usage 错写成累计值。
      message.token = {
        usage,
        last_call_usage: message.token?.last_call_usage ?? usage,
      };
    }
    this.dirty.add(message.id);
    message.seq = Math.max(message.seq ?? -1, event.seq);
  }

  // ─── 流式事件（客户端直播折叠；whole-value 覆盖后仅作历史）──────────

  private foldToolResultStart(event: SessionEvent): void {
    const data = (event.data ?? {}) as { tool_call_id?: string; name?: string };
    const toolCallId = String(data.tool_call_id ?? "");
    if (!toolCallId) return;
    const owner = this.ownerOf(toolCallId);
    if (!owner) return;
    const message = this.messagesById.get(owner)!;
    if (findBlock<WireToolResultBlock>(message, "tool_result", toolCallId)) return;
    message.content.push({
      type: "tool_result",
      id: toolCallId,
      name: String(data.name ?? ""),
      output: [],
      state: "running",
      metadata: {},
      created_at: isoFromMs(event.time || 0),
    });
    this.dirty.add(message.id);
    message.seq = Math.max(message.seq ?? -1, event.seq);
  }

  private foldApprovalAsked(event: SessionEvent): void {
    const data = (event.data ?? {}) as {
      tool_call_id?: string;
      reason?: string;
      rule_id?: string | null;
    };
    const toolCallId = String(data.tool_call_id ?? "");
    if (!toolCallId) return;
    const owner = this.ownerOf(toolCallId);
    if (!owner) return;
    const message = this.messagesById.get(owner)!;
    const call = findBlock<WireToolCallBlock>(message, "tool_call", toolCallId);
    if (!call) return;
    call.state = "asking";
    this.askContext.set(toolCallId, {
      reason: typeof data.reason === "string" ? data.reason : undefined,
      ruleId: typeof data.rule_id === "string" ? data.rule_id : undefined,
    });
    this.dirty.add(message.id);
    message.seq = Math.max(message.seq ?? -1, event.seq);
  }

  private foldChunk(event: SessionEvent): void {
    const data = (event.data ?? {}) as AssistantChunkData;
    if (data.kind === "tool_input") return; // 参数不流式上 wire（F41 附录 A-7）
    if (data.kind === "text" || data.kind === "thinking") {
      if (!event.message_id) return;
      const blockId = typeof data.block_id === "string" && data.block_id
        ? data.block_id
        : `assistant_${data.kind}_${event.message_id}`;
      const message = this.ensureAssistant(event.message_id, event.time || 0, event.seq);
      const block = message.content.find(
        (item) => item.type === data.kind && item.id === blockId,
      ) as { type: "text" | "thinking"; id: string; text?: string; thinking?: string } | undefined;
      if (block) {
        if (data.kind === "text") block.text = (block.text ?? "") + (data.delta ?? "");
        else block.thinking = (block.thinking ?? "") + (data.delta ?? "");
      } else {
        message.content.push(
          data.kind === "text"
            ? { type: "text", id: blockId, text: data.delta ?? "", created_at: isoFromMs(event.time || 0) }
            : { type: "thinking", id: blockId, thinking: data.delta ?? "", created_at: isoFromMs(event.time || 0) },
        );
      }
      this.dirty.add(message.id);
      message.seq = Math.max(message.seq ?? -1, event.seq);
      return;
    }
    if (data.kind === "tool_result_text") {
      const toolCallId = String(data.tool_call_id ?? "");
      if (!toolCallId) return;
      const owner = this.ownerOf(toolCallId);
      if (!owner) return;
      const message = this.messagesById.get(owner)!;
      let result = findBlock<WireToolResultBlock>(message, "tool_result", toolCallId);
      if (!result) {
        result = {
          type: "tool_result",
          id: toolCallId,
          name: "",
          output: [],
          state: "running",
          metadata: {},
          created_at: isoFromMs(event.time || 0),
        };
        message.content.push(result);
      }
      if (!Array.isArray(result.output)) result.output = [];
      const parts = result.output as Array<{
        type?: string;
        text?: string;
        id?: string;
        created_at?: string;
      }>;
      const last = parts[parts.length - 1];
      if (last && last.type === "text") {
        last.text = String(last.text ?? "") + (data.delta ?? "");
      } else {
        parts.push({
          type: "text",
          id: `tool_result_${toolCallId}_text`,
          text: data.delta ?? "",
          created_at: isoFromMs(event.time || 0),
        });
      }
      this.dirty.add(message.id);
      message.seq = Math.max(message.seq ?? -1, event.seq);
    }
  }

  // ─── 内部 ──────────────────────────────────────────────────────────

  /** 真实用户消息到达时封口上一条未完成 assistant（steering/新轮边界，同 derive）。 */
  private sealPreviousAssistant(timeMs: number, eventSeq = -1): void {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const message = this.messagesById.get(this.order[i])!;
      if (message.role === "assistant") {
        if (message.finished_at == null) {
          message.finished_at = isoFromMs(timeMs);
          message.finished_reason = "completed";
          message.seq = Math.max(message.seq ?? -1, eventSeq);
          this.dirty.add(message.id);
        }
        return;
      }
      if (message.role === "user") return;
    }
  }

  private ensureAssistant(messageId: string, createdMs: number, eventSeq = -1): WireMsg {
    const existing = this.messagesById.get(messageId);
    if (existing) {
      existing.seq = Math.max(existing.seq ?? -1, eventSeq);
      return existing;
    }
    const message: WireMsg = {
      id: messageId,
      name: "default",
      role: "assistant",
      content: [],
      metadata: {},
      created_at: isoFromMs(createdMs),
      seq: eventSeq,
      finished_at: null,
      finished_reason: null,
    };
    this.insert(message);
    return message;
  }

  private ownerOf(toolCallId: string): string | undefined {
    const indexed = this.toolCallOwner.get(toolCallId);
    if (indexed) return indexed;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const candidate = this.messagesById.get(this.order[i])!;
      if (candidate.role !== "assistant") continue;
      if (findBlock<WireToolCallBlock>(candidate, "tool_call", toolCallId)) {
        return candidate.id;
      }
    }
    return undefined;
  }

  private indexToolCalls(message: WireMsg): void {
    for (const block of message.content) {
      if (block.type === "tool_call") {
        this.toolCallOwner.set((block as WireToolCallBlock).id, message.id);
      }
    }
  }
}
