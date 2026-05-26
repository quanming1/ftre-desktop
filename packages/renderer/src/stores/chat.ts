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
  | { type: "text"; text: string; streaming?: boolean }
  | { type: "reasoning"; text: string; streaming?: boolean }
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

/**
 * 从末尾向前找最近一个仍在流式填充的 text/reasoning part 索引。找不到返回 -1。
 *
 * 用于 message_complete / reasoning_complete 收尾：
 * 流式 chunk 期间会在 parts 里保留 streaming=true 的占位段，complete 事件
 * 到达时把它替换成权威总和。tool_call / tool_call_streaming 可能在 complete
 * 之前先把 tool part 推到末尾，因此不能只看 parts[-1]，要往前扫到 streaming 段。
 *
 * 严格匹配 streaming=true：已封口的段属于"上一轮已完成"或"回放路径下不存在
 * streaming"，complete 事件不能去覆盖它们。
 */
function findStreamingIdx(
  parts: MessagePart[],
  type: "text" | "reasoning",
): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === type && p.streaming) return i;
  }
  return -1;
}

/**
 * 把末尾正在流式填充的 text / reasoning part 封口（streaming=false）。
 *
 * 现在只在兜底场景使用：done 事件 / 回放结束后。日常的 *_complete 走
 * findStreamingIdx 自己找位置。
 */
