/**
 * Session Chat projection reducer.
 *
 * 这里集中处理 Gateway 的历史/流式/队列事实，把 Zustand store 只留作
 * session bucket 生命周期和 UI 操作。Reducer 不依赖 React，便于单测和重连复用。
 */
import { API_BASE } from "@/services/api";
import {
  CompactEventName,
  UserMessageEventType,
  type QueueItemView,
  type QueueSnapshotPayload,
  type ReplySnapshotPayload,
} from "@/services/websocket-client";
import type { ChatMessage, ContentBlock, MessageAttachment, Role, ToolResult } from "./chatTypes";
import type { SessionProjectionState } from "./clientSessionProjection";

const MAX_SEEN_EVENT_IDS = 10_000;
let messageSequence = 0;
const nextId = (prefix = "msg") => `${prefix}_${Date.now()}_${++messageSequence}`;
const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

function appendBase64Chunk(current: string, incoming: string): string {
  if (!current) return incoming;
  if (!incoming) return current;
  try {
    return btoa(atob(current) + atob(incoming));
  } catch {
    return current + incoming;
  }
}

function extractFromBlocks(blocks: ContentBlock[]): { text: string } {
  let text = "";
  for (const block of blocks) if (block.type === "text") text += block.text;
  return { text };
}

function toolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.every((part) => part?.type === "text")) {
    return output.map((part) => String(part.text ?? "")).join("");
  }
  return JSON.stringify(output ?? "", null, 2);
}

function toMessageAttachments(raw: unknown): MessageAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): MessageAttachment[] => {
    if (!item || typeof item !== "object") return [];
    const attachment = item as Record<string, unknown>;
    if (attachment.type !== "image" || typeof attachment.mime_type !== "string") return [];
    const data = attachment.data;
    const path = attachment.path;
    const url = typeof data === "string"
      ? `data:${attachment.mime_type};base64,${data}`
      : typeof path === "string"
        ? `${API_BASE}/api/images/${encodeURIComponent(path.split(/[\\/]/).pop() || path)}`
        : "";
    if (!url) return [];
    return [{
      type: "image",
      url,
      mime: attachment.mime_type,
      name: typeof attachment.name === "string" ? attachment.name : undefined,
      bytes: typeof data === "string" ? Math.floor(data.length * 0.75) : undefined,
    }];
  });
}

function canonicalRequestId(requestId: string): string {
  return requestId.startsWith("local:") ? requestId.slice("local:".length) : requestId;
}

