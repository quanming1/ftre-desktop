/**
 * Chat Store 鈥?娑堣垂 ftre gateway WebSocket 浜嬩欢娴併€? *
 * 澶?session 妯″瀷锛? *   姣忎釜 session 鏈夌嫭绔?bucket锛坢essages/isBusy/error/retryState锛夈€? *   store 椤跺眰瀛楁鏄?active bucket 鐨勯暅鍍忥紙淇濈暀鏃ф秷璐?API: useChat((s)=>s.messages) 绛夛級銆? *   鍒?session 鏃剁洿鎺?hydrate锛涜繘琛屼腑鐨勬祦涓嶈鎵撴柇銆? *
 * 浜嬩欢婧愮粺涓€锛? *   ws 瀹炴椂浜嬩欢 鍜?history 鍥炴斁閮借蛋鍚屼竴涓?`applyEvent` reducer銆? */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { wsClient } from "@/services/websocket-client";
import type { WsConnectionStatus, ServerMessage } from "@/services/websocket-client";
import { createSessionRemote, API_BASE, fetchChatAgents, updateAgent } from "@/services/api";
import type { ChatAgent } from "@/services/api";

// ─── Types ───────────────────────────────────────────────────────────

export type Role = "assistant" | "user" | "system";
export type SessionStatus = "idle" | "running" | "compacting";

/** 协议级 content block（assistant 消息的最小内容单元） */
export type ContentBlock =
  | { type: "thinking"; thinking: string; event_id?: string }
  | { type: "text"; text: string; event_id?: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; event_id?: string };

/** 工具执行结果（与 toolCall block 的 id 配对） */
export interface ToolResult {
  id: string;
  name: string;
  result: string | null;
  error: string | null;
  status: "completed" | "error" | "cancelled";
  /** 工具附加元数据（edit/write 携带 diff 信息） */
  metadata?: {
    file?: string;
    before?: string;
    after?: string;
    diff?: string;
    additions?: number;
    deletions?: number;
    [key: string]: any;
  };
}

export interface MessageAttachment {
  type: "image";
  url: string;
  mime?: string;
  name?: string;
  bytes?: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  /** user: 文本; assistant: 拼接文本(便利字段); system: null */
  content: string | null;
  timestamp: number;
  /** assistant: 协议 content blocks（直接存储，不做二次转换） */
  blocks?: ContentBlock[];
  /** assistant: tool 结果，按 toolCall.id 索引 */
  toolResults?: Record<string, ToolResult>;
  streaming?: boolean;
  attachments?: MessageAttachment[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    [k: string]: any;
  };
  metadata?: { kind?: "block" | "final"; [k: string]: any };
  isError?: boolean;
  external?: boolean;
  externalFrom?: string;
  compact?: {
    status: "running" | "done" | "failed";
    mode?: "summary" | "fast";
    tokensBefore?: number;
    tokensAfter?: number;
    summaryPreview?: string;
    eventsCleared?: number;
    reason?: string;
  };
  eventIds?: string[];
  /** 本轮耗时（秒），turn_end 时计算写入 */
  durationSec?: number;
  /** 产生该消息的模型 ID（从 assistant_message_complete.metadata.model 提取） */
  model?: string;
  /** 本轮累积 token 用量（从 turn_end 的 token_usage 提取） */
  turnUsage?: {
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
    llm_calls: number;
  };
}

let _defaultWsCache: string | null = null;

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

export interface PlanStep {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface PlanData {
  goal: string;
  steps: PlanStep[];
}

// 鈹€鈹€鈹€ Per-session buckets (module-private) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface Bucket {
  messages: ChatMessage[];
  events: BusEvent[];
  seenEventIds: Set<string>;
  earliestTs: number | null;
  hasMoreHistory: boolean;
  lastUserInputTs: number | null;
  sessionStatus: SessionStatus;
  isBusy: boolean;
  error: string | null;
  retryState: RetryState | null;
  /** turn_start 的 timestamp（秒），turn_end 时用于计算耗时 */
  turnStartTs: number | null;
  /** 当前命中指令名（command_matched 时设置，turn_start 时清除） */
  commandName: string | null;
  /** 当前 session 的执行计划（从 session.metadata.plan 提取） */
  plan: PlanData | null;
}

const buckets = new Map<string, Bucket>();
const STREAM_TYPES = new Set(["assistant_message"]);
const _wsFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _wsBatches = new Map<string, BusEvent[]>();
const WS_BATCH_WINDOW_MS = 30;

const emptyBucket = (): Bucket => ({
  messages: [],
  events: [],
  seenEventIds: new Set<string>(),
  earliestTs: null,
  hasMoreHistory: false,
  lastUserInputTs: null,
  sessionStatus: "idle",
  isBusy: false,
  error: null,
  retryState: null,
  turnStartTs: null,
  commandName: null,
  plan: null,
});
function bucket(sid: string): Bucket {
  let b = buckets.get(sid);
  if (!b) buckets.set(sid, (b = emptyBucket()));
  return b;
}

const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

/** Extract text + eventIds from content blocks (no transformation) */
function extractFromBlocks(blocks: ContentBlock[]): { text: string; eventIds: string[] } {
  let text = "";
  const eventIds: string[] = [];
  for (const b of blocks) {
    if (b.type === "text") text += b.text;
    if (b.event_id) eventIds.push(b.event_id);
  }
  return { text, eventIds };
}



/** 褰?sid === activeId 鏃讹紝鎶?bucket 瀛楁闀滃儚鍒?store 椤跺眰銆?*/
function mirror(sid: string): void {
  if (useChat.getState().sessionId !== sid) return;
  const b = buckets.get(sid);
  if (!b) return;
  useChat.setState({
    messages: b.messages,
    isBusy: b.isBusy,
    sessionStatus: b.sessionStatus,
    error: b.error,
    retryState: b.retryState,
    lastUserInputTs: b.lastUserInputTs,
    turnStartTs: b.turnStartTs,
    commandName: b.commandName,
    plan: b.plan,
  });
}

