/**
 * SessionEventClient —— per-session 事件消费客户端（PRD-F42/F44）。
 *
 * 职责：
 * - 持有 ConversationAssembler + seq 水位；
 * - attach 响应直接携带基线之后的 Event[]，按 seq fold 成 Msg；
 * - 直播事件按 seq 顺序消费；检测跳号时请求调用方重新 attach；
 * - seedHistory：HTTP /messages 的 Msg 结果作为基线种子（含 in-flight
 *   流式消息保留与 paused 确认卡合成）；
 * - msgToChatMessage：WireMsg → ChatMessage 的唯一投影（直播流与
 *   seedHistory 历史路径共用规则）。
 */
import type { SessionMessage } from "@/services/api";
import type { ChatMessage, ContentBlock, MessageAttachment, ToolResult } from "./chatTypes";
import {
  ConversationAssembler,
  type AskContext,
} from "./conversationAssembler";
import type { SessionEvent, WireMsg, WireToolCallBlock, WireToolResultBlock } from "@/types/wire.gen";

// ─── WireMsg ← HTTP 持久化记录 ───────────────────────────────────────

/** SessionMessage（/messages 记录）→ WireMsg（fold 种子）。 */
export function wireMsgFromSessionMessage(record: SessionMessage): WireMsg {
  return {
    id: record.id,
    name: record.name,
    role: record.role,
    content: (Array.isArray(record.content)
      ? [...record.content]
      : []) as WireMsg["content"],
    metadata: record.metadata ?? {},
    created_at: record.created_at,
    token: record.token ?? null,
    finished_at: record.finished_at ?? null,
    seq: Number.isFinite(record.seq) ? record.seq : -1,
    finished_reason: record.finished_reason ?? null,
    structured_output: record.structured_output ?? null,
    error: record.error ?? null,
  };
}

// ─── WireMsg → ChatMessage 投影 ──────────────────────────────────────

function toolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.every((part) => part?.type === "text")) {
    return output.map((part) => String(part.text ?? "")).join("");
  }
  return JSON.stringify(output ?? "", null, 2);
}