/** 将 ftre-inbox 的权威 session/queue 投影为队列横幅数据。 */
export function applyQueueSnapshot(
  b: SessionProjectionState,
  payload: QueueSnapshotPayload,
  operationRequestId?: string,
): void {
  const acknowledgedRequestId = operationRequestId
    ? canonicalRequestId(operationRequestId)
    : null;
  // 操作响应的 request_id 是独立于 revision 的结算事实。后台广播可能先到，
  // 让后续操作响应因 revision 较旧而被丢弃；即使如此，也必须清掉对应的
  // 本地 optimistic 预览，不能让已处理消息永久留在队列横幅中。
  if (acknowledgedRequestId) {
    b.pendingMessages = (b.pendingMessages ?? []).filter(
      (item) => !item.optimistic
        || canonicalRequestId(item.request_id) !== acknowledgedRequestId,
    );
    b.queueDepth = (b.pendingMessages ?? []).length;
  }
  // revision 属于 Inbox 持久化状态，不再用客户端收到帧的顺序猜测新旧。
  // 操作响应和后台广播可能乱序，旧 revision 必须完全丢弃。
  const revision = payload.revision;
  if (revision <= (b.sessionRevision ?? -1)) return;
  const pending = payload.items.map((item, index): QueueItemView => ({
    request_id: item.id,
    sequence: index + 1,
    placement: item.placement,
    content: item.message.content.map((part) => part.text).join(""),
    attachments: item.message.attachments,
    source: item.placement === "context" ? "plugin" : "user",
    // 只要 item 仍在服务端 pending，就显示真实 placement；queue response 只表示已落盘，
    // 不能把尚未 claim 的消息误标成“正在消费”。离开 pending 后立即移除，
    // USER_MESSAGE 随后只负责进入 MessageList。
  }));
  // 网络上可能先到达旧快照，而刚点发送的本地请求尚未收到 queue response。
  // 只保留尚未确认的本地 request_id，已确认项目完全以后端 pending 为准。
  const serverRequestIds = new Set(
    pending
      .map((item) => canonicalRequestId(item.request_id))
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  // 操作响应携带 request_id，表示这个本地发送已经由 Inbox 结算。
  // 如果 Agent 在响应生成前就 claim 了消息，快照会直接是空数组；此时
  // 不能再把对应 optimistic 项当成“尚未确认”保留下来。没有 request_id
  // 的后台广播仍不能猜测本地 outbox 是否已经送达，因此继续保留它。
  const awaitingAdmission = (b.pendingMessages ?? []).filter((item) => (
    item.optimistic
    && canonicalRequestId(item.request_id) !== acknowledgedRequestId
    && !serverRequestIds.has(canonicalRequestId(item.request_id))
  ));
  // Queue snapshot 是 claim 的权威事实。已消费项不能继续以“正在消费”占位
  // 留在队列横幅，否则用户会看到队列未清理；USER_MESSAGE 到达后再进入消息列表。
  const pendingMessages = [...pending, ...awaitingAdmission];
  const queueDepth = pending.length + awaitingAdmission.length;
  b.hasCoordinatorState = true;
  b.sessionRevision = revision;
  b.queueDepth = queueDepth;
  // Inbox snapshot 不包含容量和 active 状态；这些字段由本地配置和 session/status
  // 分别维护，队列事件只能替换 pending 事实。
  b.queueCapacity = b.queueCapacity ?? null;
  // 已接纳项目完全以后端 Inbox items 为准；尚未收到 queue response 的本地预览仅暂存于
  // 横幅，直到被同 request_id 的服务端项替换。它们绝不进入聊天 messages。
  b.pendingMessages = pendingMessages;
  b.clientCanSend = b.clientCanSend ?? true;
  b.canCancel = b.canCancel ?? false;
  b.blockedReason = b.blockedReason ?? null;
  b.isBusy = b.isBusy || queueDepth > 0;
  if (b.sessionStatus === "idle" && queueDepth === 0) {
    b.isBusy = false;
    b.commandName = null;
    b.turnStartTs = null;
  }
}

function replySnapshotToChatMessage(raw: any): ChatMessage | null {
  if (!raw || raw.role !== "assistant" || !Array.isArray(raw.content) || !raw.id) {
    return null;
  }
  const blocks: ContentBlock[] = [];
  const toolResults: Record<string, ToolResult> = {};
  for (const block of raw.content) {
    if (block?.type === "text") {
      blocks.push({ type: "text", text: String(block.text ?? ""), blockId: String(block.id ?? "") });
    } else if (block?.type === "thinking") {
      blocks.push({ type: "thinking", thinking: String(block.thinking ?? ""), blockId: String(block.id ?? "") });
    } else if (block?.type === "data" && block.source) {
      blocks.push({
        type: "data",
        data: String(block.source.data ?? ""),
        url: block.source.type === "url" ? block.source.url : undefined,
        mediaType: block.source.media_type ?? "application/octet-stream",
        blockId: String(block.id ?? ""),
      });
    } else if (block?.type === "tool_call") {
      const id = String(block.id ?? "");
      const existingIndex = id
        ? blocks.findIndex((item) => item.type === "toolCall" && item.id === id)
        : -1;
      if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        if (existing.type === "toolCall" && !existing.name && block.name) {
          blocks[existingIndex] = { ...existing, name: String(block.name) };
        }
      } else {
        blocks.push({
          type: "toolCall",
          id,
          name: String(block.name ?? ""),
          arguments: block.arguments && typeof block.arguments === "object" ? block.arguments : {},
        });
      }
      // 待确认工具调用（state==="asking"）在快照里没有配对 tool_result，
      // 合成一个 asking ToolResult，让确认卡片在刷新/重连后仍可渲染。
      // reason 未持久化，卡片用通用文案。
      if (block.state === "asking" && id) {
        toolResults[id] = {
          id,
          name: String(block.name ?? ""),
          result: null,
          error: null,
          status: "asking",
          confirm: {},
        };
      } else if (block.state === "finished" && id) {
        // 批量确认尚未全部完成时，已拒绝调用只有 finished 状态，
        // 配对的 denied 结果要等最后一个确认后才生成。
        toolResults[id] = {
          id,
          name: String(block.name ?? ""),
          result: null,
          error: null,
          status: "denied",
        };
      }
    } else if (block?.type === "tool_result") {
      const state = String(block.state ?? "success");
      const failed = ["error", "interrupted"].includes(state);
      const denied = state === "denied";
      const id = String(block.id ?? "");
      toolResults[id] = {
        id,
        name: String(block.name ?? ""),
        result: failed || denied ? null : toolOutputText(block.output),
        error: failed ? toolOutputText(block.output) : null,
        status: denied
          ? "denied"
          : state === "interrupted"
          ? "cancelled"
          : failed ? "error" : "completed",
        metadata: block.metadata,
      };
    }
  }
  const { text } = extractFromBlocks(blocks);
  const parsedTimestamp = typeof raw.created_at === "string" ? Date.parse(raw.created_at) : NaN;
  const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  return {
    id: String(raw.id),
    role: "assistant",
    content: text || null,
    timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(),
    blocks,
    toolResults,
    streaming: raw.finished_at == null,
    metadata,
    model: typeof metadata.model === "string" ? metadata.model : undefined,
    token: raw.token ?? undefined,
    isError: raw.finished_reason === "error" || !!raw.error,
    error: raw.error && typeof raw.error === "object" && typeof raw.error.message === "string"
      ? { code: typeof raw.error.code === "string" ? raw.error.code : undefined, message: raw.error.message }
      : undefined,
  };
}

