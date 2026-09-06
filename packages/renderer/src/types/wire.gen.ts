/**
 * GENERATED FILE —— 禁止手写（PRD-F41 FR9/AC7）。
 * 由 ftre 仓 `scripts/gen_wire_types.py` 从 Pydantic 契约生成：
 *   - packages/ftre-agent/src/ftre_agent/session/events.py   事件表（13 种）
 *   - packages/ftre-agent/src/ftre_agent/message/{_msg,_block}.py  Msg/Block
 *   - src/ftre/services/messaging/wire.py                    帧表（6 种）
 * 重新生成：`py scripts/gen_wire_types.py`；产物 diff 必须为空。
 *
 * 帧信封：{v: 1, session_id, type, payload}，共 6 种帧（F41 §4.4）。
 * 事件信封：{type, seq, time, message_id?, data}，共 13 种事件（F41 §4.2）。
 */


// ─── 帧表（6 种）──────────────────────────────────────────────

export type DownstreamFrameType =
  | "session/event"
  | "session/subscribed"
  | "session/queue"
  | "session/projection"
  | "session/maintenance"
  | "rpc"
;

/** 下行帧公共信封；无帧级 seq（事件帧内 seq 为权威）。 */
export interface WireFrame<TPayload = unknown> {
  v: 1;
  session_id: string;
  type: DownstreamFrameType;
  payload?: TPayload;
}

// ─── 帧载荷 ─────────────────────────────────────────────────────

/** 直播透传：event 是完整事件信封（含 seq），零变换。 */
export interface SessionEventFramePayload {
  event: SessionEvent;
}

/** attach 基线锚点：客户端比对本地 lastSeq 决定是否 tail-page 补拉。 */
export interface SessionSubscribedPayload {
  last_seq: number;
  status: string;
}

/** 派生状态快照（last-wins）：todo/plan/title/token 等。 */
export interface SessionProjectionPayload {
  key: string;
  value?: any;
  seq: number;
}

/** 非日志文本反馈：command_message、compaction start/failed 等瞬态。 */
export interface SessionMaintenancePayload {
  name: string;
  value: Record<string, any>;
}

/** 上行操作结算（prompt/updateQueue → queue 快照或 error；cancel → accepted）。 */
export interface RpcPayload {
  request_id: string;
  ok: boolean;
  value?: any;
  error?: WireRpcError | null;
}

/** rpc 帧错误载荷（统一 error envelope 字段）。 */
export interface WireRpcError {
  code?: string;
  message?: string;
  session_id?: string;
  retryable?: boolean | null;
}

// ─── 事件信封（13 种）─────────────────────────────────────────

export type SessionEventType =
  // 事件全集：表面 5 + 流式 4 + 生命周期 4（分组见 F41 §4.2）
  | "user/message"
  | "assistant/message"
  | "tool/result"
  | "hint/message"
  | "compact/message"
  | "assistant/chunk"
  | "tool/call-start"
  | "tool/result-start"
  | "approval/asked"
  | "turn/start"
  | "turn/retry"
  | "turn/end"
  | "session/status"
;

export interface SessionEvent<TData = any> {
  type: SessionEventType | (string & {});
  /** 会话内从 0 严格连续的事件序号。 */
  seq: number;
  /** epoch 毫秒。 */
  time: number;
  /** 仅表面事件与 chunk 事件携带（chunk 归属目标消息）。 */
  message_id?: string | null;
  data: TData;
}

// ─── 事件 data 载荷 ────────────────────────────────────────────

export interface UserMessageData {
  content: WireUserPart[];
  metadata: Record<string, any>;
  request_id: string;
}

/** whole-value：data.message 是完整 Msg.model_dump(mode="json")。 */
export interface AssistantMessageData {
  message: WireMsg;
}

export interface ToolResultData {
  tool_call_id: string;
  name: string;
  output: any[];
  state: string;
  metadata: Record<string, any>;
}

export interface HintData {
  hint: string | any[];
  source?: string | null;
}

export interface CompactData {
  mode: string;
  summary_text: string;
  through_message_id: string;
  trigger: string;
  tokens_before: number;
  tokens_after: number;
  tool_results: number;
  tool_result_ids?: string[];
}

export interface AssistantChunkData {
  kind: string;
  delta: string;
  block_id?: string | null;
  tool_call_id?: string | null;
}

