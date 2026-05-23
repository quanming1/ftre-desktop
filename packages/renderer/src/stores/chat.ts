/**
 * Chat Store — 消费 ftre gateway WebSocket 事件流。
 *
 * 多 session 模型：
 *   每个 session 有独立 bucket（messages/isBusy/error/retryState）。
 *   store 顶层字段是 active bucket 的镜像（保留旧消费 API: useChat((s)=>s.messages) 等）。
 *   切 session 时直接 hydrate；进行中的流不被打断。
 *
 * 事件源统一：
 *   ws 实时事件 和 history 回放都走同一个 `applyEvent` reducer。
 */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { wsClient } from "@/services/websocket-client";
import type { WsConnectionStatus, ServerMessage } from "@/services/websocket-client";

// ─── Types ──────────────────────────────────────────────────────────

export type Role = "assistant" | "user" | "system";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "ok" | "error";
  result?: string;
}

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCallId: string };

/** 用户消息附件（与后端 attachments 协议同形，base64 已转成 data URL） */
export interface MessageAttachment {
  type: "image";
  /** data:<mime>;base64,<...> */
  url: string;
  mime?: string;
  name?: string;
  bytes?: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string | null;
  timestamp: number;
  streaming?: boolean;
  toolCalls?: ToolCall[];
  reasoning?: string;
  parts?: MessagePart[];
  /** 用户消息携带的附件（如图片）。仅在 role === "user" 时使用。 */
  attachments?: MessageAttachment[];
  isError?: boolean;
  /** 外部 session 通过 send_message 注入的消息 */
  external?: boolean;
  /** 外部消息来源标识（channel::session） */
  externalFrom?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    [k: string]: any;
  };
}

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

// ─── Per-session buckets (module-private) ───────────────────────────

interface Bucket {
  messages: ChatMessage[];
  isBusy: boolean;
  error: string | null;
  retryState: RetryState | null;
}

const buckets = new Map<string, Bucket>();
const emptyBucket = (): Bucket => ({ messages: [], isBusy: false, error: null, retryState: null });
function bucket(sid: string): Bucket {
  let b = buckets.get(sid);
  if (!b) buckets.set(sid, (b = emptyBucket()));
  return b;
}

const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

/** 当 sid === activeId 时，把 bucket 字段镜像到 store 顶层。 */
function mirror(sid: string): void {
  if (useChat.getState().sessionId !== sid) return;
  const b = buckets.get(sid);
  if (!b) return;
  useChat.setState({ messages: b.messages, isBusy: b.isBusy, error: b.error, retryState: b.retryState });
}

// ─── ID gen ─────────────────────────────────────────────────────────

let _idc = 0;
const nextId = (p = "msg") => `${p}_${Date.now()}_${++_idc}`;

// ─── Event Reducer ──────────────────────────────────────────────────
//
// 同时服务于 ws 实时事件 和 history 回放。
// 调用方约束：每次只处理一个 event；调用后 bucket 字段是新引用（数组级 immutable）。

export interface BusEvent {
  type: string;
  data?: any;
  ts?: number;
  /** 历史回放时可指定消息 id（保留原 id），ws 走 nextId */
  id?: string;
}