/** 应用 attach/reconnect 的完整进行中 Msg 快照。 */
export function applyReplySnapshot(b: SessionProjectionState, payload: ReplySnapshotPayload): void {
  // 每次 WebSocket 重连都开始一个新的权威 revision 世代。Gateway 重启会重建
  // 内存计数，因此新连接快照不能继续与旧连接的 revision 比较；但同一连接内
  // 的重复快照仍然保持单调递增。
  const connectionEpoch = payload.client_connection_epoch;
  if (
    typeof connectionEpoch === "number"
    && connectionEpoch !== b.snapshotConnectionEpoch
  ) {
    b.snapshotConnectionEpoch = connectionEpoch;
    b.replyRevisions = new Map<string, number>();
    b.sessionRevision = -1;
  }

  const replies = payload.replies;
  const revisions = b.replyRevisions ?? (b.replyRevisions = new Map<string, number>());
  for (const reply of replies) {
    const replyId = reply.reply_id;
    const messageId = reply.message_id;
    const revision = reply.revision;
    const message = replySnapshotToChatMessage(reply.message);
    if (!replyId || !messageId || !message || !Number.isFinite(revision)) continue;
    // reply_id 关联整次运行，message_id 才是 MessageList 的唯一键；不能再按
    // reply_id 复用同一气泡，也不能在客户端派生 segment id。
    message.id = messageId;
    message.metadata = { ...(message.metadata ?? {}), reply_id: replyId };
    const previousRevision = revisions.get(messageId);
    if (previousRevision != null && revision <= previousRevision) continue;
    revisions.set(messageId, revision);

    const index = b.messages.findIndex((item) => item.id === messageId);
    if (index >= 0) {
      const next = b.messages.slice();
      next[index] = message;
      b.messages = next;
    } else {
      b.messages = [...b.messages, message].sort((a, z) => a.timestamp - z.timestamp);
    }
    if (!b.hasCoordinatorState) {
      b.isBusy = message.streaming || b.isBusy;
    }
    if (message.streaming) {
      if (!b.hasCoordinatorState) {
        b.sessionStatus = "running";
        b.sessionActivity = "executing";
        b.clientCanSend = true;
        b.canCancel = true;
      }
      if (b.turnStartTs == null) b.turnStartTs = message.timestamp;
    }
  }

  // session 级 active Event（例如 context_compact_start）同样由 Projection
  // 快照恢复。使用原 Event id 走正常 reducer，保证与实时帧使用相同去重语义。
  for (const event of payload.events ?? []) {
    if (!event?.type) continue;
    const snapshotEvent: BusEvent = {
      type: event.type,
      eventId: typeof event.id === "string" ? event.id : undefined,
      data: event,
      ts: typeof event.created_at === "string" ? Date.parse(event.created_at) : undefined,
    };
    if (hasSeenEvent(b, snapshotEvent)) continue;
    applyEvent(b, snapshotEvent);
  }

}



/** 褰?sid === activeId 鏃讹紝鎶?bucket 瀛楁闀滃儚鍒?store 椤跺眰銆?*/
export interface BusEvent {
  type: string;
  data?: any;
  ts?: number;
  eventId?: string;
  /** ws 实时下行帧的帧 ID（BusMessage.id），用于回放去重 */
  frameId?: string;
  /** ws 实时下行帧的 metadata；request_id 用于请求相关性和去重。 */
  metadata?: Record<string, any>;
}

function eventDedupKey(ev: BusEvent): string | null {
  const topLevel = ev.eventId;
  if (typeof topLevel === "string" && topLevel) return topLevel;
  return typeof ev.frameId === "string" && ev.frameId ? ev.frameId : null;
}

function seenEventIds(b: SessionProjectionState): Set<string> {
  if (!b.seenEventIds) b.seenEventIds = new Set<string>();
  return b.seenEventIds;
}

export function hasSeenEvent(b: SessionProjectionState, ev: BusEvent): boolean {
  const key = eventDedupKey(ev);
  return !!key && seenEventIds(b).has(key);
}

function rememberEvent(b: SessionProjectionState, ev: BusEvent): boolean {
  const key = eventDedupKey(ev);
  if (!key) return true;
  const seen = seenEventIds(b);
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > MAX_SEEN_EVENT_IDS) {
    const oldest = seen.values().next().value;
    if (typeof oldest === "string") seen.delete(oldest);
  }
  return true;
}

