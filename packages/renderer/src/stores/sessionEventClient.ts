/**
 * SessionEventClient —— per-session 事件消费客户端（PRD-F42 FR2）。
 *
 * 职责：
 * - 持有 ConversationAssembler + lastSeq 游标；
 * - 直播事件按 seq 顺序消费；检测跳号时缓冲直播帧，并通过
 *   `GET /api/sessions/:id/events?after_seq=` 分页补齐（断线精确恢复）；
 * - `session/subscribed{last_seq}` 基线比对：落后 → tail-page 追平；
 *   服务端日志落后本地（重建/回退）→ 通知调用方全量重载；
 * - seedHistory：HTTP /messages 的 fold 结果作为基线种子（含 in-flight
 *   流式消息保留与 paused 确认卡合成）；
 * - msgToChatMessage：WireMsg → ChatMessage 的唯一投影（直播流与
 *   seedHistory 历史路径共用规则）。
 */
import { API_BASE, type SessionMessage } from "@/services/api";
import type { ChatMessage, ContentBlock, MessageAttachment, ToolResult } from "./chatTypes";
import {
  ConversationAssembler,
  type AskContext,
} from "./conversationAssembler";
import type { SessionEvent, WireMsg, WireToolCallBlock, WireToolResultBlock } from "@/types/wire.gen";

const TAIL_PAGE_LIMIT = 500;
const CATCH_UP_MAX_ATTEMPTS = 5;
const CATCH_UP_MAX_ROUNDS = 200;

// ─── HTTP tail-page ──────────────────────────────────────────────────

export interface SessionEventsPage {
  events: SessionEvent[];
  has_more: boolean;
  last_seq: number;
}

export type SessionEventsFetcher = (
  sessionId: string,
  afterSeq: number,
  limit: number,
) => Promise<SessionEventsPage | null>;

/** GET /api/sessions/:id/events?after_seq=&limit= —— seq > after_seq 的分页事件。 */
export const fetchSessionEventsPage: SessionEventsFetcher = async (
  sessionId,
  afterSeq,
  limit,
) => {
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`
        + `/events?after_seq=${afterSeq}&limit=${limit}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      events: Array.isArray(data?.events) ? data.events : [],
      has_more: data?.has_more === true,
      last_seq: typeof data?.last_seq === "number" ? data.last_seq : -1,
    };
  } catch {
    return null;
  }
};

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
  /** 异步 tail-page 追平（或放弃）后回调；供 bucket 投影 + store mirror。 */
  onSettled?: () => void;
  /** 注入 fetch 便于单测；缺省走 HTTP。 */
  fetchPage?: SessionEventsFetcher;
}

/**
 * 一个 session 的事件消费客户端：seq 游标 + 跳号缓冲 + tail-page 补齐。
 *
 * 顺序保证：事件总是按 seq 严格递增地进入 assembler；跳号时直播帧入缓冲，
 * 补齐后按序合并消费（F42 FR2），保证 fold 等价于服务端 derive。
 */
export class SessionEventClient {
  public readonly assembler = new ConversationAssembler();
  private buffer: SessionEvent[] = [];
  private catchingUp = false;
  private readonly options: SessionEventClientOptions;
  private readonly fetchPage: SessionEventsFetcher;

  constructor(options: SessionEventClientOptions) {
    this.options = options;
    this.fetchPage = options.fetchPage ?? fetchSessionEventsPage;
  }

  get lastSeq(): number {
    return this.assembler.lastSeq;
  }

  /** 消费一个直播/补齐事件（幂等：seq ≤ lastSeq 跳过；跳号入缓冲）。 */
  ingest(event: SessionEvent): void {
    if (!event || typeof event.type !== "string") return;
    const seq = typeof event.seq === "number" ? event.seq : -1;
    if (seq >= 0 && seq <= this.assembler.lastSeq) return;
    if (seq >= 0 && seq > this.assembler.lastSeq + 1) {
      this.buffer.push(event);
      this.buffer.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
      this.scheduleCatchUp();
      return;
    }
    this.assembler.append(event);
    this.drainBuffer();
  }