export function applyEvent(b: Bucket, ev: BusEvent): void {
  const d = ev.data || {};
  const ts = ev.ts ?? Date.now();

  /** 当前 streaming 尾部 assistant（若存在） */
  const tail = (): ChatMessage | null => {
    const m = last(b.messages);
    return m && m.role === "assistant" && m.streaming && !m.isError ? m : null;
  };

  /** 替换 tail（保留引用语义：mutator 拿到的是新对象，复制原字段） */
  const replaceTail = (mut: (m: ChatMessage) => ChatMessage): void => {
    const i = b.messages.length - 1;
    if (i < 0) return;
    const next = b.messages.slice();
    next[i] = mut(next[i]);
    b.messages = next;
  };

  /** 确保有一条 streaming assistant；没有就 push 一条空的。 */
  const ensure = (): void => {
    if (tail()) return;
    b.messages = [
      ...b.messages,
      {
        id: ev.id ?? nextId("ast"),
        role: "assistant",
        content: null,
        timestamp: ts,
        streaming: true,
        parts: [],
        toolCalls: [],
      },
    ];
  };

  switch (ev.type) {
    // ─── 历史回放专用：原始 user 输入 ───
    case "USER_INPUT": {
      const c = typeof d.content === "string" ? d.content : "";
      const rawAtts: any[] = Array.isArray(d.attachments) ? d.attachments : [];
      const localAttachments: MessageAttachment[] = [];
      for (const a of rawAtts) {
        if (
          a &&
          a.type === "image" &&
          typeof a.mime_type === "string" &&
          typeof a.data === "string"
        ) {
          localAttachments.push({
            type: "image",
            url: `data:${a.mime_type};base64,${a.data}`,
            mime: a.mime_type,
            name: typeof a.name === "string" ? a.name : undefined,
            bytes: Math.floor(a.data.length * 0.75),
          });
        }
      }
      if (!c && localAttachments.length === 0) return;
      b.messages = [
        ...b.messages,
        {
          id: ev.id ?? nextId("user"),
          role: "user",
          content: c,
          timestamp: ts,
          ...(localAttachments.length > 0 ? { attachments: localAttachments } : {}),
        },
      ];
      return;
    }

    // ─── 流式文本片段 ───
    case "message": {
      ensure();
      const chunk = d.content || "";
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        const lastPart = parts[parts.length - 1];
        if (lastPart?.type === "text") parts[parts.length - 1] = { type: "text", text: lastPart.text + chunk };
        else if (chunk) parts.push({ type: "text", text: chunk });
        return { ...m, parts, content: (m.content ?? "") + chunk, streaming: true };
      });
      return;
    }

    // ─── 流式文本最终化（ws）/ 历史回放完整文本 ───
    // 不在此处置 streaming=false；由 done 事件统一收尾（与原协议保持一致：
    // tool finalization 等清理仍可能在 message_complete 之后到达）。
    case "message_complete": {
      ensure();
      const final = d.content || "";
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        const lastPart = parts[parts.length - 1];
        if (lastPart?.type === "text") {
          parts[parts.length - 1] = { type: "text", text: final };
        } else if (final) {
          parts.push({ type: "text", text: final });
        }
        const content = parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");
        return { ...m, id: ev.id ?? m.id, parts, content };
      });
      return;
    }

    // ─── 外部 session 通过 send_message 注入的完整消息 ───
    // 与目标 session 自己的流式输出无关，独立成消息。
    // 若当前正有 streaming tail，则插在它之前，避免视觉错位。
    case "external_message": {
      const text = typeof d.content === "string" ? d.content : "";
      const fromCh = typeof d.from_channel === "string" ? d.from_channel : "";
      const fromSid = typeof d.from_session === "string" ? d.from_session : "";
      const inserted: ChatMessage = {
        id: ev.id ?? nextId("ext"),
        role: "assistant",
        content: text,
        timestamp: ts,
        parts: text ? [{ type: "text", text }] : [],
        external: true,
        externalFrom: fromCh || fromSid ? `${fromCh}::${fromSid}` : undefined,
        // 不设 streaming：这是外部完整插入消息
      };
      const i = b.messages.length - 1;
      const tailMsg = i >= 0 ? b.messages[i] : null;
      b.messages = tailMsg?.streaming
        ? [...b.messages.slice(0, i), inserted, tailMsg]
        : [...b.messages, inserted];
      return;
    }

    case "reasoning": {
      ensure();
      const chunk = d.content || "";
      replaceTail((m) => ({ ...m, reasoning: (m.reasoning ?? "") + chunk }));
      return;
    }

    // ─── 工具调用（一次性，含完整 args） ───
    case "tool_call": {
      ensure();
      const id: string = d.id ?? "";
      const name: string = d.name ?? "unknown";
      const args = typeof d.arguments === "object" ? JSON.stringify(d.arguments) : String(d.arguments ?? "{}");
      replaceTail((m) => {
        const toolCalls = [...(m.toolCalls || [])];
        const parts = [...(m.parts || [])];
        const i = toolCalls.findIndex((t) => t.id === id);
        if (i >= 0) toolCalls[i] = { ...toolCalls[i], name, arguments: args, status: "running" };
        else {
          toolCalls.push({ id, name, arguments: args, status: "running" });
          parts.push({ type: "tool_call", toolCallId: id });
        }
        return { ...m, toolCalls, parts };
      });
      return;
    }

    // ─── 工具调用流式增量（args 分片） ───
    case "tool_call_streaming": {
      ensure();
      const chunks: any[] = d.tool_calls || [];
      replaceTail((m) => {
        const toolCalls = [...(m.toolCalls || [])];
        const parts = [...(m.parts || [])];
        for (const c of chunks) {
          if (!c.id) continue;
          const i = toolCalls.findIndex((t) => t.id === c.id);
          const delta: string = c.arguments_delta || "";
          if (i >= 0) {
            toolCalls[i] = {
              ...toolCalls[i],
              name: c.name || toolCalls[i].name,
              arguments: toolCalls[i].arguments + delta,
            };
          } else {
            toolCalls.push({
              id: c.id,
              name: c.name || "unknown",
              arguments: delta,
              status: "running",
            });
            parts.push({ type: "tool_call", toolCallId: c.id });
          }
        }
        return { ...m, toolCalls, parts, streaming: true };
      });
      return;
    }

    // ─── 工具结果：从尾部往前找到对应 tc 写入 ───
    case "tool_result": {
      const id = d.id;
      const isErr = !!d.error;
      for (let i = b.messages.length - 1; i >= 0; i--) {
        const tc = b.messages[i].toolCalls?.find((t) => t.id === id);
        if (!tc) continue;
        const next = b.messages.slice();
        const updTc = next[i].toolCalls!.map((t) =>
          t.id === id
            ? { ...t, status: isErr ? ("error" as const) : ("ok" as const), result: isErr ? d.error : (d.result ?? ""), name: d.name || t.name }
            : t,
        );
        next[i] = { ...next[i], toolCalls: updTc };
        b.messages = next;
        return;
      }
      return;
    }

    case "usage_update": {
      if (!d.usage) return;
      ensure();
      replaceTail((m) => ({ ...m, usage: d.usage }));
      return;
    }

    case "done": {
      replaceTail((m) => ({
        ...m,
        streaming: false,
        toolCalls: m.toolCalls?.map((tc) =>
          tc.status === "running" || tc.status === "pending" ? { ...tc, status: "ok" as const } : tc,
        ),
      }));
      b.isBusy = false;
      b.retryState = null;
      return;
    }

    case "error": {
      const msg: string = d.message ?? "未知错误";
      const code = d.code;
      // 先关掉前一条 streaming 消息（如果有）
      replaceTail((m) => ({ ...m, streaming: false }));
      b.messages = [
        ...b.messages,
        { id: ev.id ?? nextId("err"), role: "assistant", content: msg, timestamp: ts, isError: true },
      ];
      b.error = code ? `[${code}] ${msg}` : msg;
      b.isBusy = false;
      return;
    }

    case "retry": {
      b.retryState = { attempt: d.attempt, maxAttempts: d.max_attempts, message: d.message };
      return;
    }
  }
}