// 鈹€鈹€鈹€ ID gen 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

let _idc = 0;
const nextId = (p = "msg") => `${p}_${Date.now()}_${++_idc}`;

// 鈹€鈹€鈹€ Event Reducer 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
//
// 鍚屾椂鏈嶅姟浜?ws 瀹炴椂浜嬩欢 鍜?history 鍥炴斁銆?// 璋冪敤鏂圭害鏉燂細姣忔鍙鐞嗕竴涓?event锛涜皟鐢ㄥ悗 bucket 瀛楁鏄柊寮曠敤锛堟暟缁勭骇 immutable锛夈€?
export interface BusEvent {
  type: string;
  data?: any;
  ts?: number;
  eventId?: string;
  /** ws 实时下行帧的帧 ID（BusMessage.id），用于回放去重 */
  frameId?: string;
  /** ws 瀹炴椂涓嬭甯х殑 metadata锛堝惈 frame_id 绛夌敤浜庡崰浣嶅幓閲嶇殑瀛楁锛?*/
  metadata?: Record<string, any>;
}

function eventDedupKey(ev: BusEvent): string | null {
  const topLevel = ev.eventId;
  if (typeof topLevel === "string" && topLevel) return topLevel;
  const dataEventId = ev.data?.event_id;
  if (typeof dataEventId === "string" && dataEventId) return dataEventId;
  return typeof ev.frameId === "string" && ev.frameId ? ev.frameId : null;
}

function seenEventIds(b: Bucket): Set<string> {
  if (!b.seenEventIds) b.seenEventIds = new Set<string>();
  return b.seenEventIds;
}

function hasSeenEvent(b: Bucket, ev: BusEvent): boolean {
  const key = eventDedupKey(ev);
  return !!key && seenEventIds(b).has(key);
}