  /**
   * attach 基线比对。
   * - "behind"：本地落后 → 已启动 tail-page 追平；
   * - "ahead"：服务端日志落后本地（Gateway 重建/回退）→ 调用方应全量重载；
   * - "current"：已同步。
   */
  onSubscribed(serverLastSeq: number): "current" | "behind" | "ahead" {
    if (typeof serverLastSeq !== "number" || serverLastSeq < 0) return "current";
    const local = this.assembler.lastSeq;
    if (serverLastSeq > local) {
      this.scheduleCatchUp();
      return "behind";
    }
    if (serverLastSeq < local) return "ahead";
    return "current";
  }

  /**
   * 用 HTTP /messages 的 fold 结果重建基线：
   * - seeds 成为 assembler 状态（tool_call 配对索引随种子建立）；
   * - 游标设为响应 last_seq（绝对值）；
   * - 服务端快照已包含截至 lastSeq 的 in-flight chunk；仅在本地仍有而快照
   *   尚未覆盖的消息时保留它们；
   * - paused 会话合成确认卡。
   */
  seedHistory(seeds: WireMsg[], lastSeq: number): void {
    const previousCursor = this.assembler.lastSeq;
    const inFlight = previousCursor >= 0 && lastSeq >= previousCursor
      ? this.assembler.takeInflightAssistants()
      : [];
    this.assembler.reset(seeds);
    this.assembler.lastSeq = Number.isFinite(lastSeq) ? lastSeq : -1;
    const seedIds = new Set(seeds.map((message) => message.id));
    for (const message of inFlight) {
      if (!seedIds.has(message.id)) this.assembler.insert(message);
    }
    this.assembler.synthesizePausedAsking();
    // 基线之前的缓冲作废；之后的直播事件保留待 drain。
    this.buffer = this.buffer.filter((event) =>
      typeof event.seq === "number" && event.seq > this.assembler.lastSeq);
  }

  private drainBuffer(): void {
    while (this.buffer.length > 0) {
      const head = this.buffer[0];
      const seq = typeof head.seq === "number" ? head.seq : -1;
      if (seq >= 0 && seq > this.assembler.lastSeq + 1) return;
      this.buffer.shift();
      if (seq >= 0 && seq <= this.assembler.lastSeq) continue;
      this.assembler.append(head);
    }
  }

  private hasBufferedGap(): boolean {
    if (this.buffer.length === 0) return false;
    const head = this.buffer[0];
    const seq = typeof head.seq === "number" ? head.seq : -1;
    return seq >= 0 && seq > this.assembler.lastSeq + 1;
  }

  private scheduleCatchUp(): void {
    if (this.catchingUp) return;
    this.catchingUp = true;
    void this.runCatchUp()
      .catch(() => undefined)
      .finally(() => {
        this.catchingUp = false;
        this.options.onSettled?.();
      });
  }

  /** tail-page 分页循环：从本地 lastSeq 起补齐到服务端末尾（含缓冲合并）。 */
  private async runCatchUp(): Promise<void> {
    let failures = 0;
    for (let round = 0; round < CATCH_UP_MAX_ROUNDS; round++) {
      const page = await this.fetchPage(
        this.options.sessionId,
        this.assembler.lastSeq,
        TAIL_PAGE_LIMIT,
      );
      if (!page) {
        failures += 1;
        if (failures >= CATCH_UP_MAX_ATTEMPTS) return;
        await new Promise((resolve) => setTimeout(resolve, 800 * failures));
        continue;
      }
      failures = 0;
      for (const event of page.events) {
        this.ingest(event);
      }
      this.drainBuffer();
      if (!page.has_more && !this.hasBufferedGap()) return;
    }
  }
}