// ─── WS Wiring ──────────────────────────────────────────────────────

wsClient.onMessage((msg: ServerMessage) => {
  // 后端拒绝（附件违规等）：顶层 type="error"，不是 agent_event
  if (msg.type === "error") {
    const reason =
      (msg.data as any)?.message ||
      (msg.data as any)?.code ||
      "请求被拒绝";
    // 关掉对应 session 的 busy 状态
    const sid = (msg.data as any)?.session_id || msg.metadata?.session_id;
    if (typeof sid === "string" && sid) {
      const b = bucket(sid);
      b.isBusy = false;
      mirror(sid);
    }
    // 异步引入避免循环依赖（notification → chat 不应该被绑死）
    import("./notification")
      .then(({ useNotification }) => {
        useNotification.getState().addNotification({
          level: "error",
          message: reason,
        });
      })
      .catch(() => void 0);
    return;
  }

  if (msg.type !== "agent_event") return;
  const ev = msg.data;
  if (!ev?.type) return;
  const sid = msg.metadata?.session_id as string | undefined;
  if (!sid) return;
  applyEvent(bucket(sid), { type: ev.type, data: ev.data });
  mirror(sid);
});

wsClient.onConnect(() => useChat.setState({ connected: true, wsStatus: "connected" }));
wsClient.onStatusChange((s) => useChat.setState({ wsStatus: s, connected: s === "connected" }));
wsClient.onDisconnect(() => {
  // 断线：关掉所有 bucket 的 streaming 状态，保留消息
  for (const [sid, b] of buckets) {
    b.isBusy = false;
    const tail = last(b.messages);
    if (tail?.streaming) {
      const next = b.messages.slice();
      next[next.length - 1] = { ...tail, streaming: false };
      b.messages = next;
    }
    mirror(sid);
  }
  useChat.setState({ connected: false, wsStatus: "disconnected", isBusy: false });
});