export interface ToolCallStartData {
  tool_call_id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResultStartData {
  tool_call_id: string;
  name: string;
}

export interface ApprovalAskedData {
  tool_call_id: string;
  name: string;
  arguments: Record<string, any>;
  reason: string;
  rule_id?: string | null;
}

export interface TurnStartData {
  turn_id: string;
  request_id: string;
  trigger: string;
  command_name: string;
  agent_id: string;
  model: string;
}

export interface TurnRetryData {
  turn_id: string;
  code: string;
  message: string;
  attempt: number;
  max_attempts: number;
}

export interface TurnEndData {
  turn_id: string;
  request_id: string;
  outcome: string;
  reason: string;
  error?: Record<string, any> | null;
  usage?: Record<string, any> | null;
  iterations: number;
  metadata?: Record<string, any>;
}

/** 仅 blocked 进入/退出会写入日志（运行态由 turn 事件推导）。 */
export interface SessionStatusData {
  status: string;
  reason: string;
}

// ─── Msg dump（assistant/message 载荷 / HTTP messages 共用形状）──

/** 单次或累计的 token 用量。 */
export interface WireTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** assistant Reply 的 token 用量快照。 */
export interface WireMsgToken {
  usage: WireTokenUsage;
  last_call_usage: WireTokenUsage;
}

/** base64 数据源。 */
export interface WireBase64Source {
  type: "base64";
  data: string;
  media_type: string;
}

/** URL 数据源。 */
export interface WireURLSource {
  type: "url";
  url: string;
  media_type: string;
}

/** 纯文本内容块。 */
export interface WireTextBlock {
  type: "text";
  text: string;
  id?: string;
  created_at?: string;
  finished_at?: string | null;
}

/** 模型推理过程（思维链）内容块。 */
export interface WireThinkingBlock {
  type: "thinking";
  thinking: string;
  id?: string;
  created_at?: string;
  finished_at?: string | null;
}

/** 二进制数据块（图片等），source 为 base64 或 URL。 */
export interface WireDataBlock {
  type: "data";
  source: WireBase64Source | WireURLSource;
  name?: string | null;
  id?: string;
  created_at?: string;
  finished_at?: string | null;
}

/** 提示块（默认隐藏渲染，注入上下文）。 */
export interface WireHintBlock {
  type: "hint";
  hint: string | any[];
  source?: string | null;
  id?: string;
  created_at?: string;
  finished_at?: string | null;
}

/** 工具调用块；arguments 为 whole-value。 */
export interface WireToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  arguments: Record<string, any>;
  state?: string;
  created_at?: string;
  finished_at?: string | null;
}

/** 工具执行结果块。 */
export interface WireToolResultBlock {
  type: "tool_result";
  id: string;
  name: string;
  output: string | any[];
  state?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  finished_at?: string | null;
}

/** assistant/message whole-value 载荷；HTTP /messages 记录共用形状。 */
export interface WireMsg {
  name: string;
  content: Array<WireBlock | WireUserPart>;
  role: "user" | "assistant" | "system";
  id: string;
  metadata: Record<string, any>;
  created_at: string;
  token?: WireMsgToken | null;
  finished_at?: string | null;
  finished_reason?: string | null;
  structured_output?: Record<string, any> | null;
  error?: Record<string, any> | null;
}

/** user/message content 的原始 part（type 判别，其余字段开放）。 */
export interface WireUserPart {
  type: string;
  text?: string | null;
  data?: any;
  path?: string | null;
  mime_type?: string | null;
  [key: string]: unknown;
}

export type WireBlock =
  | WireTextBlock
  | WireThinkingBlock
  | WireDataBlock
  | WireHintBlock
  | WireToolCallBlock
  | WireToolResultBlock;

// ─── 事件判别联合（fold 引擎 switch 使用）─────────────────────

export type UserMessageEvent = SessionEvent<UserMessageData>;
export type AssistantMessageEvent = SessionEvent<AssistantMessageData>;
export type ToolResultEvent = SessionEvent<ToolResultData>;
export type HintMessageEvent = SessionEvent<HintData>;
export type CompactMessageEvent = SessionEvent<CompactData>;
export type AssistantChunkEvent = SessionEvent<AssistantChunkData>;
export type ToolCallStartEvent = SessionEvent<ToolCallStartData>;
export type ToolResultStartEvent = SessionEvent<ToolResultStartData>;
export type ApprovalAskedEvent = SessionEvent<ApprovalAskedData>;
export type TurnStartEvent = SessionEvent<TurnStartData>;
export type TurnRetryEvent = SessionEvent<TurnRetryData>;
export type TurnEndEvent = SessionEvent<TurnEndData>;
export type SessionStatusEvent = SessionEvent<SessionStatusData>;
