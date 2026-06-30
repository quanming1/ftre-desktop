/**
 * Chat Store 鈥?娑堣垂 ftre gateway WebSocket 浜嬩欢娴併€? *
 * 澶?session 妯″瀷锛? *   姣忎釜 session 鏈夌嫭绔?bucket锛坢essages/isBusy/error/retryState锛夈€? *   store 椤跺眰瀛楁鏄?active bucket 鐨勯暅鍍忥紙淇濈暀鏃ф秷璐?API: useChat((s)=>s.messages) 绛夛級銆? *   鍒?session 鏃剁洿鎺?hydrate锛涜繘琛屼腑鐨勬祦涓嶈鎵撴柇銆? *
 * 浜嬩欢婧愮粺涓€锛? *   ws 瀹炴椂浜嬩欢 鍜?history 鍥炴斁閮借蛋鍚屼竴涓?`applyEvent` reducer銆? */
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { wsClient } from "@/services/websocket-client";
import type { WsConnectionStatus, ServerMessage } from "@/services/websocket-client";
import { createSessionRemote, API_BASE } from "@/services/api";

// 鈹€鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export type Role = "assistant" | "user" | "system";
export type SessionStatus = "idle" | "running" | "compacting";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status: "pending" | "running" | "ok" | "error";
  result?: string;
}

export type MessagePart =
  | { type: "text"; text: string; data?: string; streaming?: boolean }
  | { type: "reasoning"; text: string; streaming?: boolean }
  | { type: "tool_call"; toolCallId: string }
  | { type: "skill"; data: string };

/** 鐢ㄦ埛娑堟伅闄勪欢锛堜笌鍚庣 attachments 鍗忚鍚屽舰锛宐ase64 宸茶浆鎴?data URL锛?*/
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
  /** 鐢ㄦ埛娑堟伅鎼哄甫鐨勯檮浠讹紙濡傚浘鐗囷級銆備粎鍦?role === "user" 鏃朵娇鐢ㄣ€?*/
  attachments?: MessageAttachment[];
  isError?: boolean;
  /** 澶栭儴 session 閫氳繃 send_message 娉ㄥ叆鐨勬秷鎭?*/
  external?: boolean;
  /** 澶栭儴娑堟伅鏉ユ簮鏍囪瘑锛坈hannel::session锛?*/
  externalFrom?: string;
  /** 涓婁笅鏂囧帇缂╃姸鎬佹秷鎭細鏍囪 + 鐘舵€?+ 鍏冧俊鎭?*/
  compact?: {
    status: "running" | "done" | "failed";
    tokensBefore?: number;
    summaryPreview?: string;
    reason?: string;
  };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    [k: string]: any;
  };
}

/** 鍚姩鏃朵粠鍚庣 config 棰勫姞杞界殑榛樿宸ヤ綔鍖虹紦瀛橈紝newChat() 鏃剁洿鎺ユ仮澶?*/
let _defaultWsCache: string | null = null;

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  message: string;
}

// 鈹€鈹€鈹€ Per-session buckets (module-private) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface Bucket {
  messages: ChatMessage[];
  /** 鍘熷浜嬩欢娴侊紙鎸?timestamp ASC锛夈€俽educer 鐨勮緭鍏ユ簮锛岀敤浜庡閲忓姞杞芥洿鏃╂秷鎭椂鐨勫彲閲嶅叆鍥炴斁銆?*/
  events: BusEvent[];
  seenEventIds: Set<string>;
  /** 宸茬煡鏈€鏃╀簨浠剁殑 timestamp锛坋vents[0].ts锛夛紱鐢ㄤ簬"鍔犺浇鏇存棭"鍒嗛〉鏃朵綔涓?before_ts銆俷ull = 杩樻病鎷夎繃 / 娌℃秷鎭?*/
  earliestTs: number | null;
  /** 鍘嗗彶鏄惁杩樻湁鏇存棭鐨勯〉鍙互鎷夛紙鍩轰簬鍚庣 has_more锛?*/
  hasMoreHistory: boolean;
  lastUserInputTs: number | null;
  sessionStatus: SessionStatus;
  isBusy: boolean;
  error: string | null;
  retryState: RetryState | null;
}

const buckets = new Map<string, Bucket>();
const STREAM_TYPES = new Set(["assistant_message", "reasoning", "tool_call_streaming"]);
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
});
function bucket(sid: string): Bucket {
  let b = buckets.get(sid);
  if (!b) buckets.set(sid, (b = emptyBucket()));
  return b;
}