function rememberEvent(b: Bucket, ev: BusEvent): boolean {
  const key = eventDedupKey(ev);
  if (!key) return true;
  const seen = seenEventIds(b);
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

export function applyEvent(b: Bucket, ev: BusEvent): void {
  if (!rememberEvent(b, ev)) return;
  const d = ev.data || {};
  const ts = ev.ts ?? Date.now();

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

  /** Ensure tail is a streaming assistant; create one if missing or sealed. */
  const ensure = (): void => {
    const t = tail();
    if (t && t.role === "assistant" && t.streaming) return;
    b.messages = [
      ...b.messages,
      {
        id: ev.frameId ?? nextId("ast"),
        role: "assistant",
        content: null,
        timestamp: ts,
        streaming: true,
        blocks: [],
        toolResults: {},
      },
    ];
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
    // 鈹€鈹€鈹€ 鍘嗗彶鍥炴斁涓撶敤锛氱敤鎴锋秷鎭?鈹€鈹€鈹€
    case "user_message": {
      if (d.metadata?.hide) {
        attachHiddenImageToLatestReadTool();
        return;
      }
      const frameId = (ev.metadata?.frame_id as string | undefined) ?? "";
      b.lastUserInputTs = ts;
      if (frameId && b.messages.some((m) => m.id === frameId)) return;
      const c = typeof d.content === "string"
        ? d.content
        : Array.isArray(d.content)
          ? d.content
              .filter((p: any) => p?.type === "text" || p?.type === "skill")
              .map((p: any) => String(p.text ?? p.data ?? "").trim())
              .join("\n")
              .trim()
          : "";
      const rawAtts: any[] = Array.isArray(d.attachments) ? d.attachments : [];
      const localAttachments: MessageAttachment[] = [];
      for (const a of rawAtts) {
        if (a && a.type === "image" && typeof a.mime_type === "string") {
          let url: string | undefined;
          let bytes: number | undefined;
          if (typeof a.data === "string") {
            url = `data:${a.mime_type};base64,${a.data}`;
            bytes = Math.floor(a.data.length * 0.75);
          } else if (typeof a.path === "string") {
            const filename = a.path.split(/[\\/]/).pop();
            if (filename) url = `${API_BASE}/api/images/${encodeURIComponent(filename)}`;
            bytes = a.size;
          }
          if (url) {
            localAttachments.push({ type: "image", url, mime: a.mime_type, name: a.name, bytes });
          }
        }
      }
      if (!c && localAttachments.length === 0) return;
      b.messages = [
        ...b.messages,
        {
          id: frameId || ev.frameId || nextId("user"),
          role: "user",
          content: c,
          timestamp: ts,
          ...(localAttachments.length > 0 ? { attachments: localAttachments } : {}),
        },
      ];
      return;
    }

    // 鈹€鈹€鈹€ 娴佸紡鏂囨湰鐗囨 鈹€鈹€鈹€
    case "assistant_message":
    case "assistant_message_complete": {
      const isComplete = ev.type === "assistant_message_complete";
      ensure();
      if (!isComplete && b.retryState) b.retryState = null;

      const blocks: ContentBlock[] = (Array.isArray(d.content) ? d.content : []) as ContentBlock[];
      const { text, eventIds } = extractFromBlocks(blocks);
      const metadata = isComplete ? (d.metadata || {}) : {};

      replaceTail((m) => ({
        ...m,
        // 流式阶段不更新 id：每次 assistant_message 的 ev.frameId 不同，
        // 会导致 React key 变化、组件销毁重建、useState 状态丢失。
        // 只在 complete 时设置最终 id。
        ...(isComplete ? { id: ev.frameId ?? m.id } : {}),
        blocks,
        content: text || null,
        streaming: !isComplete,
        ...(metadata.usage ? { usage: metadata.usage } : {}),
        ...(metadata.kind ? { metadata } : {}),
        ...(isComplete && typeof metadata.model === "string" && metadata.model ? { model: metadata.model } : {}),
        ...(eventIds.length > 0 ? { eventIds } : {}),
      }));
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
        blocks: text ? [{ type: "text", text }] : [],
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
    case "tool_result": {
      const id = d.id;
      const isErr = !!d.error;
      const rawMeta = d.metadata;
      console.log(
        `[DIFF-DBG] tool_result event: id=${id}, name=${d.name}, isErr=${isErr}` +
          `, metaExists=${rawMeta != null}` +
          `, metaKeys=${rawMeta ? Object.keys(rawMeta).join(",") : "none"}` +
          `, beforeLen=${rawMeta?.before?.length ?? -1}` +
          `, afterLen=${rawMeta?.after?.length ?? -1}` +
          `, beforeEqAfter=${rawMeta?.before === rawMeta?.after}` +
          `, file=${rawMeta?.file}` +
          `, additions=${rawMeta?.additions}` +
          `, deletions=${rawMeta?.deletions}` +
          `, diffLen=${rawMeta?.diff?.length ?? -1}`,
      );
      const result: ToolResult = {
        id,
        name: d.name || "",
        result: isErr ? null : (d.result ?? ""),
        error: isErr ? d.error : null,
        status: isErr ? "error" : "completed",
        metadata: d.metadata,
      };
      for (let i = b.messages.length - 1; i >= 0; i--) {
        const msg = b.messages[i];
        if (!msg.blocks) continue;
        const hasBlock = msg.blocks.some((bl) => bl.type === "toolCall" && bl.id === id);
        if (!hasBlock) continue;
        const next = b.messages.slice();
        next[i] = {
          ...msg,
          toolResults: { ...(msg.toolResults || {}), [id]: result },
        };
        b.messages = next;
        return;
      }
      return;
    }

    case "step": {
      const phase = d.phase;
      if (phase === "pipeline_start") {
        // pipeline 开始：立即标记忙
        b.isBusy = true;
        b.sessionStatus = "running";
        b.error = null;
        return;
      }
      if (phase === "pipeline_end") {
        // pipeline 结束：恢复空闲，清除 Turn 级临时状态
        b.isBusy = false;
        b.sessionStatus = "idle";
        b.commandName = null;
        return;
      }
      if (phase === "command_matched") {
        // 指令命中：状态栏更新为"执行指令..."
        b.isBusy = true;
        b.sessionStatus = "running";
        b.commandName = d.command_name ?? null;
        return;
      }
      if (phase === "turn_start") {
        b.isBusy = true;
        b.sessionStatus = "running";
        b.error = null;
        b.retryState = null;
        b.commandName = null; // 进入 agent 执行，清除指令标记
        b.turnStartTs = ts ?? null;
        return;
      }
      // phase === "turn_end"
      replaceTail((m) => m.streaming ? { ...m, streaming: false } : m);
      b.isBusy = false;
      b.sessionStatus = "idle";
      b.retryState = null;

      // 计算耗时并写入本轮最后一条 assistant 消息
      if (b.turnStartTs != null && ts != null) {
        const durationSec = Math.round((ts - b.turnStartTs) / 1000);
        const turnUsage = d.token_usage ?? undefined;
        for (let i = b.messages.length - 1; i >= 0; i--) {
          if (b.messages[i].role === "assistant" && !b.messages[i].streaming) {
            b.messages[i] = { ...b.messages[i], durationSec, ...(turnUsage ? { turnUsage } : {}) };
            break;
          }
        }
        b.turnStartTs = null;
      }

      if (d.reason === "error" && d.error_message) {
        const msg: string = d.error_message;
        const code = d.error_code;
        b.messages = [
          ...b.messages,
          { id: ev.frameId ?? nextId("err"), role: "assistant", content: msg, timestamp: ts, isError: true },
        ];
        b.error = code ? `[${code}] ${msg}` : msg;
      }
      return;
    }

    case "retry": {
      b.retryState = { attempt: d.attempt, maxAttempts: d.max_attempts, message: d.message };
      return;
    }

    // 鈹€鈹€鈹€ 涓婁笅鏂囧帇缂╀簨浠?鈹€鈹€鈹€
    case "context_compact_start": {
      // 鍚庡彴绌洪棽鍘嬬缉 / 鍏抽敭璺緞 raw 鍏滃簳甯?silent=true锛屽墠绔笉娓叉煋姘旀场锛堟棤鎰燂級
      if (d.silent === true) return;
      b.messages = [
        ...b.messages,
        {
          id: ev.frameId ?? nextId("compact"),
          role: "system" as Role,
          content: null,
          timestamp: ts,
          compact: {
            status: "running",
            tokensBefore: typeof d.tokens === "number" ? d.tokens : undefined,
          },
        },
      ];
      return;
    }

    case "context_compact_done": {
      if (d.silent === true) return;
      let foundRunning = false;
      for (let i = b.messages.length - 1; i >= 0; i--) {
        const m = b.messages[i];
        if (m.compact?.status === "running") {
          b.messages = [
            ...b.messages.slice(0, i),
            {
              ...m,
              compact: {
                status: "done",
                mode: typeof d.mode === "string" ? d.mode : "summary",
                tokensBefore: typeof d.tokens_before === "number" ? d.tokens_before : m.compact.tokensBefore,
                tokensAfter: typeof d.tokens_after === "number" ? d.tokens_after : undefined,
                summaryPreview: typeof d.summary === "string" ? d.summary : undefined,
                eventsCleared: typeof d.events === "number" ? d.events : undefined,
              },
            },
            ...b.messages.slice(i + 1),
          ];
          foundRunning = true;
          break;
        }
      }
      // fast 模式没有 start，直接创建一条 done 气泡
      if (!foundRunning) {
        b.messages = [
          ...b.messages,
          {
            id: nextId("compact"),
            role: "system" as Role,
            content: null,
            timestamp: ev.timestamp ?? Date.now(),
            compact: {
              status: "done",
              mode: typeof d.mode === "string" ? d.mode : "summary",
              tokensBefore: typeof d.tokens_before === "number" ? d.tokens_before : undefined,
              tokensAfter: typeof d.tokens_after === "number" ? d.tokens_after : undefined,
              summaryPreview: typeof d.summary === "string" ? d.summary : undefined,
              eventsCleared: typeof d.events === "number" ? d.events : undefined,
            },
          },
        ];
      }
      return;
    }

    case "context_compact_failed": {
      if (d.silent === true) return;
      for (let i = b.messages.length - 1; i >= 0; i--) {
        const m = b.messages[i];
        if (m.compact?.status === "running") {
          b.messages = [
            ...b.messages.slice(0, i),
            {
              ...m,
              compact: {
                status: "failed",
                reason: typeof d.reason === "string" ? d.reason : "鏈煡鍘熷洜",
              },
            },
            ...b.messages.slice(i + 1),
          ];
          break;
        }
      }
      return;
    }

    case "context_compact_enabled": {
      // 鑷姩鍚敤 pending 鎽樿鍙奖鍝嶅悗绔笂涓嬫枃瑙嗗浘锛沀I 涓嶉澶栨覆鏌撴皵娉°€?
      return;
    }

    case "context_compact": {
      if (d.silent === true) return;
      const mode = typeof d.mode === "string" ? d.mode : "summary";
      const summary = typeof d.summary === "string" ? d.summary : "";
      const eventsArr = Array.isArray(d.events) ? d.events : [];
      b.messages = [
        ...b.messages,
        {
          id: ev.frameId ?? nextId("compact"),
          role: "system" as Role,
          content: null,
          timestamp: ts,
          compact: {
            status: "done",
            mode,
            summaryPreview: summary,
            eventsCleared: eventsArr.length || undefined,
            tokensBefore: typeof d.tokens_before === "number" ? d.tokens_before : undefined,
            tokensAfter: typeof d.tokens_after === "number" ? d.tokens_after : undefined,
          },
        },
      ];
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
const __wsBoundFlag = "__ftreChatWsBound__";
if (!(globalThis as any)[__wsBoundFlag]) {
  (globalThis as any)[__wsBoundFlag] = true;

  let pageHidden = typeof document !== "undefined" ? document.hidden : false;

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      const wasHidden = pageHidden;
      pageHidden = document.hidden;
      if (wasHidden && !pageHidden) {
        // 鍒囧洖鍓嶅彴锛歠lush 鎵€鏈夋湭瀹屾垚鐨勬壒澶勭悊锛岄伩鍏嶆畫鐣?
        for (const sid of _wsBatches.keys()) {
          _flushWsBatch(sid);
        }
        const sid = useChat.getState().sessionId;
        if (sid) mirror(sid);
      }
    });
  }

  // 鈹€鈹€ WS 浜嬩欢寰壒澶勭悊锛氬悓涓€ session 鐨勮繛缁祦寮忎簨浠跺湪绐楀彛鍐呮敹闆嗭紝
  //    涓€鎶?apply + 涓€娆?mirror锛岄伩鍏?replay 鎵撳瓧鏈哄洖鏀?鈹€鈹€
  function _flushWsBatch(sid: string) {
    const timer = _wsFlushTimers.get(sid);
    if (timer) { clearTimeout(timer); _wsFlushTimers.delete(sid); }
    const events = _wsBatches.get(sid);
    if (!events || events.length === 0) return;
    _wsBatches.delete(sid);
    const b = bucket(sid);
    for (const ev of events) {
      applyEvent(b, ev);
    }
    mirror(sid);
  }

  function _enqueueWsEvent(sid: string, b: ReturnType<typeof bucket>, busEvent: BusEvent) {
    const evType = busEvent.type;
    if (STREAM_TYPES.has(evType)) {
      let batch = _wsBatches.get(sid);
      if (!batch) { batch = []; _wsBatches.set(sid, batch); }
      batch.push(busEvent);
      const existing = _wsFlushTimers.get(sid);
      if (existing) clearTimeout(existing);
      _wsFlushTimers.set(sid, setTimeout(() => _flushWsBatch(sid), WS_BATCH_WINDOW_MS));
      return;
    }
    _flushWsBatch(sid);
    applyEvent(b, busEvent);
    mirror(sid);
  }

  wsClient.onMessage((msg: ServerMessage) => {
    // 鍚庣鎷掔粷锛堥檮浠惰繚瑙勭瓑锛夛細椤跺眰 type="error"锛屼笉鏄?agent_event
    if (msg.type === "error") {
      const reason =
        (msg.data as any)?.message ||
        (msg.data as any)?.code ||
        "Request rejected";
      // 鍏虫帀瀵瑰簲 session 鐨?busy 鐘舵€?
      const sid = (msg.data as any)?.session_id || msg.metadata?.session_id;
      if (typeof sid === "string" && sid) {
        const b = bucket(sid);
        b.isBusy = false;
        b.sessionStatus = "idle";
        mirror(sid);
      }
      // 寮傛寮曞叆閬垮厤寰幆渚濊禆锛坣otification 鈫?chat 涓嶅簲璇ヨ缁戞锛?
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

    // 鍚庣鍦ㄩ鏉＄敤鎴锋秷鎭悗寮傛鐢熸垚鏍囬锛涘墠绔湁鑷繁鐨勪細璇濆垪琛ㄨ疆璇紝
    // 鎷垮埌鏂?title 鏄繜鏃╃殑浜嬶紝涓嶉渶瑕佷笓闂ㄧ殑 push 閫氱煡銆?
    // global_event锛氬叏灞€鎺у埗淇″彿锛坰ession 杩愯鎬佺瓑锛夛紝涓嶈繘 agent 浜嬩欢娴?
    if (msg.type === "global_event") {
      const ev = msg.data as any;
      if (ev?.type === "session_status") {
        const d = ev.data as any;
        if (d?.session_id) {
          const status = d.status as string;
          const b = bucket(d.session_id);
          if (status === "running" || status === "compacting" || status === "idle") {
            b.sessionStatus = status;
          }
          if (status === "running") {
            // 涓€杞紑濮嬶細杩涘叆 busy锛屾竻绌轰笂涓€杞畫鐣欑殑閿欒/閲嶈瘯鐘舵€?
            b.isBusy = true;
            b.error = null;
            b.retryState = null;
          } else if (status === "compacting") {
            b.isBusy = false;
            b.retryState = null;
          } else {
            b.isBusy = false;
            b.retryState = null;
          }
          mirror(d.session_id);
        }
        // 寮傛鍒锋柊浼氳瘽鍒楄〃锛坮unning 瀛楁锛?
        import("../stores/session")
          .then(({ useSession }) => useSession.getState().loadAllSessions())
          .catch(() => void 0);
      }
      return;
    }

    if (msg.type !== "agent_event") return;
    const ev = msg.data;
    if (!ev?.type) return;


    const sid = msg.metadata?.session_id as string | undefined;
    if (!sid) return;

    const b = bucket(sid);
    const busEvent: BusEvent = {
      type: ev.type,
      eventId: ev.event_id,
      data: ev.data,
      ts: typeof ev.timestamp === "number" ? ev.timestamp * 1000 : undefined,
      frameId: msg.frame_id,
      metadata: msg.metadata,
    };
    if (hasSeenEvent(b, busEvent)) return;
    // 鍏ユ《浜嬩欢缂撳瓨锛氬垎椤?/ refresh 閲嶆斁鏃惰鍥炲埌杩欐潯浜嬩欢娴?
    b.events.push(busEvent);
    if (pageHidden) {
      applyEvent(b, busEvent);
    } else {
      _enqueueWsEvent(sid, b, busEvent);
    }
    // assistant_message_complete: metadata.usage carries real usage data
    if (ev.type === "assistant_message_complete" && useChat.getState().sessionId === sid) {
      const u = (ev.data as any)?.metadata?.usage;
      if (u && typeof u.total_tokens === "number") {
        const newAnchor = {
          prompt_tokens: u.prompt_tokens ?? 0,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens,
          at: Date.now() / 1000,
          source: "assistant_message_complete" as const,
        };
        const pending_estimated = 0;
        const total = newAnchor.total_tokens + pending_estimated;
        useChat.setState({
          contextTokens: total,
          tokenUsage: {
            anchor: newAnchor,
            pending_estimated,
            total,
          },
        });
      }
    }
    // 鍏朵粬浜嬩欢锛氶渶瑕侀噸绠?pending_estimated 绛夛紝璋?API
    if ((ev.type === "step" || ev.type === "external_message" || ev.type === "context_compact_done" || ev.type === "context_compact_enabled") && useChat.getState().sessionId === sid) {
      useChat.getState().refreshTokenUsage(sid);
    }
  });

  wsClient.onConnect(() => {
    useChat.setState({ connected: true, wsStatus: "connected" });
    // 重连后重新拉取当前 session 的全量历史，保证断线期间的消息不丢失。
    // WS client 的 onopen 已经重发了 attach 帧，这里只需 HTTP 补数据 + 重建去重窗口。
    const { sessionId } = useChat.getState();
    if (sessionId) {
      import("../stores/session").then(({ useSession }) =>
        useSession.getState().reconnectSession(sessionId),
      );
    }
  });
  wsClient.onStatusChange((s) => useChat.setState({ wsStatus: s, connected: s === "connected" }));
  wsClient.onDisconnect(() => {
    // 鏂嚎锛氬叧鎺夋墍鏈?bucket 鐨?streaming 鐘舵€侊紝淇濈暀娑堟伅
    for (const [sid, b] of buckets) {
      b.isBusy = false;
      b.sessionStatus = "idle";
      const tail = last(b.messages);
      if (tail?.streaming) {
        const next = b.messages.slice();
        next[next.length - 1] = { ...tail, streaming: false };
        b.messages = next;
      }
      mirror(sid);
    }
    useChat.setState({ connected: false, wsStatus: "disconnected", sessionStatus: "idle", isBusy: false });
  });
}

// 鈹€鈹€鈹€ Store 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface ChatState {
  // mirrored from active bucket
  messages: ChatMessage[];
  lastUserInputTs: number | null;
  turnStartTs: number | null;
  commandName: string | null;
  plan: PlanData | null;
  sessionStatus: SessionStatus;
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
  agents: ChatAgent[];
  fetchAgents: () => Promise<void>;
  updateAgentLlm: (provider: string, model: string, reasoningEffort?: string) => Promise<void>;
  /** 褰撳墠浼氳瘽鐨勬€?token 鐢ㄩ噺鏄庣粏銆?   *  鐢卞悗绔?GET /api/sessions/{id}/token_usage 鎻愪緵锛屽湪鍒囨崲 session銆佹祦寮?done
   *  鍜?external_message 鍒拌揪鏃跺埛鏂般€?   *  - anchor: 鏈€杩戜竴娆?LLM 瀹炵畻鐨?usage锛堟棤鍒?null锛?   *  - pending_estimated: 閿氱偣涔嬪悗鏈疄绠楃殑浜嬩欢浼扮畻
   *  - total: anchor.total_tokens + pending_estimated */
  tokenUsage: {
    anchor: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      at: number;
      source: "assistant_message_complete";
    } | null;
    pending_estimated: number;
    total: number;
  } | null;
  /** @deprecated 淇濈暀 contextTokens 鍏煎鏃?selector锛岀瓑浠蜂簬 tokenUsage?.total ?? 0 */
  contextTokens: number;
  /** 褰撳墠閫変腑妯″瀷鐨勪笂涓嬫枃绐楀彛澶у皬锛坱oken 鏁帮級銆?   *  鐢?ModelSelector 鍦ㄩ€夋嫨妯″瀷 / 鍔犺浇榛樿鍊兼椂鍚屾杩涙潵锛涚敤浜?TokenRing 璁＄畻鐢ㄩ噺姣斾緥銆?   *  null 琛ㄧず灏氭湭閫夋嫨鎴栨ā鍨嬫湭閰嶇疆 context_window銆?*/
  contextWindow: number | null;
  /** 杩樻病鏈?sessionId 鏃讹紙娆㈣繋椤?/ 鏂板璇濓級鐢ㄦ埛棰勮鐨勫伐浣滃尯銆?   *  鍙戝嚭绗竴鏉℃秷鎭垱寤?session 鏃朵細浣滀负 query param 涓€璧蜂紶缁欏悗绔紝
   *  钀藉埌 sessions.workspace 瀛楁锛涙鍚?sessionId 灏辨垚浜嗙湡鍊硷紝pending 涓嶅啀浣跨敤銆?*/
  pendingWorkspace: string | null;

  sendMessage: (
    content: string | Array<{ type: string; text?: string; data?: unknown }>,
    attachments?: Array<{
      type: "image";
      mime_type: string;
      data: string;
      name?: string;
    }>,
    system?: boolean,
  ) => void;
  cancelStream: () => void;
  newChat: () => void;
  /** 鍒囧埌鎸囧畾 session锛堜笉鍙栨秷鍚庡彴鐢熸垚锛涚寮€鐨?session 闈犲巻鍙?+ WS replay 鎭㈠锛夈€?*/
  switchTo: (sessionId: string) => void;
  /** 浠呭綋妗朵负绌烘椂濉厖锛堥娆¤繘鍏?session 鐢級 */
  clearSessionCache: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  /** Put ChatMessage[] into the specified session bucket (history loader). */
  loadSessionMessages: (
    sessionId: string,
    messages: ChatMessage[],
    hasMoreHistory: boolean,
    status: SessionStatus,
    turnStartTs?: number | null,
    plan?: PlanData | null,
    commandName?: string | null,
  ) => void;
  /**
   * Prepend earlier ChatMessage[] to the session, deduping by message id.
   * Used for "load earlier messages" pagination.
   */
  prependSessionMessages: (
    sessionId: string,
    earlierMessages: ChatMessage[],
    hasMoreHistory: boolean,
  ) => void;
  /** 鍙栬 session 宸茬煡鏈€鏃╀簨浠剁殑 timestamp锛堢敤浣?鍔犺浇鏇存棭"鐨?before_ts锛?*/
  getEarliestEventTs: (sessionId: string) => number | null;
  /** 璇?session 鐨勫巻鍙叉槸鍚﹁繕鏈夋洿鏃╃殑椤靛彲鎷?*/
  hasMoreHistory: (sessionId: string) => boolean;
  setModel: (model: string | null) => void;
  setProvider: (provider: string | null) => void;
  setAgentId: (id: string) => void;
  /** 鍚屾褰撳墠妯″瀷鐨勪笂涓嬫枃绐楀彛澶у皬锛堢敱 ModelSelector 鍐欏叆锛?*/
  setContextWindow: (n: number | null) => void;
  /** 璁剧疆娆㈣繋椤?鏂板璇濈殑寰呯敤宸ヤ綔鍖恒€備細鍦ㄥ垱寤?session 鏃堕€忎紶缁欏悗绔€?*/
  setPendingWorkspace: (path: string | null) => void;
  /** 浠庡悗绔?config 棰勫姞杞介粯璁ゅ伐浣滃尯锛堝惎鍔ㄦ椂璋冪敤涓€娆★級 */
  initDefaultWorkspace: () => Promise<void>;
  /** 涓诲姩鍒锋柊褰撳墠 session 鐨?token 浼扮畻锛堝紓姝ワ紝澶辫触闈欓粯锛?*/
  refreshTokenUsage: (sessionId?: string) => Promise<void>;
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  lastUserInputTs: null,
  turnStartTs: null,
  commandName: null,
  plan: null,
  sessionStatus: "idle",
  isBusy: false,
  error: null,
  retryState: null,
  sessionId: null,
  connected: false,
  wsStatus: "disconnected" as WsConnectionStatus,
  model: null,
  provider: null,
  agentId: typeof localStorage !== "undefined"
    ? localStorage.getItem("ftre_agent_id") || "default"
    : "default",
  agents: [] as ChatAgent[],
  contextTokens: 0,
  tokenUsage: null,
  contextWindow: null,
  pendingWorkspace: null,

  sendMessage: (content, attachments, system) => {
    // 褰掍竴鍖栵細string 鎴?parts 鏁扮粍
    const parts: Array<{ type: string; text?: string; data?: unknown }> =
      typeof content === "string"
        ? content.trim()
          ? [{ type: "text", text: content.trim() }]
          : []
        : content;

    // 鎻愬彇绾枃鏈敤浜?empt check + local 鍥炴樉
    const displayText = parts
      .filter((p) => p.type === "text")
      .map((p) => String(p.text ?? p.data ?? "").trim())
      .join("\n")
      .trim();
    const hasSkill = parts.some((p) => p.type === "skill" && p.data);
    const hasAttachments = !!attachments && attachments.length > 0;
    if (!displayText && !hasSkill && !hasAttachments) return;

    // 绯荤粺绾ф寚浠わ紙濡?/cancel锛変负 ephemeral 鎺у埗锛屼笉鍒涘缓鏈湴鍋囨秷鎭紝涔熶笉涓诲姩鏀?busy 鐘舵€
    const isSystemCommand = !!system && !hasSkill && !hasAttachments;

    // 鏈湴鍥炴樉鐢細鎶婂悗绔崗璁舰鎬佺殑 attachments 杞垚甯?data URL 鐨勫舰鎬?
    const localAttachments: MessageAttachment[] | undefined = hasAttachments
      ? attachments!.map((a) => ({
        type: "image",
        url: `data:${a.mime_type};base64,${a.data}`,
        mime: a.mime_type,
        name: a.name,
        bytes: typeof a.data === "string" ? Math.floor(a.data.length * 0.75) : undefined,
      }))
      : undefined;

    const frameId = crypto.randomUUID().slice(0, 16);

    const userMsg: ChatMessage = {
      id: frameId,
      role: "user",
      content: displayText,
      timestamp: Date.now(),
      ...(localAttachments ? { attachments: localAttachments } : {}),
    };
    const send = (sid: string) => {
      const b = bucket(sid);
      if (!isSystemCommand) {
        b.messages = [...b.messages, userMsg];
        b.lastUserInputTs = null;
        b.isBusy = true;
        b.sessionStatus = "running";
        b.error = null;
        b.retryState = null;
        mirror(sid);
      }
      const { model, provider, agentId } = get();
      wsClient.sendChat(
        parts,
        {
          ...(model && { model }),
          ...(provider && { provider }),
          ...(agentId && { agent_id: agentId }),
          session_id: sid,
        },
        attachments,
        frameId,
      );
    };
    const sid = get().sessionId;
    if (sid) return send(sid);

    // 棣栨鍙戞秷鎭細fetch 鍒涘缓 session 鏈熼棿浼氭湁 100~500ms 缃戠粶寰€杩旓紝
    // 杩欐鏃堕棿濡傛灉浠€涔堥兘涓嶅仛锛孋hatView 浼氬洜涓?(!sessionId && !isBusy) 浠嶅仠鐣欏湪 WelcomeView锛?
    // 鐢ㄦ埛鐪嬩笉鍒拌嚜宸卞垰鍙戠殑娑堟伅锛屼篃鐪嬩笉鍒?ftre..."鍗犱綅銆?
    // 杩欓噷鍏堝悓姝ユ妸 isBusy 鍜?userMsg 椤跺埌 store top-level锛岃 UI 绔嬪嵆鍒囧埌瀵硅瘽瑙嗗浘銆?
    // fetch 杩斿洖鍚?send() 鈫?bucket.push(userMsg) 鈫?mirror() 浼氬啀娆″啓鍥炲悓涓€浠?messages锛?
    // 鍐呭涓€鑷达紝涓嶄細闂儊涔熶笉浼氶噸澶嶃€?
    set({ isBusy: true, sessionStatus: "running", messages: [...get().messages, userMsg], lastUserInputTs: null });

    createSessionRemote({
      channelId: "ws",
      workspace: get().pendingWorkspace,
    })
      .then((data) => {
        if (!data?.session_id) throw new Error("鍒涘缓浼氳瘽澶辫触");
        // 鍒涘缓鎴愬姛鍚庢竻鎺?pending 鈥斺€?sessions 琛?workspace 宸茬粡钀藉簱锛?
        // 鍚庣画浠?useSession 鍒楄〃璇伙紝涓嶅啀渚濊禆鍓嶇 pending 鐘舵€?
        set({ sessionId: data.session_id, pendingWorkspace: null });
        wsClient.subscribeOnly(data.session_id);
        send(data.session_id);
      })
      .catch(() => set({ isBusy: false, sessionStatus: "idle", error: "鍒涘缓浼氳瘽澶辫触" }));
  },

  cancelStream: () => {
    const sid = get().sessionId;
    if (!sid) return set({ isBusy: false, sessionStatus: "idle" });
    // 鍙?/cancel 鐨?user_message 甯э紝鍚庣绯荤粺绾ф寚浠ゅ湪 session lock 澶栧鐞?
    wsClient.sendCancel(sid);
  },

  newChat: () => {
    wsClient.subscribeOnly(null);
    set({ sessionId: null, messages: [], lastUserInputTs: null, turnStartTs: null, commandName: null, plan: null, sessionStatus: "idle", isBusy: false, error: null, retryState: null, contextTokens: 0, tokenUsage: null, pendingWorkspace: _defaultWsCache });
  },

  switchTo: (sessionId) => {
    const b = bucket(sessionId);
    set({ sessionId, messages: b.messages, lastUserInputTs: b.lastUserInputTs, turnStartTs: b.turnStartTs, commandName: b.commandName, plan: b.plan, sessionStatus: b.sessionStatus, isBusy: b.isBusy, error: b.error, retryState: b.retryState, contextTokens: 0, tokenUsage: null });
    void get().refreshTokenUsage(sessionId);
  },

  clearSessionCache: (sessionId) => {
    const timer = _wsFlushTimers.get(sessionId);
    if (timer) { clearTimeout(timer); _wsFlushTimers.delete(sessionId); }
    _wsBatches.delete(sessionId);
    buckets.set(sessionId, emptyBucket());
    mirror(sessionId);
  },

  setSessionStatus: (sessionId, status) => {
    const b = bucket(sessionId);
    b.sessionStatus = status;
    b.isBusy = status === "running";
    if (status === "running") {
      b.error = null;
      b.retryState = null;
    } else {
      b.retryState = null;
    }
    mirror(sessionId);
  },

  loadSessionMessages: (sessionId, messages, hasMoreHistory, status, turnStartTs, plan, commandName) => {
    const b = bucket(sessionId);
    const visibleCompactMessages = b.messages.filter((m) => m.compact && m.compact.status !== "running");
    b.messages = messages;
    b.events = [];
    b.seenEventIds = new Set<string>();
    for (const m of messages) {
      if (m.eventIds) for (const eid of m.eventIds) b.seenEventIds.add(eid);
    }
    b.earliestTs = messages.length > 0 ? messages[0].timestamp / 1000 : null;
    b.hasMoreHistory = hasMoreHistory;
    // 恢复 lastUserInputTs：取最后一条 user 消息的时间戳
    let lastUserTs: number | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserTs = messages[i].timestamp;
        break;
      }
    }
    b.lastUserInputTs = lastUserTs;
    b.sessionStatus = status;
    b.isBusy = status === "running";
    b.error = null;
    b.retryState = null;
    b.turnStartTs = turnStartTs ?? null;
    b.plan = plan ?? null;
    b.commandName = commandName ?? null;
    if (visibleCompactMessages.length > 0 && !b.messages.some((m) => m.compact)) {
      b.messages = [...b.messages, ...visibleCompactMessages];
    }
    if (!last(b.messages)?.streaming) {
      b.isBusy = false;
      if (b.sessionStatus === "running") b.sessionStatus = "idle";
    }
    mirror(sessionId);
  },

  prependSessionMessages: (sessionId, earlierMessages, hasMoreHistory) => {
    if (earlierMessages.length === 0) {
      const b = bucket(sessionId);
      b.hasMoreHistory = hasMoreHistory;
      return;
    }
    const b = bucket(sessionId);
    const tail = last(b.messages);
    if (tail?.streaming) return;
    const seen = new Set(earlierMessages.map((m) => m.id));
    const kept = b.messages.filter((m) => !seen.has(m.id));
    b.messages = [...earlierMessages, ...kept];
    for (const m of earlierMessages) {
      if (m.eventIds) for (const eid of m.eventIds) b.seenEventIds.add(eid);
    }
    b.earliestTs = earlierMessages.length > 0 ? earlierMessages[0].timestamp / 1000 : b.earliestTs;
    b.hasMoreHistory = hasMoreHistory;
    mirror(sessionId);
  },

  getEarliestEventTs: (sessionId) => bucket(sessionId).earliestTs,

  hasMoreHistory: (sessionId) => bucket(sessionId).hasMoreHistory,

  setModel: (model) => set({ model }),
  setProvider: (provider) => set({ provider }),
  setAgentId: (id) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("ftre_agent_id", id);
    }
    set({ agentId: id });
  },

  fetchAgents: async () => {
    const list = await fetchChatAgents();
    const currentId = get().agentId;
    // 如果当前 agentId 不在列表中，回退到 default
    if (list.length > 0 && !list.find((a) => a.id === currentId)) {
      const def = list.find((a) => a.id === "default") || list[0];
      if (def && def.id !== currentId) {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("ftre_agent_id", def.id);
        }
        set({ agents: list, agentId: def.id });
        return;
      }
    }
    set({ agents: list });
  },

  updateAgentLlm: async (provider, model, reasoningEffort) => {
    const { agentId } = get();
    if (!agentId) return;
    const patch: { llm: { provider?: string; model?: string; reasoning_effort?: string } } = { llm: { provider, model } };
    if (reasoningEffort !== undefined) patch.llm.reasoning_effort = reasoningEffort;
    const ok = await updateAgent(agentId, patch);
    if (ok) {
      set({ model, provider });
      await get().fetchAgents();
    }
  },

  setContextWindow: (n) => set({ contextWindow: n }),
  setPendingWorkspace: (path) => set({ pendingWorkspace: path }),

  initDefaultWorkspace: async () => {
    const { pendingWorkspace } = get();
    if (pendingWorkspace) return;
    try {
      const { fetchAppConfig } = await import("@/services/api");
      const cfg = await fetchAppConfig();
      const def = cfg?.default_workspace;
      if (typeof def === "string" && def.trim() && !get().pendingWorkspace) {
        _defaultWsCache = def.trim();
        set({ pendingWorkspace: def.trim() });
      }
    } catch { /* 闈欓粯澶辫触 */ }
  },

  refreshTokenUsage: async (sessionId) => {
    const sid = sessionId ?? get().sessionId;
    if (!sid) {
      set({ contextTokens: 0, tokenUsage: null });
      return;
    }
    try {
      // 鍔ㄦ€?import 鎵撶牬 chat 鈫?api 涔嬮棿鐨勫惊鐜紙api 涔熶細 import chat store锛?
      const { fetchTokenUsage } = await import("@/services/api");
      const usage = await fetchTokenUsage(sid);
      // 鍒锋柊杩囩▼涓鏋滅敤鎴峰凡缁忓垏璧颁簡 session锛屼涪寮冭繖娆＄粨鏋?
      if (get().sessionId !== sid) return;
      set({ contextTokens: usage.total, tokenUsage: usage });
    } catch (e) {
      // HTTP/缃戠粶澶辫触锛氫繚鐣欎笂涓€娆″€硷紝閬垮厤 UI 闂埌 0
      console.error("[chat] refreshTokenUsage failed:", e);
    }
  },
}));

// 鈹€鈹€鈹€ Selectors 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