// ─── Store ──────────────────────────────────────────────────────────

interface ChatState {
  // mirrored from active bucket
  messages: ChatMessage[];
  isBusy: boolean;
  error: string | null;
  retryState: RetryState | null;

  // session-independent
  sessionId: string | null;
  connected: boolean;
  wsStatus: WsConnectionStatus;
  model: string | null;
  provider: string | null;
  agentId: string;

  sendMessage: (
    content: string,
    attachments?: Array<{
      type: "image";
      mime_type: string;
      data: string;
      name?: string;
    }>,
  ) => void;
  cancelStream: () => void;
  newChat: () => void;
  /** 切到指定 session（不打断进行中的流）。 */
  switchTo: (sessionId: string, initialMessages?: ChatMessage[]) => void;
  /** 仅当桶为空时填充（首次进入 session 用） */
  hydrateSession: (sessionId: string, messages: ChatMessage[]) => void;
  /** 用最新数据替换桶（streaming 中跳过） */
  refreshSession: (sessionId: string, messages: ChatMessage[]) => void;
  hasSessionCache: (sessionId: string) => boolean;
  /** 把一组 BusEvent 喂给指定 session（history loader 用） */
  loadSessionEvents: (sessionId: string, events: BusEvent[], mode: "hydrate" | "refresh") => void;
  setModel: (model: string | null) => void;
  setProvider: (provider: string | null) => void;
  setAgentId: (id: string) => void;
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  isBusy: false,
  error: null,
  retryState: null,
  sessionId: null,
  connected: false,
  wsStatus: "disconnected" as WsConnectionStatus,
  model: null,
  provider: null,
  agentId: "code_agent",