const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1];

/**
 * 浠庢湯灏惧悜鍓嶆壘鏈€杩戜竴涓粛鍦ㄦ祦寮忓～鍏呯殑 text/reasoning part 绱㈠紩銆傛壘涓嶅埌杩斿洖 -1銆? *
 * 鐢ㄤ簬 assistant_message_complete / reasoning_complete 鏀跺熬锛? * 娴佸紡 chunk 鏈熼棿浼氬湪 parts 閲屼繚鐣?streaming=true 鐨勫崰浣嶆锛宑omplete 浜嬩欢
 * 鍒拌揪鏃舵妸瀹冩浛鎹㈡垚鏉冨▉鎬诲拰銆倀ool_call / tool_call_streaming 鍙兘鍦?complete
 * 涔嬪墠鍏堟妸 tool part 鎺ㄥ埌鏈熬锛屽洜姝や笉鑳藉彧鐪?parts[-1]锛岃寰€鍓嶆壂鍒?streaming 娈点€? *
 * 涓ユ牸鍖归厤 streaming=true锛氬凡灏佸彛鐨勬灞炰簬"涓婁竴杞凡瀹屾垚"鎴?鍥炴斁璺緞涓嬩笉瀛樺湪
 * streaming"锛宑omplete 浜嬩欢涓嶈兘鍘昏鐩栧畠浠€? */
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
 * 鎶婃湯灏炬鍦ㄦ祦寮忓～鍏呯殑 text / reasoning part 灏佸彛锛坰treaming=false锛夈€? *
 * 鐜板湪鍙湪鍏滃簳鍦烘櫙浣跨敤锛歞one 浜嬩欢 / 鍥炴斁缁撴潫鍚庛€傛棩甯哥殑 *_complete 璧? * findStreamingIdx 鑷繁鎵句綅缃€? */
function sealStreamingPart(parts: MessagePart[]): void {
  const tail = parts[parts.length - 1];
  if (!tail) return;
  if ((tail.type === "text" || tail.type === "reasoning") && tail.streaming) {
    parts[parts.length - 1] = { ...tail, streaming: false };
  }
}

/** 褰?sid === activeId 鏃讹紝鎶?bucket 瀛楁闀滃儚鍒?store 椤跺眰銆?*/
function reopenAssistantTail(b: Bucket): void {
  const tail = last(b.messages);
  if (!tail || tail.role !== "assistant" || tail.isError) return;

  const parts = [...(tail.parts || [])];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.type === "text" || part.type === "reasoning") {
      parts[i] = { ...part, streaming: true };
      break;
    }
  }

  const next = b.messages.slice();
  next[next.length - 1] = { ...tail, parts, streaming: true };
  b.messages = next;
}

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
  /** 鍘嗗彶鍥炴斁鏃跺彲鎸囧畾娑堟伅 id锛堜繚鐣欏師 id锛夛紝ws 璧?nextId */
  id?: string;
  /** ws 瀹炴椂涓嬭甯х殑 metadata锛堝惈 frame_id 绛夌敤浜庡崰浣嶅幓閲嶇殑瀛楁锛?*/
  metadata?: Record<string, any>;
}