export function applyEvent(b: SessionProjectionState, ev: BusEvent): void {
  if (!rememberEvent(b, ev)) return;
  const d = ev.data || {};
  const ts = ev.ts ?? Date.now();
  const replyId = typeof d.reply_id === "string" && d.reply_id ? d.reply_id : null;
  const messageId = typeof d.message_id === "string" && d.message_id
    ? d.message_id
    : null;
  const messageEvents = new Set([
    "REPLY_START", "REPLY_END", "MODEL_CALL_START", "MODEL_CALL_END",
    "TEXT_BLOCK_START", "TEXT_BLOCK_DELTA", "TEXT_BLOCK_END",
    "THINKING_BLOCK_START", "THINKING_BLOCK_DELTA", "THINKING_BLOCK_END",
    "DATA_BLOCK_START", "DATA_BLOCK_DELTA", "DATA_BLOCK_END",
    "TOOL_CALL_START", "TOOL_CALL_DELTA", "TOOL_CALL_END",
    "TOOL_RESULT_START", "TOOL_RESULT_TEXT_DELTA", "TOOL_RESULT_DATA_DELTA",
    "TOOL_RESULT_END", "HINT_BLOCK", "REQUIRE_USER_CONFIRM", "RETRY", "retry",
    "EXCEED_MAX_ITERS",
  ]);
  // 新协议的 Assistant 事件必须携带 message_id；旧帧直接丢弃，避免把
  // 已删除的旧数据重新聚合进当前 MessageList。
  if (messageEvents.has(ev.type) && !messageId) return;

  /** 褰撳墠 streaming 灏鹃儴 assistant锛堣嫢瀛樺湪锛?*/
  const tail = (): ChatMessage | null => {
    const m = last(b.messages);
    return m && m.role === "assistant" && m.streaming && !m.isError ? m : null;
  };

  /** 鏇挎崲 tail锛堜繚鐣欏紩鐢ㄨ涔夛細mutator 鎷垮埌鐨勬槸鏂板璞★紝澶嶅埗鍘熷瓧娈碉級 */
  const replaceTail = (mut: (m: ChatMessage) => ChatMessage): void => {
    const i = b.messages.length - 1;
    if (i < 0) return;
    const next = b.messages.slice();
    next[i] = mut(next[i]);
    b.messages = next;
  };

  const replyMatches = (message: ChatMessage): boolean => (
    messageId != null
    && message.role === "assistant"
    && message.id === messageId
  );

  const activeReplyIndex = (): number => {
    if (messageId == null) return -1;
    for (let index = b.messages.length - 1; index >= 0; index--) {
      const message = b.messages[index];
      if (replyMatches(message) && message.streaming === true && !message.isError) {
        return index;
      }
    }
    return -1;
  };

  const replyIndex = (): number => {
    const active = activeReplyIndex();
    if (active >= 0) return active;
    if (messageId == null) return -1;
    for (let index = b.messages.length - 1; index >= 0; index--) {
      if (replyMatches(b.messages[index])) return index;
    }
    return -1;
  };

  const replaceReply = (mut: (m: ChatMessage) => ChatMessage): void => {
    const index = replyIndex();
    if (index < 0) return;
    const next = b.messages.slice();
    next[index] = mut(next[index]);
    b.messages = next;
  };

  /** 确保尾部存在可写的流式 assistant；不存在或已经封口时创建一条。 */
  const ensure = (): void => {
    if (activeReplyIndex() >= 0) return;
    // Core 已经用新的 message_id 宣布了下一条 AssistantMsg。此时只封口同
    // reply 下仍显示 streaming 的旧消息，不复制内容、不生成客户端 segment。
    if (replyId != null && messageId != null) {
      const previousIndex = b.messages.findIndex((message) => (
        message.role === "assistant"
        && message.id !== messageId
        && message.metadata?.reply_id === replyId
        && message.streaming === true
      ));
      if (previousIndex >= 0) {
        const next = b.messages.slice();
        next[previousIndex] = { ...next[previousIndex], streaming: false };
        b.messages = next;
      }
    }
    const id = messageId ?? ev.eventId ?? ev.frameId ?? nextId("ast");
    b.messages = [
      ...b.messages,
      {
        id,
        role: "assistant",
        content: null,
        timestamp: ts,
        streaming: true,
        blocks: [],
        toolResults: {},
        ...(replyId != null ? { metadata: { reply_id: replyId } } : {}),
      },
    ];
  };

  const appendTextBlock = (
    kind: "text" | "thinking",
    blockId: string,
    delta = "",
  ): void => {
    ensure();
    replaceReply((message) => {
      const blocks = [...(message.blocks || [])];
      const index = blocks.findIndex(
        (block) => block.type === kind && block.blockId === blockId,
      );
      if (index < 0) {
        blocks.push(
          kind === "text"
            ? { type: "text", text: delta, blockId }
            : { type: "thinking", thinking: delta, blockId },
        );
      } else {
        const block = blocks[index];
        blocks[index] = block.type === "text"
          ? { ...block, text: block.text + delta }
          : block.type === "thinking"
            ? { ...block, thinking: block.thinking + delta }
            : block;
      }
      const { text } = extractFromBlocks(blocks);
      return { ...message, blocks, content: text || null };
    });
  };

  const appendDataBlock = (
    blockId: string,
    mediaType: string,
    delta = "",
  ): void => {
    ensure();
    replaceReply((message) => {
      const blocks = [...(message.blocks || [])];
      const index = blocks.findIndex(
        (block) => block.type === "data" && block.blockId === blockId,
      );
      if (index < 0) {
        blocks.push({ type: "data", data: delta, mediaType, blockId });
      } else {
        const block = blocks[index];
        if (block.type === "data") {
          blocks[index] = {
            ...block,
            data: appendBase64Chunk(block.data, delta),
            mediaType: mediaType || block.mediaType,
          };
        }
      }
      const { text } = extractFromBlocks(blocks);
      return { ...message, blocks, content: text || null };
    });
  };

  const updateToolResult = (
    toolCallId: string,
    mutate: (current: ToolResult) => ToolResult,
  ): void => {
    const indices = messageId
      ? b.messages.map((message, index) => message.id === messageId ? index : -1)
        .filter((index) => index >= 0)
        .reverse()
      : b.messages.map((_message, index) => index).reverse();
    for (const index of indices) {
      const message = b.messages[index];
      const toolCall = message.blocks?.find(
        (block) => block.type === "toolCall" && block.id === toolCallId,
      );
      if (!toolCall || toolCall.type !== "toolCall") continue;
      const current = message.toolResults?.[toolCallId] ?? {
        id: toolCallId,
        name: toolCall.name,
        result: "",
        error: null,
        status: "running" as const,
      };
      const messages = [...b.messages];
      messages[index] = {
        ...message,
        toolResults: {
          ...(message.toolResults || {}),
          [toolCallId]: mutate(current),
        },
      };
      b.messages = messages;
      return;
    }
  };

  const attachHiddenImageToLatestReadTool = (): void => {
    if (!d.metadata?.hide || !Array.isArray(d.content)) return;
    if (!d.content.some((p: any) => p?.type === "image_file" && typeof p.path === "string")) return;

    for (let i = b.messages.length - 1; i >= 0; i--) {
      const msg = b.messages[i];
      if (!msg.blocks) continue;
      const toolCallBlock = msg.blocks.find(
        (bl) => bl.type === "toolCall" && (bl.name === "read" || bl.name === "read_file")
      );
      if (!toolCallBlock || toolCallBlock.type !== "toolCall") continue;
      const tcId = toolCallBlock.id;
      const existingResult = msg.toolResults?.[tcId];
      if (existingResult?.result?.includes("image_file")) continue;
      const nextMessages = b.messages.slice();
      nextMessages[i] = {
        ...msg,
        toolResults: {
          ...(msg.toolResults || {}),
          [tcId]: {
            id: tcId,
            name: toolCallBlock.name,
            result: JSON.stringify(d),
            error: null,
            status: "completed" as const,
          },
        },
      };
      b.messages = nextMessages;
      return;
    }
  };

  switch (ev.type) {
    // ─── 实时 echo：后端保存 UserMsg 后回推给客户端 ───
    case UserMessageEventType: {
      // UserMessageEvent 是消息真正写入 messages 后的回显；队列中的请求不在此处造气泡。
      const input = d.data && typeof d.data === "object" ? d.data : {};
      if (input.metadata?.hide) {
        attachHiddenImageToLatestReadTool();
        return;
      }
      b.lastUserInputTs = ts;
      const content = typeof input.content === "string"
        ? input.content
        : Array.isArray(input.content)
          ? input.content
              .filter((part: any) => part?.type === "text" || part?.type === "skill")
              .map((part: any) => String(part.text ?? part.data ?? "").trim())
              .join("\n")
              .trim()
          : "";
      const attachments = toMessageAttachments(input.attachments);
      if (!content && attachments.length === 0) return;

      const messageId = typeof d.id === "string" && d.id
        ? d.id
        : ev.frameId || nextId("user");
      if (b.messages.some((message) => message.id === messageId)) return;
      const requestId = typeof ev.metadata?.request_id === "string"
        ? ev.metadata.request_id
        : typeof input.request_id === "string"
          ? input.request_id
          : undefined;
      // USER_MESSAGE 只负责把已经持久化的 U 加入消息列表。队列项是否已被
      // Agent claim 由 session/queue 快照决定；不能在这里伪造或保留队列状态。
      if (requestId) {
        const canonical = canonicalRequestId(requestId);
        b.pendingMessages = (b.pendingMessages ?? []).filter(
          (item) => canonicalRequestId(item.request_id) !== canonical,
        );
        b.queueDepth = (b.pendingMessages ?? []).length;
      }
      const nextMessage: ChatMessage = {
        id: messageId,
        role: "user",
        content,
        timestamp: ts,
        ...(attachments.length > 0 ? { attachments } : {}),
        metadata: {
          ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
          ...(requestId ? { request_id: requestId } : {}),
        },
      };
      b.messages = [
        ...b.messages,
        nextMessage,
      ];
      return;
    }
    case "REPLY_START": {
      ensure();
      if (!b.hasCoordinatorState) {
        b.isBusy = true;
        b.sessionStatus = "running";
        b.sessionActivity = "executing";
        b.clientCanSend = true;
        b.canCancel = true;
      }
      b.retryState = null;
      return;
    }

    case "REPLY_END": {
      if (activeReplyIndex() < 0) return;
      const replyError = d.error;
      const replyErrorMessage = replyError
        ? typeof replyError === "string"
          ? replyError
          : String(replyError.message || replyError.code || "Agent reply failed")
        : null;
      replaceReply((message) => ({
        ...message,
        streaming: false,
        isError: d.finished_reason === "error" || !!replyError,
        error: replyErrorMessage
          ? {
              code: typeof replyError?.code === "string" ? replyError.code : undefined,
              message: replyErrorMessage,
            }
          : message.error,
      }));
      b.retryState = null;
      if (replyErrorMessage) b.error = replyErrorMessage;
      return;
    }

    case "TEXT_BLOCK_START":
      appendTextBlock("text", d.block_id);
      return;

    case "TEXT_BLOCK_DELTA":
      appendTextBlock("text", d.block_id, d.delta || "");
      return;

    case "TEXT_BLOCK_END":
      return;

    case "DATA_BLOCK_START":
      appendDataBlock(d.block_id, d.media_type || "application/octet-stream");
      return;

    case "DATA_BLOCK_DELTA":
      appendDataBlock(
        d.block_id,
        d.media_type || "application/octet-stream",
        d.data || "",
      );
      return;

    case "DATA_BLOCK_END":
      return;

    case "THINKING_BLOCK_START":
      appendTextBlock("thinking", d.block_id);
      return;

    case "THINKING_BLOCK_DELTA":
      appendTextBlock("thinking", d.block_id, d.delta || "");
      return;

    case "THINKING_BLOCK_END":
      return;

    case "HINT_BLOCK":
      // HintBlock 是 Agent 内部续跑/调度提示，会进入下一次模型上下文，
      // 但不属于面向用户的 assistant 输出。
      return;

    case "MODEL_CALL_START":
      ensure();
      if (typeof d.model_name === "string" && d.model_name) {
        replaceReply((message) => ({ ...message, model: d.model_name }));
      }
      return;

    case "MODEL_CALL_END":
      ensure();
      replaceReply((message) => {
        const current = {
          prompt_tokens: d.prompt_tokens || 0,
          completion_tokens: d.completion_tokens || 0,
          total_tokens: d.total_tokens || 0,
        };
        const previous = message.token?.usage;
        return {
          ...message,
          token: {
            usage: previous
              ? {
                  prompt_tokens: previous.prompt_tokens + current.prompt_tokens,
                  completion_tokens: previous.completion_tokens + current.completion_tokens,
                  total_tokens: previous.total_tokens + current.total_tokens,
                }
              : { ...current },
            last_call_usage: { ...current },
          },
        };
      });
      return;

    case "TOOL_CALL_START":
      ensure();
      replaceReply((message) => {
        const blocks = [...(message.blocks || [])];
        const existing = blocks.find(
          (block) => block.type === "toolCall" && block.id === d.tool_call_id,
        );
        if (existing?.type === "toolCall") {
          // TOOL_CALL_START 可能在重试/回放时重复到达；tool_call_id 是调用身份，
          // 同一 reply 内必须保持一个 block，后续 DELTA/END 继续更新它。
          if (existing.name || !d.tool_call_name) return message;
          return {
            ...message,
            blocks: blocks.map((block) => block === existing
              ? { ...block, name: d.tool_call_name }
              : block),
          };
        }
        blocks.push({
          type: "toolCall",
          id: d.tool_call_id,
          name: d.tool_call_name || "",
          arguments: {},
          argumentsText: "",
        });
        return { ...message, blocks };
      });
      return;

    case "TOOL_CALL_DELTA":
      ensure();
      replaceReply((message) => ({
        ...message,
        blocks: (message.blocks || []).map((block) => {
          if (block.type !== "toolCall" || block.id !== d.tool_call_id) return block;
          const argumentsText = (block.argumentsText || "") + (d.delta || "");
          let args = block.arguments;
          try {
            const parsed = JSON.parse(argumentsText);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
          } catch {
            // Partial JSON is expected while arguments are streaming.
          }
          return { ...block, arguments: args, argumentsText };
        }),
      }));
      return;

    case "TOOL_CALL_END":
      ensure();
      replaceReply((message) => ({
        ...message,
        blocks: (message.blocks || []).map((block) => {
          if (block.type !== "toolCall" || block.id !== d.tool_call_id) return block;
          const rawArguments = typeof d.arguments === "string"
            ? d.arguments
            : block.argumentsText || "";
          let argumentsValue = block.arguments;
          let argumentsText: string | undefined;
          if (rawArguments.trim()) {
            try {
              const parsed = JSON.parse(rawArguments);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                argumentsValue = parsed;
              } else {
                argumentsText = rawArguments;
              }
            } catch {
              // 结束事件仍然保留原始 JSON，避免解析失败时退化成空参数。
              argumentsText = rawArguments;
            }
          }
          const { argumentsText: _partialArguments, ...finished } = block;
          return {
            ...finished,
            arguments: argumentsValue,
            ...(argumentsText ? { argumentsText } : {}),
          };
        }),
      }));
      return;

    case "TOOL_RESULT_START":
      return;

    case "TOOL_RESULT_TEXT_DELTA":
      updateToolResult(d.tool_call_id, (current) => ({
        ...current,
        result: (current.result || "") + (d.delta || ""),
      }));
      return;

    case "TOOL_RESULT_DATA_DELTA": {
      const payload = d.data ?? d.url;
      if (payload != null) {
        updateToolResult(d.tool_call_id, (current) => ({
          ...current,
          result: (current.result || "") + String(payload),
        }));
      }
      return;
    }

    case "TOOL_RESULT_END":
      updateToolResult(d.tool_call_id, (current) => {
        const isError = d.state === "error";
        const isCancelled = d.state === "interrupted";
        const isDenied = d.state === "denied";
        const metadata = d.metadata || {};
        return {
          ...current,
          error: isError
            ? String(metadata.error || metadata.message || current.result || "Tool execution failed")
            : null,
          status: isDenied ? "denied" : isCancelled ? "cancelled" : isError ? "error" : "completed",
          metadata,
        };
      });
      return;

    // ─── 工具权限确认：命中 ASK，等待用户批准/拒绝 ───
    // 后端已把对应 ToolCallBlock.state 置为 asking 并持久化；这里在客户端
    // 合成一个 status="asking" 的 ToolResult 承载确认上下文，供卡片渲染按钮。
    case "REQUIRE_USER_CONFIRM": {
      const toolCallId = typeof d.tool_call_id === "string" ? d.tool_call_id : "";
      if (!toolCallId || !replyId) return;
      updateToolResult(toolCallId, (current) => ({
        ...current,
        result: null,
        error: null,
        status: "asking",
        confirm: {
          reason: typeof d.reason === "string" ? d.reason : undefined,
          ruleId: typeof d.rule_id === "string" ? d.rule_id : undefined,
        },
      }));
      return;
    }

    // 后端已接受并持久化本次决定后再更新卡片，避免发送失败时乐观状态
    // 吞掉确认按钮。多 ASK 场景下，其他卡片仍保持 asking。
    case "USER_CONFIRM_RESULT": {
      const toolCallId = typeof d.tool_call_id === "string" ? d.tool_call_id : "";
      if (!toolCallId) return;
      updateToolResult(toolCallId, (current) => ({
        ...current,
        result: d.approved ? "" : current.result,
        error: null,
        status: d.approved ? "running" : "denied",
        confirm: undefined,
      }));
      return;
    }

    case "EXCEED_MAX_ITERS": {
      const message = "Agent exceeded the maximum number of iterations";
      b.messages = [
        ...b.messages,
        { id: ev.eventId ?? nextId("err"), role: "assistant", content: message, timestamp: ts, isError: true },
      ];
      b.error = message;
      return;
    }

    case "external_message": {
      const text = typeof d.content === "string" ? d.content : "";
      const fromCh = typeof d.from_channel === "string" ? d.from_channel : "";
      const fromSid = typeof d.from_session === "string" ? d.from_session : "";
      const inserted: ChatMessage = {
        id: ev.frameId ?? nextId("ext"),
        role: "assistant",
        content: text,
        timestamp: ts,
        blocks: text ? [{ type: "text", text, blockId: ev.eventId ?? ev.frameId ?? nextId("ext-block") }] : [],
        toolResults: {},
        external: true,
        externalFrom: fromCh || fromSid ? `${fromCh}::${fromSid}` : undefined,
      };
      const i = b.messages.length - 1;
      const tailMsg = i >= 0 ? b.messages[i] : null;
      b.messages = tailMsg?.streaming
        ? [...b.messages.slice(0, i), inserted, tailMsg]
        : [...b.messages, inserted];
      return;
    }


    // 鈹€鈹€鈹€ 宸ュ叿缁撴灉锛氫粠灏鹃儴寰€鍓嶆壘鍒板搴?tc 鍐欏叆 鈹€鈹€鈹€
    case "CUSTOM": {
      const phase = d.name;
      const phaseData = d.value || {};
      if (phase === "PIPELINE_START") {
        // pipeline 开始：立即标记忙
        if (!b.hasCoordinatorState) {
          b.isBusy = true;
          b.sessionStatus = "running";
          b.sessionActivity = "dispatching";
          b.clientCanSend = true;
          b.canCancel = true;
        }
        b.error = null;
        return;
      }
      if (phase === "PIPELINE_END") {
        // pipeline 结束：恢复空闲，清除 Turn 级临时状态
        if (!b.hasCoordinatorState) {
          b.isBusy = false;
          b.sessionStatus = "idle";
          b.sessionActivity = "idle";
          b.canCancel = false;
        }
        b.commandName = null;
        return;
      }
      if (phase === "COMMAND_MATCHED") {
        // 指令命中：状态栏更新为"执行指令..."
        if (!b.hasCoordinatorState) {
          b.isBusy = true;
          b.sessionStatus = "running";
          b.sessionActivity = "dispatching";
          b.canCancel = true;
        }
        b.commandName = phaseData.command_name ?? null;
        return;
      }
      if (phase === "TURN_START") {
        if (!b.hasCoordinatorState) {
          b.isBusy = true;
          b.sessionStatus = "running";
          b.sessionActivity = "executing";
          b.clientCanSend = true;
          b.canCancel = true;
        }
        b.error = null;
        b.retryState = null;
        b.commandName = null; // 进入 agent 执行，清除指令标记
        b.turnStartTs = ts ?? null;
        return;
      }
      // ── 上下文压缩事件（CustomEvent，与后端 compact done 投影的 Msg 同 id）──
      if (phase === CompactEventName.START) {
        if (!b.hasCoordinatorState) {
          b.isBusy = true;
          b.sessionStatus = "compacting";
          b.sessionActivity = "compacting";
          b.clientCanSend = false;
          b.canCancel = false;
        }
        b.messages = [
          ...b.messages,
          {
            id: ev.eventId ?? nextId("compact"),
            role: "system" as Role,
            content: null,
            timestamp: ts,
            compact: {
              status: "running",
              model: typeof phaseData.model === "string" && phaseData.model
                ? phaseData.model
                : undefined,
              tokensBefore: typeof phaseData.tokens === "number" ? phaseData.tokens : undefined,
            },
          },
        ];
        return;
      }
      if (phase === CompactEventName.DONE) {
        if (!b.hasCoordinatorState) {
          b.isBusy = false;
          b.sessionStatus = "idle";
          b.sessionActivity = "idle";
          b.clientCanSend = true;
          b.canCancel = false;
        }
        // 用 event id 作为气泡 id，与后端投影的 compact Msg id 一致
        const compactId = ev.eventId ?? nextId("compact");
        const doneCompact = {
          status: "done" as const,
          mode: typeof phaseData.mode === "string" ? phaseData.mode : "summary",
          tokensBefore: typeof phaseData.tokens_before === "number" ? phaseData.tokens_before : undefined,
          tokensAfter: typeof phaseData.tokens_after === "number" ? phaseData.tokens_after : undefined,
          summaryPreview: typeof phaseData.summary_text === "string" ? phaseData.summary_text : undefined,
          eventsCleared: typeof phaseData.tool_results === "number" ? phaseData.tool_results : undefined,
          toolResults: typeof phaseData.tool_results === "number" ? phaseData.tool_results : undefined,
        };
        let foundRunning = false;
        for (let i = b.messages.length - 1; i >= 0; i--) {
          const m = b.messages[i];
          if (m.compact?.status === "running") {
            b.messages = [
              ...b.messages.slice(0, i),
              { ...m, id: compactId, compact: doneCompact },
              ...b.messages.slice(i + 1),
            ];
            foundRunning = true;
            break;
          }
        }
        if (!foundRunning) {
          b.messages = [
            ...b.messages,
            {
              id: compactId,
              role: "system" as Role,
              content: null,
              timestamp: ts,
              compact: doneCompact,
            },
          ];
        }
        return;
      }
      if (phase === CompactEventName.FAILED) {
        if (!b.hasCoordinatorState) {
          b.isBusy = false;
          b.sessionStatus = "idle";
          b.sessionActivity = "idle";
          b.clientCanSend = true;
          b.canCancel = false;
        }
        for (let i = b.messages.length - 1; i >= 0; i--) {
          const m = b.messages[i];
          if (m.compact?.status === "running") {
            b.messages = [
              ...b.messages.slice(0, i),
              {
                ...m,
                compact: {
                  status: "failed" as const,
                  reason: typeof phaseData.reason === "string" ? phaseData.reason : "未知原因",
                },
              },
              ...b.messages.slice(i + 1),
            ];
            break;
          }
        }
        return;
      }
      if (phase !== "TURN_END") return;

      replaceTail((m) => m.streaming ? { ...m, streaming: false } : m);
      if (!b.hasCoordinatorState) {
        b.isBusy = false;
        b.sessionStatus = "idle";
        b.sessionActivity = "idle";
        b.canCancel = false;
      }
      b.retryState = null;

      // 计算耗时并写入本轮最后一条 assistant 消息
      if (b.turnStartTs != null && ts != null) {
        const durationSec = Math.round((ts - b.turnStartTs) / 1000);
        for (let i = b.messages.length - 1; i >= 0; i--) {
          if (b.messages[i].role === "assistant" && !b.messages[i].streaming) {
            b.messages[i] = { ...b.messages[i], durationSec };
            break;
          }
        }
        b.turnStartTs = null;
      }

      if (phaseData.reason === "error" && phaseData.error_message) {
        const msg: string = phaseData.error_message;
        const code = phaseData.error_code;
        let attached = false;
        for (let index = b.messages.length - 1; index >= 0; index--) {
          const message = b.messages[index];
          if (message.role !== "assistant" || message.external) continue;
          const next = b.messages.slice();
          next[index] = {
            ...message,
            isError: true,
            error: message.error ?? {
              code: typeof code === "string" ? code : undefined,
              message: msg,
            },
          };
          b.messages = next;
          attached = true;
          break;
        }
        if (!attached) {
          b.messages = [
            ...b.messages,
            {
              id: ev.frameId ?? nextId("err"),
              role: "assistant",
              content: null,
              timestamp: ts,
              isError: true,
              error: {
                code: typeof code === "string" ? code : undefined,
                message: msg,
              },
            },
          ];
        }
        b.error = code ? `[${code}] ${msg}` : msg;
      }
      return;
    }

    case "retry": {
      b.retryState = { attempt: d.attempt, maxAttempts: d.max_attempts, message: d.message };
      return;
    }

  }
}

// 鈹€鈹€鈹€ WS Wiring 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
//
// 妯″潡绾ф敞鍐岀殑 handler 鍦?dev hmr 閲嶆柊鎵ц妯″潡鏃朵細琚噸澶?push銆?// 鐢?guard 淇濊瘉鍏ㄧ敓鍛藉懆鏈熷彧娉ㄥ唽涓€娆★紝閬垮厤姣忔潯 ws 浜嬩欢琚鐞嗗娆★紙鍏稿瀷鐥囩姸锛?// 娴佸紡鏂囨湰鐪嬭捣鏉?閲嶅杈撳嚭"锛屽疄闄呮槸 reducer 璺戜簡涓ら亶锛夈€?//
// 鍚庡彴鑺傛祦锛歐indows 涓嬪垏鍒板悗鍙版椂 Chromium 浼氳妭娴?timer锛?
// 浣?WebSocket 娑堟伅涓嶅彈褰卞搷鎸佺画娑屽叆 鈫?mirror() 鏀掔Н澶ч噺 React setState銆?
// 鐢?Page Visibility API锛氬悗鍙版椂鍙叆妗朵笉 mirror锛屽洖鍓嶅彴涓€鎶婂埛鏂般€?