function extractText(blocks: ContentBlock[]): string {
  let text = "";
  for (const block of blocks) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function userContentText(parts: WireMsg["content"]): string {
  return parts
    .filter((part) => part?.type === "text" || part?.type === "skill")
    .map((part) => String((part as { text?: string; data?: unknown }).text
      ?? (part as { data?: unknown }).data ?? "").trim())
    .join("\n")
    .trim();
}

function userAttachments(parts: WireMsg["content"]): MessageAttachment[] {
  return parts.flatMap((part) => {
    if (part?.type !== "data") return [];
    const source = (part as {
      source?: { type?: string; data?: string; url?: string; media_type?: string };
      name?: string | null;
    }).source;
    if (!source) return [];
    const url = source.type === "base64"
      ? `data:${source.media_type ?? "application/octet-stream"};base64,${source.data ?? ""}`
      : source.url ?? null;
    return url
      ? [{
          type: "image" as const,
          url,
          mime: source.media_type,
          name: (part as { name?: string | null }).name ?? undefined,
        }]
      : [];
  });
}

/**
 * WireMsg → ChatMessage（唯一投影）。
 *
 * - user(name=compact) / assistant(name=compact_fast) → 压缩气泡（与
 *   stores/session.ts 持久化路径的形状一致，刷新不产生双气泡）；
 * - hide 用户消息返回 null（由事件层做隐藏图片挂接特例）；
 * - tool_call asking 态用 askContext 补确认上下文（reason 未持久化时用通用文案）。
 */
export function msgToChatMessage(
  msg: WireMsg,
  askContext?: ReadonlyMap<string, AskContext>,
): ChatMessage | null {
  if (!msg || !msg.id) return null;
  const timestamp = parseTimestamp(msg.created_at) ?? Date.now();

  if (msg.role === "user" && msg.name === "compact") {
    const compactMeta = (msg.metadata?.context_compact ?? {}) as Record<string, unknown>;
    const summaryText = msg.content
      .filter((block) => block.type === "text")
      .map((block) => String((block as { text?: string }).text ?? ""))
      .join("\n");
    return {
      id: msg.id,
      role: "system",
      content: null,
      timestamp,
      compact: {
        status: "done",
        mode: "summary",
        tokensBefore: typeof compactMeta.tokens_before === "number" ? compactMeta.tokens_before : undefined,
        tokensAfter: typeof compactMeta.tokens_after === "number" ? compactMeta.tokens_after : undefined,
        summaryPreview: summaryText || undefined,
      },
    };
  }
  if (msg.name === "compact_fast") {
    const compactMeta = (msg.metadata?.context_compact ?? {}) as Record<string, unknown>;
    return {
      id: msg.id,
      role: "system",
      content: null,
      timestamp,
      compact: {
        status: "done",
        mode: "fast",
        tokensBefore: typeof compactMeta.tokens_before === "number" ? compactMeta.tokens_before : undefined,
        tokensAfter: typeof compactMeta.tokens_after === "number" ? compactMeta.tokens_after : undefined,
        toolResults: typeof compactMeta.tool_results === "number" ? compactMeta.tool_results : undefined,
      },
    };
  }
  if (msg.role === "user") {
    const metadata = msg.metadata ?? {};
    if (metadata.hide === true) return null;
    const attachments = userAttachments(msg.content);
    return {
      id: msg.id,
      role: "user",
      content: userContentText(msg.content),
      timestamp,
      metadata,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }
  if (msg.role !== "assistant") return null;

  const blocks: ContentBlock[] = [];
  const toolResults: Record<string, ToolResult> = {};
  for (const block of msg.content) {
    if (block?.type === "text") {
      blocks.push({ type: "text", text: String(block.text ?? ""), blockId: String(block.id ?? "") });
    } else if (block?.type === "thinking") {
      blocks.push({ type: "thinking", thinking: String(block.thinking ?? ""), blockId: String(block.id ?? "") });
    } else if (block?.type === "data" && (block as { source?: unknown }).source) {
      const source = (block as { source: { type?: string; data?: string; url?: string; media_type?: string } }).source;
      blocks.push({
        type: "data",
        data: String(source.data ?? ""),
        url: source.type === "url" ? source.url : undefined,
        mediaType: source.media_type ?? "application/octet-stream",
        blockId: String(block.id ?? ""),
      });
    } else if (block?.type === "tool_call") {
      const call = block as WireToolCallBlock;
      const id = String(call.id ?? "");
      const existingIndex = id
        ? blocks.findIndex((item) => item.type === "toolCall" && item.id === id)
        : -1;
      if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        if (existing.type === "toolCall" && !existing.name && call.name) {
          blocks[existingIndex] = { ...existing, name: String(call.name) };
        }
      } else {
        blocks.push({
          type: "toolCall",
          id,
          name: String(call.name ?? ""),
          arguments: call.arguments && typeof call.arguments === "object"
            ? call.arguments as Record<string, unknown>
            : {},
        });
      }
      // asking：无配对 tool_result，合成确认卡（whole-value 恢复路径）。
      if (id && call.state === "asking") {
        const context = askContext?.get(id);
        toolResults[id] = {
          id,
          name: String(call.name ?? ""),
          result: null,
          error: null,
          status: "asking",
          confirm: context
            ? { reason: context.reason, ruleId: context.ruleId }
            : {},
        };
      } else if (id && call.state === "finished") {
        // 批量确认尚未全部完成时，已拒绝调用只有 finished 状态。
        toolResults[id] = {
          id,
          name: String(call.name ?? ""),
          result: null,
          error: null,
          status: "denied",
        };
      }
    } else if (block?.type === "tool_result") {
      const result = block as WireToolResultBlock;
      const state = String(result.state ?? "success");
      const failed = state === "error" || state === "interrupted";
      const denied = state === "denied";
      const id = String(result.id ?? "");
      toolResults[id] = {
        id,
        name: String(result.name ?? ""),
        result: failed || denied ? null : toolOutputText(result.output),
        error: failed ? toolOutputText(result.output) : null,
        status: state === "running"
          ? "running"
          : denied
            ? "denied"
            : state === "interrupted"
              ? "cancelled"
              : failed ? "error" : "completed",
        metadata: result.metadata as ToolResult["metadata"],
      };
    }
    // hint 块不进入可见 blocks（注入上下文用）。
  }

  const text = extractText(blocks);
  const metadata = msg.metadata ?? {};
  const external = metadata.external === true;
  const fromChannel = String(metadata.from_channel ?? "");
  const fromSession = String(metadata.from_session ?? "");
  const finishedAt = parseTimestamp(msg.finished_at) ?? undefined;
  return {
    id: msg.id,
    role: "assistant",
    content: text || null,
    timestamp,
    blocks,
    toolResults,
    streaming: msg.finished_at == null,
    metadata,
    model: typeof metadata.model === "string" ? metadata.model : undefined,
    token: msg.token ?? undefined,
    finishedAt,
    isError: msg.finished_reason === "error" || !!msg.error,
    error: msg.error && typeof msg.error.message === "string"
      ? {
          code: typeof msg.error.code === "string" ? msg.error.code : undefined,
          message: msg.error.message,
        }
      : undefined,
    external,
    externalFrom: external && (fromChannel || fromSession)
      ? `${fromChannel}::${fromSession}`
      : undefined,
  };
}

// ─── SessionEventClient ──────────────────────────────────────────────

export interface SessionEventClientOptions {
  sessionId: string;
  /** attach 事件处理完成后回调；供 bucket 投影 + store mirror。 */
  onSettled?: () => void;
  /** attach 期间每个按 seq 接受的事件；用于恢复会话状态机。 */
  onAttachEvent?: (event: SessionEvent) => void;
  /** attach 无法补齐旧事件时，重新走 HTTP /messages。 */
  onResyncRequired?: () => void;
  /** 直播出现跳号时，调用方重新发送 attach。 */
  onGap?: () => void;
}

/**
 * 一个 session 的事件消费客户端：seq 水位 + 跳号缓冲 + attach 补齐。
 *
 * 顺序保证：事件总是按 seq 严格递增地进入 assembler；跳号时直播帧入缓冲，
 * 补齐后按序合并消费（F42 FR2），保证 fold 等价于服务端 derive。
 */
export class SessionEventClient {
  public readonly assembler = new ConversationAssembler();
  private buffer: SessionEvent[] = [];
  private attachRequested = false;
  private readonly options: SessionEventClientOptions;

  constructor(options: SessionEventClientOptions) {
    this.options = options;
  }

  get lastSeq(): number {
    return this.assembler.lastSeq;
  }

  /** 消费一个直播/补齐事件（幂等：seq ≤ lastSeq 跳过；跳号入缓冲）。 */
  ingest(event: SessionEvent, onAccepted?: (event: SessionEvent) => void): void {
    if (!event || typeof event.type !== "string") return;
    const seq = typeof event.seq === "number" ? event.seq : -1;
    if (seq >= 0 && seq <= this.assembler.lastSeq) return;
    if (seq >= 0 && seq > this.assembler.lastSeq + 1) {
      this.buffer.push(event);
      this.buffer.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
      this.requestAttach();
      return;
    }
    this.appendAccepted(event, onAccepted);
    this.drainBuffer(onAccepted);
  }

  /** 消费 attach 返回的原始 Event[]，然后继续等待直播事件。 */
  applyAttach(events: SessionEvent[], serverSeq: number, resyncRequired = false): void {
    this.attachRequested = false;
    if (resyncRequired) {
      this.options.onResyncRequired?.();
      return;
    }
    for (const event of events) this.ingest(event, this.options.onAttachEvent);
    this.drainBuffer(this.options.onAttachEvent);
    if (Number.isFinite(serverSeq) && this.assembler.lastSeq < serverSeq) {
      this.requestAttach();
    }
    this.options.onSettled?.();
  }

  /**
   * 用 HTTP /messages 的 fold 结果重建基线：
   * - seeds 成为 assembler 状态（tool_call 配对索引随种子建立）；
   * - seq 设为响应 seq（绝对值）；
   * - 服务端 Msg 快照已包含截至该 seq 的 in-flight chunk；仅在本地仍有而快照
   *   尚未覆盖的消息时保留它们；
   * - paused 会话合成确认卡。
   */
  seedHistory(seeds: WireMsg[], seq: number): void {
    const previousCursor = this.assembler.lastSeq;
    const cursorRolledBack = previousCursor >= 0
      && (!Number.isFinite(seq) || seq < previousCursor);
    const inFlight = previousCursor >= 0 && seq >= previousCursor
      ? this.assembler.takeInflightAssistants()
      : [];
    this.assembler.reset(seeds);
    // reset() marks all seed messages dirty because it is also used for live
    // inserts. HTTP/Snapshot callers already supplied the projected messages;
    // replaying those seed rows would replace UI-only fields (for example
    // persisted durationSec) and create needless renders.
    this.assembler.takeDirty();
    this.assembler.lastSeq = Number.isFinite(seq) ? seq : -1;
    const seedIds = new Set(seeds.map((message) => message.id));
    for (const message of inFlight) {
      if (!seedIds.has(message.id)) this.assembler.insert(message);
    }
    this.assembler.synthesizePausedAsking();
    // 基线之前的缓冲作废；之后的直播事件保留待 drain。
    // A cursor rollback means a new Gateway lifecycle. Buffered events belong
    // to the old lifecycle and must never be folded after the new Snapshot.
    this.buffer = cursorRolledBack
      ? []
      : this.buffer.filter((event) =>
        typeof event.seq === "number" && event.seq > this.assembler.lastSeq);
    if (this.buffer.length > 0) {
      this.drainBuffer();
      if (this.hasBufferedGap()) this.requestAttach();
    }
  }

  private appendAccepted(
    event: SessionEvent,
    onAccepted?: (event: SessionEvent) => void,
  ): void {
    const previous = this.assembler.lastSeq;
    this.assembler.append(event);
    if (this.assembler.lastSeq > previous) onAccepted?.(event);
  }

  private drainBuffer(onAccepted?: (event: SessionEvent) => void): void {
    while (this.buffer.length > 0) {
      const head = this.buffer[0];
      const seq = typeof head.seq === "number" ? head.seq : -1;
      if (seq >= 0 && seq > this.assembler.lastSeq + 1) return;
      this.buffer.shift();
      if (seq >= 0 && seq <= this.assembler.lastSeq) continue;
      this.appendAccepted(head, onAccepted);
    }
  }

  private hasBufferedGap(): boolean {
    if (this.buffer.length === 0) return false;
    const head = this.buffer[0];
    const seq = typeof head.seq === "number" ? head.seq : -1;
    return seq >= 0 && seq > this.assembler.lastSeq + 1;
  }

  private requestAttach(): void {
    if (this.attachRequested) return;
    this.attachRequested = true;
    this.options.onGap?.();
  }
}