function eventDedupKey(ev: BusEvent): string | null {
  const topLevel = ev.eventId;
  if (typeof topLevel === "string" && topLevel) return topLevel;
  const dataEventId = ev.data?.event_id;
  if (typeof dataEventId === "string" && dataEventId) return dataEventId;
  return typeof ev.id === "string" && ev.id ? ev.id : null;
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

  /** 纭繚鏈変竴鏉?streaming assistant锛涙病鏈夊氨 push 涓€鏉＄┖鐨勩€?*/
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

  const attachHiddenImageToLatestReadTool = (): void => {
    if (!d.metadata?.hide || !Array.isArray(d.content)) return;
    if (!d.content.some((p: any) => p?.type === "image_file" && typeof p.path === "string")) return;

    const hasImagePayload = (value: unknown): boolean => {
      if (typeof value !== "string" || !value) return false;
      try {
        return JSON.stringify(JSON.parse(value)).includes('"image_file"');
      } catch {
        return false;
      }
    };

    for (let i = b.messages.length - 1; i >= 0; i--) {
      const toolCalls = b.messages[i].toolCalls;
      if (!toolCalls?.length) continue;
      for (let j = toolCalls.length - 1; j >= 0; j--) {
        const tc = toolCalls[j];
        const name = typeof tc.name === "string" ? tc.name.toLowerCase() : "";
        if ((name === "read" || name === "read_file") && !hasImagePayload(tc.result)) {
          const nextMessages = b.messages.slice();
          const nextToolCalls = toolCalls.slice();
          nextToolCalls[j] = { ...tc, status: "ok", result: JSON.stringify(d) };
          nextMessages[i] = { ...nextMessages[i], toolCalls: nextToolCalls };
          b.messages = nextMessages;
          return;
        }
      }
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
      const c = typeof d.content === "string" ? d.content : "";
      const parts: MessagePart[] | undefined = Array.isArray(d.content)
        ? (d.content as MessagePart[])
        : undefined;
      const rawAtts: any[] = Array.isArray(d.attachments) ? d.attachments : [];
      const localAttachments: MessageAttachment[] = [];
      const hasPartsContent = parts && parts.some(
        (p) => p.type === "text" || p.type === "skill",
      );
      for (const a of rawAtts) {
        if (
          a &&
          a.type === "image" &&
          typeof a.mime_type === "string"
        ) {
          // 瀹炴椂娑堟伅锛氭湁 base64 data 鈫?鎷?data URL
          // 鍘嗗彶娑堟伅锛氬彧鏈?path 鈫?鐢?HTTP URL 浠庡悗绔姞杞?
          let url: string | undefined;
          let bytes: number | undefined;
          if (typeof a.data === "string") {
            url = `data:${a.mime_type};base64,${a.data}`;
            bytes = Math.floor(a.data.length * 0.75);
          } else if (typeof a.path === "string") {
            const filename = a.path.split(/[\\/]/).pop();
            if (filename) {
              url = `${API_BASE}/api/images/${encodeURIComponent(filename)}`;
            }
            bytes = a.size;
          }
          if (url) {
            localAttachments.push({
              type: "image",
              url,
              mime: a.mime_type,
              name: typeof a.name === "string" ? a.name : undefined,
              bytes,
            });
          }
        }
      }
      if (!c && !hasPartsContent && localAttachments.length === 0) return;
      b.messages = [
        ...b.messages,
        {
          id: frameId || ev.id || nextId("user"),
          role: "user",
          content: c,
          parts,
          timestamp: ts,
          ...(localAttachments.length > 0 ? { attachments: localAttachments } : {}),
        },
      ];
      return;
    }

    // 鈹€鈹€鈹€ 娴佸紡鏂囨湰鐗囨 鈹€鈹€鈹€
    case "assistant_message": {
      ensure();
      const chunk = d.content || "";
      if (!chunk) return;
      // 鏀跺埌鏂扮殑娴佸紡鍐呭璇存槑閲嶈瘯鎴愬姛锛屾竻闄ら噸璇曟í骞?
      if (b.retryState) b.retryState = null;
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        const lastPart = parts[parts.length - 1];
        // 鏈熬濡傛灉鏄釜杩樺湪濉殑 text part 灏辫拷鍔狅紱鍚﹀垯寮€鏂版銆?        // 浠讳綍"闈?text chunk 鐨勪簨浠?鍒拌揪鏃堕兘浼氳皟 sealStreamingPart 鎶婅繖娈靛皝鍙ｏ紝
        // 涔嬪悗鍐嶆潵 chunk 灏变笉浼氳骞跺埌涓婁竴娈点€?
        if (lastPart?.type === "text" && lastPart.streaming) {
          parts[parts.length - 1] = { type: "text", text: lastPart.text + chunk, streaming: true };
        } else {
          parts.push({ type: "text", text: chunk, streaming: true });
        }
        return { ...m, parts, content: (m.content ?? "") + chunk, streaming: true };
      });
      return;
    }

    // 鈹€鈹€鈹€ 娴佸紡鏂囨湰鏈€缁堝寲锛坵s锛? 鍘嗗彶鍥炴斁瀹屾暣鏂囨湰 鈹€鈹€鈹€
    // 涓嶅湪姝ゅ缃?message.streaming=false锛涚敱 done 浜嬩欢缁熶竴鏀跺熬銆?
    case "assistant_message_complete": {
      ensure();
      const final = d.content || "";
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        // 鎵句竴涓繕鍦ㄦ祦寮忓～鍏呯殑 text part锛堝嵆渚挎湯灏炬槸 tool_call 涔熻兘鎵惧埌锛夛細
        // - 瀹炴椂璺緞锛氬厛 message chunk 绱Н鍑?streaming text 鈫?涓棿鍙兘鎻掑叆
        //   tool_call_streaming 鎺ㄥ埌鏈熬 鈫?姝?complete 浠嶈兘閿佸畾鍒版祦寮忔骞跺皝鍙?
        // - 鍥炴斁璺緞锛欴B 娌℃湁 chunk锛屾壘涓嶅埌娴佸紡娈?鈫?push 涓€涓凡灏佸彛鐨勬柊娈?
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

    // 鈹€鈹€鈹€ 澶栭儴 session 閫氳繃 send_message 娉ㄥ叆鐨勫畬鏁存秷鎭?鈹€鈹€鈹€
    // 涓庣洰鏍?session 鑷繁鐨勬祦寮忚緭鍑烘棤鍏筹紝鐙珛鎴愭秷鎭€?
    // 鑻ュ綋鍓嶆鏈?streaming tail锛屽垯鎻掑湪瀹冧箣鍓嶏紝閬垮厤瑙嗚閿欎綅銆?
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
        // 涓嶈 streaming锛氳繖鏄閮ㄥ畬鏁存彃鍏ユ秷鎭?
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
      if (b.retryState) b.retryState = null;
      replaceTail((m) => {
        const parts = [...(m.parts || [])];
        const lastPart = parts[parts.length - 1];
        // 璺?message chunk 鍚屾€濊矾锛氭湯灏炬槸娴佸紡 reasoning 灏辫拷鍔狅紝鍚﹀垯寮€鏂版
        if (lastPart?.type === "reasoning" && lastPart.streaming) {
          parts[parts.length - 1] = { type: "reasoning", text: lastPart.text + chunk, streaming: true };
        } else {
          parts.push({ type: "reasoning", text: chunk, streaming: true });
        }
        return { ...m, parts, reasoning: (m.reasoning ?? "") + chunk };
      });
      return;
    }

    // 鈹€鈹€鈹€ 涓€杞€濊€冪殑瀹屾暣鏂囨湰锛堝搴?assistant_message_complete 鐨?reasoning 鐗堬級 鈹€鈹€鈹€
    // 瀹炴椂锛歳easoning chunks 鍚庡埌杈撅紝鍘熷湴瑕嗙洊灏佸彛
    // 鍥炴斁锛欴B 鍙湁 reasoning_complete 娌℃湁 chunk锛岀洿鎺?push
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
        // 鍏煎鏃у瓧娈碉細鎶婃墍鏈?reasoning part 鏂囨湰鎷艰捣鏉?
        const reasoning = parts
          .filter((p): p is { type: "reasoning"; text: string; streaming?: boolean } => p.type === "reasoning")
          .map((p) => p.text)
          .join("\n\n");
        return { ...m, parts, reasoning };
      });
      return;
    }

    // 鈹€鈹€鈹€ 宸ュ叿璋冪敤锛堜竴娆℃€э紝鍚畬鏁?args锛?鈹€鈹€鈹€
    case "tool_call": {
      ensure();
      const id: string = d.id ?? "";
      const name: string = d.name ?? "unknown";
      const args = typeof d.arguments === "object" ? JSON.stringify(d.arguments) : String(d.arguments ?? "{}");
      replaceTail((m) => {
        const toolCalls = [...(m.toolCalls || [])];
        const parts = [...(m.parts || [])];
        // 涓嶅湪杩欓噷 seal 褰撳墠娴佸紡 text/reasoning锛氱◢鍚?*_complete 浼氱敤
        // findStreamingIdx 鑷繁鎵惧埌閭ｆ鍋氭渶缁堣鐩栥€傚鏋滃厛 seal 浜嗭紝complete
        // 灏辨壘涓嶅埌娴佸紡娈碉紝浼氬彟璧蜂竴娈碉紝閫犳垚鍚屼竴娈垫枃瀛楁覆鏌撲袱娆°€?
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

    // 鈹€鈹€鈹€ 宸ュ叿璋冪敤娴佸紡澧為噺锛坅rgs 鍒嗙墖锛?鈹€鈹€鈹€
    case "tool_call_streaming": {
      ensure();
      if (b.retryState) b.retryState = null;
      const chunks: any[] = d.tool_calls || [];
      replaceTail((m) => {
        const toolCalls = [...(m.toolCalls || [])];
        const parts = [...(m.parts || [])];
        // 鍚?tool_call锛氫笉 seal锛岃 *_complete 鑷繁鎵炬祦寮忔瑕嗙洊
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

    // 鈹€鈹€鈹€ 宸ュ叿缁撴灉锛氫粠灏鹃儴寰€鍓嶆壘鍒板搴?tc 鍐欏叆 鈹€鈹€鈹€
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
      b.sessionStatus = "idle";
      b.retryState = null;
      return;
    }

    case "error": {
      const msg: string = d.message ?? "鏈煡閿欒";
      const code = d.code;
      // 鍏堝叧鎺夊墠涓€鏉?streaming 娑堟伅锛堝鏋滄湁锛?
      replaceTail((m) => ({ ...m, streaming: false }));
      b.messages = [
        ...b.messages,
        { id: ev.id ?? nextId("err"), role: "assistant", content: msg, timestamp: ts, isError: true },
      ];
      b.isBusy = false;
      b.sessionStatus = "idle";
      b.error = code ? `[${code}] ${msg}` : msg;
      return;
    }

    case "retry": {
      // 閲嶈瘯鏃跺彧娓呴櫎褰撳墠 streaming assistant 灏鹃儴姝ｅ湪娴佸紡鎷兼帴鐨勬畫鐗?parts锛?
      // 淇濈暀涔嬪墠宸插畬鎴愮殑 tool_call / tool_result 绛?parts 涓嶅彈褰卞搷銆?
      const retryTail = tail();
      if (retryTail) {
        replaceTail((m) => {
          // 浠庢湯灏剧Щ闄ゆ墍鏈夎繕鍦?streaming 鐨?text/reasoning parts锛堟湭灏佸彛鐨勬畫鐗囷級
          const parts = [...(m.parts || [])];
          while (parts.length > 0) {
            const last = parts[parts.length - 1];
            if ((last.type === "text" || last.type === "reasoning") && last.streaming) {
              parts.pop();
            } else {
              break;
            }
          }
          // 閲嶆柊鎷兼帴 content 鍜?reasoning锛堝彧淇濈暀宸插皝鍙ｇ殑锛?
          const content = parts
            .filter((p): p is { type: "text"; text: string; streaming?: boolean } => p.type === "text")
            .map((p) => p.text)
            .join("") || null;
          const reasoning = parts
            .filter((p): p is { type: "reasoning"; text: string; streaming?: boolean } => p.type === "reasoning")
            .map((p) => p.text)
            .join("") || undefined;
          return { ...m, parts, content, reasoning, streaming: false };
        });
      }
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
          id: ev.id ?? nextId("compact"),
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
      // 鎵炬渶鍚庝竴鏉?running 鐨勫帇缂╂秷鎭紝鏍囪涓?done
      for (let i = b.messages.length - 1; i >= 0; i--) {
        const m = b.messages[i];
        if (m.compact?.status === "running") {
          b.messages = [
            ...b.messages.slice(0, i),
            {
              ...m,
              compact: {
                status: "done",
                tokensBefore: typeof d.tokens_before === "number" ? d.tokens_before : m.compact.tokensBefore,
                summaryPreview: typeof d.summary === "string" ? d.summary : undefined,
              },
            },
            ...b.messages.slice(i + 1),
          ];
          break;
        }
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

    // 鈹€鈹€鈹€ 鍘嗗彶鍥炴斁锛歝ontext_compact 浜嬩欢 鈹€鈹€鈹€
    case "context_compact": {
      // 鍘嗗彶鍥炴斁鏃堕亣鍒板帇缂╀簨浠讹細silent 鏍囪鐨勫帇缂╋紙鍚庡彴/raw 鍏滃簳锛変笉鍦ㄥ巻鍙查噷
      // 鏄惧紡娓叉煋姘旀场鈥斺€斿悗绔?silent 宸茬粡钀藉埌 payload 涓婏紝鍓嶇杩欓噷鐩存帴璺宠繃銆?
      // 鐢ㄦ埛涓诲姩 /compact 鎵嶄細鐣欎笅鍙姘旀场銆?
      if (d.silent === true) return;
      // 涔嬪墠鐨勫巻鍙叉秷鎭繚鐣欏彲瑙侊紙鍓嶇鍙仛"鎻愮ず杩欓噷鍘嬬缉杩囦簡"锛屼笉鍋氬疄闄呮姌鍙狅級
      const summary = typeof d.summary === "string" ? d.summary : "";
      b.messages = [
        ...b.messages,
        {
          id: ev.id ?? nextId("compact"),
          role: "system" as Role,
          content: null,
          timestamp: ts,
          compact: {
            status: "done",
            summaryPreview: summary,
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
      id: msg.id,
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

    // 鈹€鈹€ 瀹炴椂鍒锋柊涓婁笅鏂囩敤閲?鈹€鈹€
    // usage_update锛氫簨浠惰嚜甯?usage 鏁版嵁锛屽氨鍦版洿鏂?store锛屾棤闇€鍐嶈皟 API
    if (ev.type === "usage_update" && useChat.getState().sessionId === sid) {
      const u = (ev.data as any)?.usage;
      if (u && typeof u.total_tokens === "number") {
        const current = useChat.getState().tokenUsage;
        // anchor 鏄繖娆″疄绠楃殑 usage锛沺ending_estimated 浠庝笂娆＄殑鍊煎噺鍘绘湰娆″疄绠楄鐩栫殑閮ㄥ垎
        const prevAnchorTotal = current?.anchor?.total_tokens ?? 0;
        const newAnchor = {
          prompt_tokens: u.prompt_tokens ?? 0,
          completion_tokens: u.completion_tokens ?? 0,
          total_tokens: u.total_tokens,
          at: Date.now() / 1000,
          source: "usage_update",
        };
        // 鏂?anchor 涔嬪悗鐨勪簨浠朵及绠楁殏鏃朵负 0锛堝洜涓鸿繕娌′骇鐢熸柊浜嬩欢锛?
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
    if ((ev.type === "done" || ev.type === "external_message" || ev.type === "context_compact_done" || ev.type === "context_compact_enabled") && useChat.getState().sessionId === sid) {
      useChat.getState().refreshTokenUsage(sid);
    }
  });

  wsClient.onConnect(() => useChat.setState({ connected: true, wsStatus: "connected" }));
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
  /** 褰撳墠浼氳瘽鐨勬€?token 鐢ㄩ噺鏄庣粏銆?   *  鐢卞悗绔?GET /api/sessions/{id}/token_usage 鎻愪緵锛屽湪鍒囨崲 session銆佹祦寮?done
   *  鍜?external_message 鍒拌揪鏃跺埛鏂般€?   *  - anchor: 鏈€杩戜竴娆?LLM 瀹炵畻鐨?usage锛堟棤鍒?null锛?   *  - pending_estimated: 閿氱偣涔嬪悗鏈疄绠楃殑浜嬩欢浼扮畻
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
  ) => void;
  cancelStream: () => void;
  newChat: () => void;
  /** 鍒囧埌鎸囧畾 session锛堜笉鍙栨秷鍚庡彴鐢熸垚锛涚寮€鐨?session 闈犲巻鍙?+ WS replay 鎭㈠锛夈€?*/
  switchTo: (sessionId: string, initialMessages?: ChatMessage[]) => void;
  /** 浠呭綋妗朵负绌烘椂濉厖锛堥娆¤繘鍏?session 鐢級 */
  hydrateSession: (sessionId: string, messages: ChatMessage[]) => void;
  /** 鐢ㄦ渶鏂版暟鎹浛鎹㈡《锛坰treaming 涓烦杩囷級 */
  refreshSession: (sessionId: string, messages: ChatMessage[]) => void;
  hasSessionCache: (sessionId: string) => boolean;
  /** 娓呯┖鎸囧畾 session 鐨勬湰鍦扮紦瀛橈紙娑堟伅銆佷簨浠躲€佺姸鎬侊級 */
  clearSessionCache: (sessionId: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  /** 鎶婁竴缁?BusEvent 鍠傜粰鎸囧畾 session锛坔istory loader 鐢級 */
  loadSessionEvents: (sessionId: string, events: BusEvent[], mode: "hydrate" | "refresh") => void;
  /**
   * 鎶婁竴娈垫洿鏃╃殑 BusEvent prepend 鍒?session 鐨勪簨浠舵祦锛岄噸鏂拌蛋涓€閬?reducer 閲嶅缓 messages銆?   * 鐢ㄤ簬"鍔犺浇鏇存棭娑堟伅"鍒嗛〉锛歟vents 鏄垎椤垫媺鍒扮殑鏇存棭涓€娈碉紙鎸?timestamp ASC 鎺掑ソ锛夈€?   *
   * mode 涓?loadSessionEvents 涓€鑷达細
   *   - hydrate锛氫粎褰撴《闈炵┖涓斾笌鐜版湁 events 涓嶉噸鍙犳椂鎻掑叆锛堥娆℃媺鏃╂湡鍒嗛〉锛?   *   - refresh锛氭祦寮忎腑璺宠繃锛涢潪娴佸紡鏃跺悎骞跺幓閲嶅啀閲嶆斁
   */
  prependSessionEvents: (
    sessionId: string,
    events: BusEvent[],
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
  sessionStatus: "idle",
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
  pendingWorkspace: null,

  sendMessage: (content, attachments) => {
    // 褰掍竴鍖栵細string 鎴?parts 鏁扮粍
    const parts: Array<{ type: string; text?: string; data?: unknown }> =
      typeof content === "string"
        ? content.trim()
          ? [{ type: "text", text: content.trim() }]
          : []
        : content;

    // 鎻愬彇绾枃鏈敤浜?empt check + local 鍥炴樉
    const displayText = parts
      .filter((p) => p.type === "text")
      .map((p) => String(p.text ?? p.data ?? "").trim())
      .join("\n")
      .trim();
    const hasSkill = parts.some((p) => p.type === "skill" && p.data);
    const hasAttachments = !!attachments && attachments.length > 0;
    if (!displayText && !hasSkill && !hasAttachments) return;

    // /cancel 鏄?ephemeral 鎺у埗鎸囦护锛屼笉鍒涘缓鏈湴鍋囨秷鎭紝涔熶笉涓诲姩鏀?busy 鐘舵€?
    const isCancelCommand = displayText === "/cancel" && !hasSkill && !hasAttachments;

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
      parts: parts.length > 0 ? (parts as any) : undefined,
      timestamp: Date.now(),
      ...(localAttachments ? { attachments: localAttachments } : {}),
    };
    const send = (sid: string) => {
      const b = bucket(sid);
      if (!isCancelCommand) {
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
    set({ sessionId: null, messages: [], lastUserInputTs: null, sessionStatus: "idle", isBusy: false, error: null, retryState: null, contextTokens: 0, tokenUsage: null, pendingWorkspace: _defaultWsCache });
  },

  switchTo: (sessionId, initialMessages) => {
    const b = bucket(sessionId);
    if (initialMessages && b.messages.length === 0) b.messages = initialMessages;
    set({ sessionId, messages: b.messages, lastUserInputTs: b.lastUserInputTs, sessionStatus: b.sessionStatus, isBusy: b.isBusy, error: b.error, retryState: b.retryState, contextTokens: 0, tokenUsage: null });
    // WS attach 绉诲埌 switchSession 鐨?HTTP .then() 涓紝淇濊瘉 HTTP 鍏堜簬 WS锛?
    // 閬垮厤 replay/live 甯у拰 loadSessionEvents 鐨勬竻绌烘搷浣滅珵浜夈€?
    // 寮傛鎷変竴娆℃渶鏂?token 浼扮畻锛堜笉闃诲 UI 鍒囨崲锛?
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
    if (tail?.streaming) return;
    b.messages = messages;
    mirror(sessionId);
  },

  hasSessionCache: (_sessionId) => {
    // 鏆傛椂绂佺敤鏈湴缂撳瓨锛屾瘡娆?switchSession 閮借蛋 HTTP + WS
    return false;
  },

  clearSessionCache: (sessionId) => {
    // 涓㈠純璇?session 鏈?flush 鐨勬壒澶勭悊锛坆ucket 鍗冲皢琚浛鎹紝鏃т簨浠舵棤鎰忎箟锛?
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
      reopenAssistantTail(b);
      b.error = null;
      b.retryState = null;
    } else {
      b.retryState = null;
    }
    mirror(sessionId);
  },

  loadSessionEvents: (sessionId, events, mode) => {
    const b = bucket(sessionId);
    const tail = last(b.messages);
    if (mode === "refresh" && tail?.streaming) return;
    // 绂佺敤缂撳瓨鍚?bucket 宸插湪 switchSession 涓竻绌猴紝涓嶉渶瑕?length > 0 淇濇姢
    const visibleCompactMessages =
      mode === "refresh" ? b.messages.filter((m) => m.compact && m.compact.status !== "running") : [];
    b.messages = [];
    b.events = [];
    b.seenEventIds = new Set<string>();
    b.earliestTs = events.length > 0 ? events[0].ts ?? null : null;
    b.lastUserInputTs = null;
    // hasMoreHistory 鐢辫皟鐢ㄦ柟鍦ㄥ垎椤靛搷搴斾腑鍛婄煡锛涜繖閲屽厛涓嶅姩锛坙oadSessionEvents 鍙?
    // 鎺ユ敹涓€娈?events锛屼笉鐭ラ亾鏇存棭杩樻湁娌℃湁锛夈€俿ession.ts 鍦ㄥ垎椤佃矾寰勯噷鐩存帴璋?
    // prependSessionEvents 鏉ヨ〃杈?杩樻湁鏇存棭"銆?
    for (const ev of events) {
      if (hasSeenEvent(b, ev)) continue;
      b.events.push(ev);
      applyEvent(b, ev);
    }
    // history 鍥炴斁瀹屾瘯锛氳嫢灏鹃儴浠嶆爣璁?streaming锛堟棤鏄惧紡 done锛夛紝鏀跺熬銆?
    // 鍚屾鎶婃湯灏捐繕鍦?娴佸紡濉厖"鐨?part 涔熷皝鍙ｏ紝閬垮厤閬楃暀鐘舵€佸奖鍝嶅悗缁垽鏂€?
    const t = last(b.messages);
    if (t?.streaming) {
      const parts = [...(t.parts || [])];
      sealStreamingPart(parts);
      const next = b.messages.slice();
      next[next.length - 1] = { ...t, parts, streaming: false };
      b.messages = next;
    }
    // context_compact 浼氭寜鍘嗗彶杈圭晫 timestamp 鍥炴彃锛屽埛鏂版渶鏂伴〉鏃跺彲鑳芥嬁涓嶅埌杩欐潯
    // 鎸佷箙鍖栦簨浠躲€備繚鐣欏疄鏃惰矾寰勫凡缁忔樉绀虹殑鎵嬪姩 /compact 姘旀场锛岄伩鍏?idle 鍚庡埛鏂版妸瀹冩姽鎺夈€?
    if (visibleCompactMessages.length > 0 && !b.messages.some((m) => m.compact)) {
      b.messages = [...b.messages, ...visibleCompactMessages];
    }
    // 鍘嗗彶鍥炴斁鏉ヨ嚜 DB锛屽熬閮ㄦ棤 streaming 鍒欎笉搴旀畫鐣?stale isBusy
    if (!last(b.messages)?.streaming) {
      b.isBusy = false;
      if (b.sessionStatus === "running") b.sessionStatus = "idle";
    }
    mirror(sessionId);
  },

  prependSessionEvents: (sessionId, earlierEvents, hasMoreHistory) => {
    if (earlierEvents.length === 0) {
      // 娌℃湁鏇存棭鐨勶紝浣嗚鏇存柊 hasMoreHistory 鐘舵€?
      const b = bucket(sessionId);
      b.hasMoreHistory = hasMoreHistory;
      return;
    }
    const b = bucket(sessionId);
    const tail = last(b.messages);
    // 娴佸紡涓烦杩囷紝閬垮厤閲嶆帓鎵撴柇锛堜笌 loadSessionEvents 'refresh' 鍚岃涔夛級
    if (tail?.streaming) return;

    // 鎸?message id 鍘婚噸鍚堝苟锛坋arlier 鍦ㄥ墠锛涙棫 events 鍦ㄥ悗锛?
    const seen = new Set<string>();
    const merged: BusEvent[] = [];
    for (const ev of earlierEvents) {
      const key = eventDedupKey(ev);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(ev);
    }
    for (const ev of b.events) {
      const key = eventDedupKey(ev);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(ev);
    }
    // 鎸?timestamp 鍗囧簭鍏滃簳鎺掑簭锛堜竴鑸?earlier 宸茬粡鍗囧簭銆乵erged 鍚庝粛鍗囧簭锛屼絾淇濋櫓锛?
    merged.sort((a, b2) => (a.ts ?? 0) - (b2.ts ?? 0));

    b.events = merged;
    b.earliestTs = merged[0]?.ts ?? null;
    b.hasMoreHistory = hasMoreHistory;
    b.lastUserInputTs = null;
    b.messages = [];
    b.seenEventIds = new Set<string>();
    for (const ev of merged) applyEvent(b, ev);

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

  getEarliestEventTs: (sessionId) => bucket(sessionId).earliestTs,

  hasMoreHistory: (sessionId) => bucket(sessionId).hasMoreHistory,

  setModel: (model) => set({ model }),
  setProvider: (provider) => set({ provider }),
  setAgentId: (id) => set({ agentId: id }),
  setContextWindow: (n) => set({ contextWindow: n }),
  setPendingWorkspace: (path) => set({ pendingWorkspace: path }),

  initDefaultWorkspace: async () => {
    const { pendingWorkspace } = get();
    if (pendingWorkspace) return;
    try {
      const { fetchAppConfig } = await import("@/services/api");
      const cfg = await fetchAppConfig();
      const def = cfg?.agents?.defaults?.workspace;
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