  sendMessage: (content, attachments) => {
    const trimmed = content.trim();
    const hasAttachments = !!attachments && attachments.length > 0;
    if (!trimmed && !hasAttachments) return;

    // 本地回显用：把后端协议形态的 attachments 转成带 data URL 的形态
    const localAttachments: MessageAttachment[] | undefined = hasAttachments
      ? attachments!.map((a) => ({
        type: "image",
        url: `data:${a.mime_type};base64,${a.data}`,
        mime: a.mime_type,
        name: a.name,
        bytes: typeof a.data === "string" ? Math.floor(a.data.length * 0.75) : undefined,
      }))
      : undefined;

    const userMsg: ChatMessage = {
      id: nextId("user"),
      role: "user",
      content,
      timestamp: Date.now(),
      ...(localAttachments ? { attachments: localAttachments } : {}),
    };
    const send = (sid: string) => {
      const b = bucket(sid);
      b.messages = [...b.messages, userMsg];
      b.isBusy = true;
      b.error = null;
      b.retryState = null;
      mirror(sid);
      const { model, provider, agentId } = get();
      wsClient.sendChat(
        content,
        {
          ...(model && { model }),
          ...(provider && { provider }),
          ...(agentId && { agent_id: agentId }),
          session_id: sid,
        },
        attachments,
      );
    };
    const sid = get().sessionId;
    if (sid) return send(sid);
    fetch("http://127.0.0.1:18790/api/sessions?channel_id=ws", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        set({ sessionId: data.session_id });
        wsClient.attach(data.session_id);
        send(data.session_id);
      })
      .catch(() => set({ isBusy: false, error: "创建会话失败" }));
  },

  cancelStream: () => {
    const sid = get().sessionId;
    wsClient.sendCancel(sid || undefined);
    if (!sid) return set({ isBusy: false });
    const b = bucket(sid);
    b.isBusy = false;
    mirror(sid);
  },

  newChat: () => set({ sessionId: null, messages: [], isBusy: false, error: null, retryState: null }),

  switchTo: (sessionId, initialMessages) => {
    const b = bucket(sessionId);
    if (initialMessages && b.messages.length === 0) b.messages = initialMessages;
    set({ sessionId, messages: b.messages, isBusy: b.isBusy, error: b.error, retryState: b.retryState });
    wsClient.attach(sessionId);
  },

  hydrateSession: (sessionId, messages) => {
    const b = bucket(sessionId);
    if (b.messages.length > 0) return;
    b.messages = messages;
    mirror(sessionId);
  },

  refreshSession: (sessionId, messages) => {
    const b = bucket(sessionId);
    const tail = last(b.messages);
    if (b.isBusy || tail?.streaming) return;
    b.messages = messages;
    mirror(sessionId);
  },

  hasSessionCache: (sessionId) => {
    const b = buckets.get(sessionId);
    return !!b && b.messages.length > 0;
  },

  loadSessionEvents: (sessionId, events, mode) => {
    const b = bucket(sessionId);
    const tail = last(b.messages);
    if (mode === "refresh" && (b.isBusy || tail?.streaming)) return;
    if (mode === "hydrate" && b.messages.length > 0) return;
    b.messages = [];
    for (const ev of events) applyEvent(b, ev);
    // history 回放完毕：若尾部仍标记 streaming（无显式 done），收尾。
    const t = last(b.messages);
    if (t?.streaming) {
      const next = b.messages.slice();
      next[next.length - 1] = { ...t, streaming: false };
      b.messages = next;
    }
    mirror(sessionId);
  },

  setModel: (model) => set({ model }),
  setProvider: (provider) => set({ provider }),
  setAgentId: (id) => set({ agentId: id }),
}));

// ─── Selectors ──────────────────────────────────────────────────────

export const useMessageIds = () => useChat(useShallow((s) => s.messages.map((m) => m.id)));
export const useMessageById = (id: string) => useChat((s) => s.messages.find((m) => m.id === id));
export const useIsBusy = () => useChat((s) => s.isBusy);
export const useIsStreaming = () => useChat((s) => s.isBusy);
export const useModel = () => useChat((s) => s.model);
export const useProvider = () => useChat((s) => s.provider);
export const useSessionId = () => useChat((s) => s.sessionId);
export const useAgentId = () => useChat((s) => s.agentId);
export const useWsStatus = () => useChat((s) => s.wsStatus);
export const useStreamingMessageId = () =>
  useChat((s) => s.messages.find((m) => m.streaming)?.id ?? null);