function sealStreamingPart(parts: MessagePart[]): void {
  const tail = parts[parts.length - 1];
  if (!tail) return;
  if ((tail.type === "text" || tail.type === "reasoning") && tail.streaming) {
    parts[parts.length - 1] = { ...tail, streaming: false };
  }
}

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
      if (!chunk) return;
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        const lastPart = parts[parts.length - 1];
        // 末尾如果是个还在填的 text part 就追加；否则开新段。
        // 任何"非 text chunk 的事件"到达时都会调 sealStreamingPart 把这段封口，
        // 之后再来 chunk 就不会误并到上一段。
        if (lastPart?.type === "text" && lastPart.streaming) {
          parts[parts.length - 1] = { type: "text", text: lastPart.text + chunk, streaming: true };
        } else {
          parts.push({ type: "text", text: chunk, streaming: true });
        }
        return { ...m, parts, content: (m.content ?? "") + chunk, streaming: true };
      });
      return;
    }

    // ─── 流式文本最终化（ws）/ 历史回放完整文本 ───
    // 不在此处置 message.streaming=false；由 done 事件统一收尾。
    case "message_complete": {
      ensure();
      const final = d.content || "";
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        // 找一个还在流式填充的 text part（即便末尾是 tool_call 也能找到）：
        // - 实时路径：先 message chunk 累积出 streaming text → 中间可能插入
        //   tool_call_streaming 推到末尾 → 此 complete 仍能锁定到流式段并封口
        // - 回放路径：DB 没有 chunk，找不到流式段 → push 一个已封口的新段
        const streamingIdx = findStreamingIdx(parts, "text");
        if (streamingIdx >= 0) {
          parts[streamingIdx] = { type: "text", text: final, streaming: false };
        } else if (final) {
          parts.push({ type: "text", text: final, streaming: false });
        }
        const content = parts
          .filter((p): p is { type: "text"; text: string; streaming?: boolean } => p.type === "text")
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
      if (!chunk) return;
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        const lastPart = parts[parts.length - 1];
        // 跟 message chunk 同思路：末尾是流式 reasoning 就追加，否则开新段
        if (lastPart?.type === "reasoning" && lastPart.streaming) {
          parts[parts.length - 1] = { type: "reasoning", text: lastPart.text + chunk, streaming: true };
        } else {
          parts.push({ type: "reasoning", text: chunk, streaming: true });
        }
        return { ...m, parts, reasoning: (m.reasoning ?? "") + chunk };
      });
      return;
    }

    // ─── 一轮思考的完整文本（对应 message_complete 的 reasoning 版） ───
    // 实时：reasoning chunks 后到达，原地覆盖封口
    // 回放：DB 只有 reasoning_complete 没有 chunk，直接 push
    case "reasoning_complete": {
      ensure();
      const final = d.content || "";
      if (!final) return;
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        const streamingIdx = findStreamingIdx(parts, "reasoning");
        if (streamingIdx >= 0) {
          parts[streamingIdx] = { type: "reasoning", text: final, streaming: false };
        } else {
          parts.push({ type: "reasoning", text: final, streaming: false });
        }
        // 兼容旧字段：把所有 reasoning part 文本拼起来
        const reasoning = parts
          .filter((p): p is { type: "reasoning"; text: string; streaming?: boolean } => p.type === "reasoning")
          .map((p) => p.text)
          .join("\n\n");
        return { ...m, parts, reasoning };
      });
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
        // 不在这里 seal 当前流式 text/reasoning：稍后 *_complete 会用
        // findStreamingIdx 自己找到那段做最终覆盖。如果先 seal 了，complete
        // 就找不到流式段，会另起一段，造成同一段文字渲染两次。
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
        // 同 tool_call：不 seal，让 *_complete 自己找流式段覆盖
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
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        sealStreamingPart(parts);
        return {
          ...m,
          parts,
          streaming: false,
          toolCalls: m.toolCalls?.map((tc) =>
            tc.status === "running" || tc.status === "pending" ? { ...tc, status: "ok" as const } : tc,
          ),
        };
      });
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
//
// 模块级注册的 handler 在 dev hmr 重新执行模块时会被重复 push。
// 用 guard 保证全生命周期只注册一次，避免每条 ws 事件被处理多次（典型症状：
// 流式文本看起来"重复输出"，实际是 reducer 跑了两遍）。
const __wsBoundFlag = "__ftreChatWsBound__";
if (!(globalThis as any)[__wsBoundFlag]) {
  (globalThis as any)[__wsBoundFlag] = true;

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

    // 后端在首条用户消息后异步生成标题；前端有自己的会话列表轮询，
    // 拿到新 title 是迟早的事，不需要专门的 push 通知。

    if (msg.type !== "agent_event") return;
    const ev = msg.data;
    if (!ev?.type) return;
    const sid = msg.metadata?.session_id as string | undefined;
    if (!sid) return;

    applyEvent(bucket(sid), { type: ev.type, data: ev.data });
    mirror(sid);

    // 实时事件结束后刷新 token 估算：
    // - done: 一次完整 LLM 轮次结束，后端刚写入新的 usage_update，重读拿到最新 anchor
    // - external_message: 别的 session 注入了消息，pending 部分会增长
    // 只对当前活跃 session 刷新，避免后台 session 频繁打接口
    if ((ev.type === "done" || ev.type === "external_message") && useChat.getState().sessionId === sid) {
      useChat.getState().refreshTokenUsage(sid);
    }
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
}

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
  /** 当前会话的总 token 用量明细。
   *  由后端 GET /api/sessions/{id}/token_usage 提供，在切换 session、流式 done
   *  和 external_message 到达时刷新。
   *  - anchor: 最近一次 LLM 实算的 usage（无则 null）
   *  - pending_estimated: 锚点之后未实算的事件估算
   *  - total: anchor.total_tokens + pending_estimated */
  tokenUsage: {
    anchor: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      at: number;
      source: "usage_update" | "done";
    } | null;
    pending_estimated: number;
    total: number;
  } | null;
  /** @deprecated 保留 contextTokens 兼容旧 selector，等价于 tokenUsage?.total ?? 0 */
  contextTokens: number;
  /** 当前选中模型的上下文窗口大小（token 数）。
   *  由 ModelSelector 在选择模型 / 加载默认值时同步进来；用于 TokenRing 计算用量比例。
   *  null 表示尚未选择或模型未配置 context_window。 */
  contextWindow: number | null;

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
  /** 同步当前模型的上下文窗口大小（由 ModelSelector 写入） */
  setContextWindow: (n: number | null) => void;
  /** 主动刷新当前 session 的 token 估算（异步，失败静默） */
  refreshTokenUsage: (sessionId?: string) => Promise<void>;
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
  contextTokens: 0,
  tokenUsage: null,
  contextWindow: null,

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

    // 首次发消息：fetch 创建 session 期间会有 100~500ms 网络往返，
    // 这段时间如果什么都不做，ChatView 会因为 (!sessionId && !isBusy) 仍停留在 WelcomeView，
    // 用户看不到自己刚发的消息，也看不到"ftre..."占位。
    // 这里先同步把 isBusy 和 userMsg 顶到 store top-level，让 UI 立即切到对话视图。
    // fetch 返回后 send() → bucket.push(userMsg) → mirror() 会再次写回同一份 messages，
    // 内容一致，不会闪烁也不会重复。
    set({ isBusy: true, messages: [...get().messages, userMsg] });

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

  newChat: () => set({ sessionId: null, messages: [], isBusy: false, error: null, retryState: null, contextTokens: 0, tokenUsage: null }),

  switchTo: (sessionId, initialMessages) => {
    const b = bucket(sessionId);
    if (initialMessages && b.messages.length === 0) b.messages = initialMessages;
    set({ sessionId, messages: b.messages, isBusy: b.isBusy, error: b.error, retryState: b.retryState, contextTokens: 0, tokenUsage: null });
    wsClient.attach(sessionId);
    // 异步拉一次最新 token 估算（不阻塞 UI 切换）
    void get().refreshTokenUsage(sessionId);
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
    // 同步把末尾还在"流式填充"的 part 也封口，避免遗留状态影响后续判断。
    const t = last(b.messages);
    if (t?.streaming) {
      const parts = [...(t.parts || [])];
      sealStreamingPart(parts);
      const next = b.messages.slice();
      next[next.length - 1] = { ...t, parts, streaming: false };
      b.messages = next;
    }
    mirror(sessionId);
  },

  setModel: (model) => set({ model }),
  setProvider: (provider) => set({ provider }),
  setAgentId: (id) => set({ agentId: id }),
  setContextWindow: (n) => set({ contextWindow: n }),

  refreshTokenUsage: async (sessionId) => {
    const sid = sessionId ?? get().sessionId;
    if (!sid) {
      set({ contextTokens: 0, tokenUsage: null });
      return;
    }
    try {
      // 动态 import 打破 chat ↔ api 之间的循环（api 也会 import chat store）
      const { fetchTokenUsage } = await import("@/services/api");
      const usage = await fetchTokenUsage(sid);
      // 刷新过程中如果用户已经切走了 session，丢弃这次结果
      if (get().sessionId !== sid) return;
      set({ contextTokens: usage.total, tokenUsage: usage });
    } catch (e) {
      // HTTP/网络失败：保留上一次值，避免 UI 闪到 0
      console.error("[chat] refreshTokenUsage failed:", e);
    }
  },
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
