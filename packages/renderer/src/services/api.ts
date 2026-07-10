/**
 * API service — all communication goes through WebSocket.
 * This file provides a simple interface for components.
 * Functions that previously called HTTP endpoints are stubbed as no-ops or return defaults.
 */

import { wsClient } from "./websocket-client";
import { useChat } from "@/stores/chat";

/** 后端 API 基地址，可通过 VITE_API_BASE 环境变量覆盖 */
export const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:48650";

// ─── Connection ─────────────────────────────────────────────────────

export function initConnection(): void {
  wsClient.connect();
}

export function isConnected(): boolean {
  return wsClient.connected;
}

export function getActiveChatId(): string | null {
  return useChat.getState().sessionId;
}

// ─── Chat Actions ───────────────────────────────────────────────────

export function sendMessage(content: string): void {
  useChat.getState().sendMessage(content);
}

export function newChat(): void {
  useChat.getState().newChat();
}

export function switchChat(_chatId: string): void {
  // Single session per WS connection — just clear
  useChat.getState().newChat();
}

export function cancelStream(): void {
  console.warn("[api] cancelStream not implemented yet");
}

export function retryLastMessage(): void {
  console.warn("[api] retryLastMessage not implemented yet");
}

// ─── Sessions ───────────────────────────────────────────────────────

/** Known session channel types (backend channel_id 取值)。
 *  ws = WebSocket（聊天）；cron = 定时任务；其它由插件/扩展 channel 决定。 */
const SESSION_CHANNELS = ["ws", "cron", "dmwork", "cli", "telegram"] as const;
type KnownChannel = (typeof SESSION_CHANNELS)[number];
export type SessionChannel = KnownChannel | "unknown";

export interface SessionSummary {
  session_id: string;
  /** Original key from backend (e.g., "ws::sess_xxx") */
  key?: string;
  workspace?: string;
  agent_id?: string;
  title?: string;
  created_at?: number;
  updated_at?: number;
  meta?: Record<string, any>;
  source?: string;
  /** 后端 channel_id 原值。空串 / 未知 → "unknown" */
  channel: SessionChannel;
  /** 后端返回该 session 是否正在执行（AgentLoop 持有活跃 agent） */
  running?: boolean;
}

/**
 * Cache mapping session_id -> original key for API calls.
 * Populated by fetchSessions(), used by encodeSessionKey().
 * Limited to 500 entries to prevent unbounded growth.
 */
const sessionKeyCache = new Map<string, string>();
const SESSION_KEY_CACHE_MAX_SIZE = 500;

/**
 * Register a session key mapping for API calls.
 */
function registerSessionKey(sessionId: string, key: string): void {
  // Evict oldest entries if cache is full (FIFO)
  if (sessionKeyCache.size >= SESSION_KEY_CACHE_MAX_SIZE) {
    const firstKey = sessionKeyCache.keys().next().value;
    if (firstKey) sessionKeyCache.delete(firstKey);
  }
  sessionKeyCache.set(sessionId, key);
}

export interface SessionPage {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

/** 工作区摘要（侧边栏按工作区分组用） */
export interface WorkspaceSummary {
  workspace: string;
  session_count: number;
  latest_at: number;
}

/**
 * 枚举所有工作区（默认只看 ws channel），按各自最新活跃时间倒序。
 * 用于侧边栏先拿到完整的工作区清单，再各自分页拉 session，
 * 避免全局分页漏掉很久没活跃的工作区。
 */
export async function fetchWorkspaces(
  channelId: string | null = "ws",
): Promise<WorkspaceSummary[]> {
  const params = new URLSearchParams();
  if (channelId != null) params.set("channel_id", channelId);
  const qs = params.toString();
  try {
    const res = await fetch(
      `${API_BASE}/api/workspaces${qs ? `?${qs}` : ""}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.workspaces || []).map((w: any) => ({
      workspace: typeof w.workspace === "string" ? w.workspace : "",
      session_count: typeof w.session_count === "number" ? w.session_count : 0,
      latest_at: typeof w.latest_at === "number" ? w.latest_at : 0,
    }));
  } catch {
    return [];
  }
}

function mapSessionRow(s: any): SessionSummary {
  const sessionId = s.id || s.key || s.session_id;
  if (s.key) registerSessionKey(sessionId, s.key);
  const rawChannel: string =
    (typeof s.channel_id === "string" && s.channel_id) ||
    (typeof s.channel === "string" && s.channel) ||
    "";
  const channel: SessionChannel = (
    SESSION_CHANNELS as readonly string[]
  ).includes(rawChannel)
    ? (rawChannel as SessionChannel)
    : rawChannel
      ? (rawChannel as SessionChannel)
      : "unknown";
  return {
    session_id: sessionId,
    key: s.key,
    workspace: s.workspace,
    agent_id: s.agent_id,
    title: s.title,
    created_at: s.created_at,
    updated_at: s.updated_at,
    meta: s.meta,
    source: s.source,
    channel,
    running: s.running,
  };
}

/**
 * 取一页会话。后端按 updated_at 倒序、支持 limit/offset。
 * 失败时返回空 page（避免 UI 崩）。
 */
export async function fetchSessionPage(
  opts: {
    limit?: number;
    offset?: number;
    channelId?: string | null;
    workspace?: string | null;
  } = {},
): Promise<SessionPage> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  if (opts.channelId) params.set("channel_id", opts.channelId);
  // workspace 传 null/undefined → 不过滤；传 "" → 过滤"未设置工作区"
  if (opts.workspace != null) params.set("workspace", opts.workspace);
  const qs = params.toString();
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions${qs ? `?${qs}` : ""}`,
    );
    if (!res.ok) return { sessions: [], total: 0, limit: opts.limit ?? 50, offset: opts.offset ?? 0 };
    const data = await res.json();
    return {
      sessions: (data.sessions || []).map(mapSessionRow),
      total: typeof data.total === "number" ? data.total : (data.sessions || []).length,
      limit: typeof data.limit === "number" ? data.limit : (opts.limit ?? 50),
      offset: typeof data.offset === "number" ? data.offset : (opts.offset ?? 0),
    };
  } catch {
    return { sessions: [], total: 0, limit: opts.limit ?? 50, offset: opts.offset ?? 0 };
  }
}

export async function createSessionRemote(
  opts: { channelId?: string; workspace?: string | null } = {},
): Promise<{ session_id: string } | null> {
  const params = new URLSearchParams();
  params.set("channel_id", opts.channelId || "ws");
  if (opts.workspace) params.set("workspace", opts.workspace);
  try {
    const res = await fetch(`${API_BASE}/api/sessions?${params.toString()}`, {
      method: "POST",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.session_id === "string" ? { session_id: data.session_id } : null;
  } catch (e) {
    console.error("[api] createSessionRemote error:", e);
    return null;
  }
}

/**
 * @deprecated 用 fetchSessionPage。保留兼容旧调用：返回首页（最多 200 条）的 sessions 数组。
 */
export async function fetchSessions(
  _workspace?: string | null,
): Promise<SessionSummary[]> {
  const page = await fetchSessionPage({ limit: 200 });
  return page.sessions;
}

/**
 * Check if a string looks like a full session key with channel prefix.
 * e.g., "websocket:uuid" or "dmwork:xxx"
 */
function hasChannelPrefix(str: string): boolean {
  const colonIndex = str.indexOf(":");
  if (colonIndex === -1) return false;
  const prefix = str.substring(0, colonIndex);
  return (SESSION_CHANNELS as readonly string[]).includes(prefix);
}

/**
 * Encode a session key for use in REST API URLs.
 * First checks the cache for the original key, then falls back to
 * assuming websocket channel prefix for unknown sessions.
 */
function encodeSessionKey(sessionIdOrKey: string): string {
  // Check cache first - sessionIdOrKey might be a session_id with cached key
  const cachedKey = sessionKeyCache.get(sessionIdOrKey);
  if (cachedKey) {
    return encodeURIComponent(cachedKey);
  }
  // If it has a known channel prefix, use it directly
  // Otherwise, assume websocket channel for backward compatibility
  const key = hasChannelPrefix(sessionIdOrKey)
    ? sessionIdOrKey
    : `websocket:${sessionIdOrKey}`;
  // URL encode the key to handle special characters like ':'
  return encodeURIComponent(key);
}

/**
 * 后端事件消息格式（新）。
 * 每条消息: {id, session_id, type, data, timestamp}
 */
export interface SessionMessage {
  id: string;
  session_id: string;
  type: string;  // user_message / assistant_message_complete / tool_result / step / external_message / context_compact
  data: Record<string, any>;
  timestamp: number;
  turn_id: string;
}

/**
 * Fetch messages for a session from REST API.
 * 新后端返回格式: { messages: [{id, session_id, type, data, timestamp}], has_more, total }
 *
 * 不传 opts → 一次性拿全（向后兼容；用于历史回放等需要全量上下文的场景）。
 */
export async function fetchSessionMessages(
  sessionId: string,
): Promise<SessionMessage[]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    const messages = data.messages || [];
    console.log("[API] fetchSessionMessages response:", {
      sessionId,
      messageCount: messages.length,
      sampleMessage: messages[0],
    });
    return messages;
  } catch (e) {
    console.error("[API] fetchSessionMessages error:", e);
    return [];
  }
}

/** 分页拉消息的响应 */
export interface SessionMessagesPage {
  messages: SessionMessage[];
  /** 本页起点之前是否还有更早的消息 */
  hasMore: boolean;
  /** session 当前消息总数（不分页时给的全量） */
  total: number;
  status: "idle" | "running" | "compacting";
}

/**
 * 分页拉 session messages。
 *
 * 典型用法：
 *   - 首屏：fetchSessionMessagesPage(sid, { limitTurns: 5 }) → 最近 5 轮对话
 *   - 加载更早：fetchSessionMessagesPage(sid, { limitTurns: 5, beforeTs: earliest })
 */
export async function fetchSessionMessagesPage(
  sessionId: string,
  opts: {
    limitTurns?: number;
    beforeTs?: number;
  } = {},
): Promise<SessionMessagesPage> {
  const params = new URLSearchParams();
  if (opts.limitTurns !== undefined) params.set("limit_turns", String(opts.limitTurns));
  if (opts.beforeTs !== undefined) params.set("before_ts", String(opts.beforeTs));
  const qs = params.toString();
  const url =
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages` +
    (qs ? `?${qs}` : "");
  try {
    const res = await fetch(url);
    if (!res.ok) return { messages: [], hasMore: false, total: 0, status: "idle" };
    const data = await res.json();
    return {
      messages: data.messages || [],
      hasMore: !!data.has_more,
      total: typeof data.total === "number" ? data.total : 0,
      status: data.status === "running" || data.status === "compacting" ? data.status : "idle",
    };
  } catch (e) {
    console.error("[API] fetchSessionMessagesPage error:", e);
    return { messages: [], hasMore: false, total: 0, status: "idle" };
  }
}

/** 后端 token_usage 响应（与 ftre/api/routes.py 对应） */
export interface TokenUsage {
  /** 最近一次 LLM 实算的 usage；从未跑过则为 null */
  anchor:
  | {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** 锚点事件 timestamp（epoch 秒） */
    at: number;
    source: "assistant_message_complete";
  }
  | null;
  /** 锚点之后会进下次 prompt 但尚未实算的事件估算 */
  pending_estimated: number;
  /** anchor.total_tokens + pending_estimated；无锚点时退化为全量估算 */
  total: number;
}

/** 拉取该 session 的 token 用量。失败抛出，由调用方决定是否保留上一次值。 */
export async function fetchTokenUsage(sessionId: string): Promise<TokenUsage> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/token_usage`,
  );
  if (!res.ok) {
    throw new Error(`token_usage HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    anchor: data?.anchor ?? null,
    pending_estimated: Number(data?.pending_estimated) || 0,
    total: Number(data?.total) || 0,
  };
}

/**
 * @deprecated 历史接口；保留只是为了兼容旧调用，实际等价于 fetchTokenUsage().total。
 */
export async function fetchUsage(sessionId: string): Promise<number> {
  if (!sessionId) return 0;
  try {
    const usage = await fetchTokenUsage(sessionId);
    return usage.total;
  } catch {
    return 0;
  }
}

// ─── 模型 / 供应商类型（前端共用） ─────────────────────────────────

/**
 * 单条模型定义。与 config.json 里 providers[name].models[*] 字段对齐。
 * ModelSelector / ModelSettings / TokenRing 三处共用。
 */
export interface ModelItem {
  /** 显示名 */
  name: string;
  /** 模型 ID（API 调用时使用） */
  id: string;
  /** 上下文窗口大小（token 数） */
  context_window?: number | null;
  /** 最大输出 token 数 */
  max_output?: number | null;
  /** 是否支持视觉输入（图片） */
  vision?: boolean;
}

export async function updateSession(
  sessionId: string,
  data: { title?: string; workspace?: string },
): Promise<{ status: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      console.error("[api] updateSession failed:", await res.text());
      return null;
    }
    return res.json();
  } catch (e) {
    console.error("[api] updateSession error:", e);
    return null;
  }
}

export async function deleteSessionRemote(
  sessionId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (e) {
    console.error("[api] deleteSessionRemote error:", e);
    return false;
  }
}

export async function triggerCompaction(
  sessionId: string,
): Promise<{ status: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/compact`, {
      method: "POST",
    });
    if (!res.ok) {
      console.error("[api] triggerCompaction failed:", await res.text());
      return null;
    }
    return res.json();
  } catch (e) {
    console.error("[api] triggerCompaction error:", e);
    return null;
  }
}

// ─── App Config (~/.ftre/config.json via backend) ─────────────────
//
// 之前是前端通过 Electron IPC 直接读写 config.json；现在统一走后端 HTTP API，
// 这样浏览器场景也能用，并且后端能在写入时做校验/格式化。

const CONFIG_API = `${API_BASE}/api/config`;

/** 读取应用配置（providers / agents 等）。失败返回空对象。 */
export async function fetchAppConfig(): Promise<Record<string, any>> {
  try {
    const res = await fetch(CONFIG_API);
    if (!res.ok) return {};
    const data = await res.json();
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    console.error("[api] fetchAppConfig failed:", e);
    return {};
  }
}

/** 全量覆盖写应用配置。返回是否成功。 */
export async function saveAppConfig(config: Record<string, any>): Promise<boolean> {
  try {
    const res = await fetch(CONFIG_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return res.ok;
  } catch (e) {
    console.error("[api] saveAppConfig failed:", e);
    return false;
  }
}

// ─── Cron Jobs (~/.ftre/cron/<job_id>.json via backend) ───────────

const CRON_API = `${API_BASE}/api/cron`;

/** 后端 cron job 数据结构（与 ftre/tools/cron.py 一致）*/
export interface CronJob {
  id: string;
  cron: string;
  title: string;
  prompt: string;
  /** 禁用后调度器跳过该任务，但任务定义和历史保留 */
  disabled?: boolean;
  created_at: number;
  run_history: number[];
}

/** 创建 / 更新时的可编辑字段 */
export interface CronJobInput {
  cron: string;
  title: string;
  prompt: string;
  disabled?: boolean;
}

async function _readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    return `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function fetchCronJobs(): Promise<CronJob[]> {
  try {
    const res = await fetch(CRON_API);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.jobs) ? data.jobs : [];
  } catch (e) {
    console.error("[api] fetchCronJobs failed:", e);
    return [];
  }
}

export async function createCronJob(
  input: CronJobInput,
): Promise<{ job: CronJob } | { error: string }> {
  try {
    const res = await fetch(CRON_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { error: await _readError(res) };
    return { job: (await res.json()) as CronJob };
  } catch (e) {
    return { error: (e as Error).message || "网络错误" };
  }
}

export async function updateCronJob(
  jobId: string,
  patch: Partial<CronJobInput>,
): Promise<{ job: CronJob } | { error: string }> {
  try {
    const res = await fetch(`${CRON_API}/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return { error: await _readError(res) };
    return { job: (await res.json()) as CronJob };
  } catch (e) {
    return { error: (e as Error).message || "网络错误" };
  }
}

export async function deleteCronJob(jobId: string): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await fetch(`${CRON_API}/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 204) return { error: await _readError(res) };
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message || "网络错误" };
  }
}

// ─── Models ─────────────────────────────────────────────────────────

export async function fetchModels(): Promise<string[]> {
  return ["default"];
}

export interface LLMProvider {
  id: string;
  name: string;
  api_key?: string;
  base_url?: string;
  models?: string[] | Record<string, string>;
  vendor?: string;
  api_type?: string;
}

const AI_BASE_CONFIG_PATH = "~/.ai-base/config.json";

async function readAiBaseConfig(): Promise<Record<string, any>> {
  // Backed by HTTP API now; AI_BASE_CONFIG_PATH kept as an unused legacy path constant
  // to ease future migration (will be removed when Electron bundle no longer references it).
  void AI_BASE_CONFIG_PATH;
  return fetchAppConfig();
}

/**
 * Reads providers from ~/.ai-base/config.json and returns them
 * in the LLMProvider format expected by ModelSelector.
 */
export async function fetchLLMProviders(): Promise<LLMProvider[]> {
  const config = await readAiBaseConfig();
  const providers = config.providers || {};
  const currentModel = config.agents?.defaults?.model || "";
  const currentProviderName = config.agents?.defaults?.provider || "auto";

  return Object.entries(providers).map(([name, p]: [string, any]) => ({
    id: name,
    name,
    vendor: name,
    api_key: p.api_key || "",
    base_url: p.api_base || "",
    api_type: "completions",
    // Expose the current model under this provider if it's the active one
    models:
      name === currentProviderName ? { [currentModel]: currentModel } : {},
  }));
}

export async function createLLMProvider(
  _vendorOrData: string | (Partial<LLMProvider> & Record<string, any>),
  _payload?: any,
): Promise<LLMProvider | { error?: string } | null> {
  // Provider creation is now handled by ModelSettings writing config.json directly
  return { error: "Use ModelSettings to manage providers" };
}

export async function updateLLMProvider(
  _id: string,
  _data: Partial<LLMProvider> & Record<string, any>,
): Promise<{ status: string } | null> {
  return { status: "ok" };
}

export async function deleteLLMProvider(_id: string): Promise<boolean> {
  return true;
}

// ─── Skills (~/.ftre/skills/<name>.md 或 <name>/SKILL.md via backend) ──
//
// Skill 是存放在 ~/.ftre/skills 下的可复用能力说明。后端（ftre/api/routes.py）
// 提供 CRUD；底层 IO 见 ftre/skill.py，加载约定见 ~/.ftre/plugins/skill_plugin.py。

const SKILLS_API = `${API_BASE}/api/skills`;

/** Skill 存储形态：单文件 <name>.md（file）或目录 <name>/SKILL.md（dir）。*/
export type SkillKind = "file" | "dir";

/** 列表项：不含正文，仅元信息 */
export interface SkillSummary {
  /** Skill 唯一标识。Skill 以名称为主键，这里 id === name（兼容 @ 提及/chip）。 */
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  /** 内容文件最近修改时间（epoch 秒） */
  updated_at: number;
  /** 是否被禁用（config.json 的 disabled_skills 数组） */
  disabled?: boolean;
  /** 来源范围：global（~/.ftre/skills）或 private（~/.ftre/agents/<id>/skills） */
  scope?: "global" | "private";
}

/**
 * @deprecated 用 SkillSummary。保留别名兼容 ChatInput 的 @ 技能提及。
 * 字段是 SkillSummary 的子集（id / name / description）。
 */
export interface SkillDef {
  id: string;
  name: string;
  description: string;
}

/** 详情：含完整正文 */
export interface SkillDetail extends SkillSummary {
  content: string;
}

/** 创建 Skill 的输入 */
export interface SkillCreateInput {
  name: string;
  /** 正文；缺省时后端用模板（含 frontmatter）预填 */
  content?: string;
  /** 缺省时后端用作模板 description */
  description?: string;
  /** 存储形态，默认 "dir" */
  kind?: SkillKind;
}

/** 把后端返回的 skill 行补上 id（= name），便于前端按主键引用。 */
function mapSkillRow(s: any): SkillSummary {
  const name = typeof s?.name === "string" ? s.name : "";
  return {
    id: name,
    name,
    description: typeof s?.description === "string" ? s.description : "",
    kind: s?.kind === "file" ? "file" : "dir",
    updated_at: typeof s?.updated_at === "number" ? s.updated_at : 0,
    disabled: s?.disabled === true,
    scope: s?.scope === "private" ? "private" : "global",
  };
}

/** 获取 Skill 列表。传 agentId 时返回全局 + 该 agent 私有 skill（私有覆盖同名全局）。 */
export async function fetchSkills(
  agentId?: string | null,
): Promise<SkillSummary[]> {
  try {
    const url = agentId
      ? `${SKILLS_API}?agent_id=${encodeURIComponent(agentId)}`
      : SKILLS_API;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.skills) ? data.skills.map(mapSkillRow) : [];
  } catch (e) {
    console.error("[api] fetchSkills failed:", e);
    return [];
  }
}

// ─── Commands（斜杠指令）────────────────────────────────────────────

const COMMANDS_API = `${API_BASE}/api/commands`;

export interface CommandDef {
  command: string;        // "/cancel"
  description: string;    // "取消当前会话执行"
  args_hint: string;      // "[preset]" 或 ""
  system: boolean;        // 系统级指令（锁外执行，ephemeral，不持久化）
}

/** 获取后端注册的斜杠指令列表，供输入框 / 面板渲染。 */
export async function fetchCommands(): Promise<CommandDef[]> {
  try {
    const res = await fetch(COMMANDS_API);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.commands) ? data.commands : [];
  } catch (e) {
    console.error("[api] fetchCommands failed:", e);
    return [];
  }
}

export async function fetchSkill(
  name: string,
): Promise<{ skill: SkillDetail } | { error: string }> {
  try {
    const res = await fetch(`${SKILLS_API}/${encodeURIComponent(name)}`);
    if (!res.ok) return { error: await _readError(res) };
    const raw = await res.json();
    return { skill: { ...mapSkillRow(raw), content: raw?.content ?? "" } };
  } catch (e) {
    return { error: (e as Error).message || "网络错误" };
  }
}

export async function createSkill(
  input: SkillCreateInput,
): Promise<{ skill: SkillDetail } | { error: string }> {
  try {
    const res = await fetch(SKILLS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { error: await _readError(res) };
    const raw = await res.json();
    return { skill: { ...mapSkillRow(raw), content: raw?.content ?? "" } };
  } catch (e) {
    return { error: (e as Error).message || "网络错误" };
  }
}

export async function updateSkill(
  name: string,
  content: string,
): Promise<{ skill: SkillDetail } | { error: string }> {
  try {
    const res = await fetch(`${SKILLS_API}/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) return { error: await _readError(res) };
    const raw = await res.json();
    return { skill: { ...mapSkillRow(raw), content: raw?.content ?? "" } };
  } catch (e) {
    return { error: (e as Error).message || "网络错误" };
  }
}

export async function deleteSkill(
  name: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await fetch(`${SKILLS_API}/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 204) return { error: await _readError(res) };
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message || "网络错误" };
  }
}

export async function toggleSkillDisabled(
  name: string,
): Promise<{ name: string; disabled: boolean } | { error: string }> {
  try {
    const res = await fetch(`${SKILLS_API}/${encodeURIComponent(name)}/toggle`, {
      method: "PATCH",
    });
    if (!res.ok) return { error: await _readError(res) };
    return await res.json();
  } catch (e) {
    return { error: (e as Error).message || "网络错误" };
  }
}

// ─── Agents ─────────────────────────────────────────────────────────

export interface ChatAgent {
  id: string;
  name: string;
  model?: string;
  provider?: string;
  workspace?: string;
  tools_allow?: string[] | null;
  tools_deny?: string[] | null;
  mcp_servers?: string[];
  has_soul?: boolean;
  has_agents_md?: boolean;
  has_user_md?: boolean;
  is_builtin?: boolean;
  tools?: string[];
}

export async function fetchChatAgents(
  _workspace?: string | null,
): Promise<ChatAgent[]> {
  try {
    const res = await fetch(`${API_BASE}/api/agents`);
    if (!res.ok) return [{ id: "default", name: "Default", is_builtin: true }];
    const data = await res.json();
    const agents: ChatAgent[] = (data.agents || []).map((a: any) => ({
      id: a.id,
      name: a.name || a.id,
      model: a.model,
      provider: a.provider,
      workspace: a.workspace,
      tools_allow: a.tools_allow,
      tools_deny: a.tools_deny,
      mcp_servers: a.mcp_servers || [],
      has_soul: a.has_soul,
      has_agents_md: a.has_agents_md,
      has_user_md: a.has_user_md,
      is_builtin: a.id === "default",
    }));
    return agents.length > 0 ? agents : [{ id: "default", name: "Default", is_builtin: true }];
  } catch {
    return [{ id: "default", name: "Default", is_builtin: true }];
  }
}

export async function updateAgent(
  agentId: string,
  patch: { llm?: { provider: string; model: string }; name?: string; workspace?: string },
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch (e) {
    console.error("[api] updateAgent failed:", e);
    return false;
  }
}

export async function createAgent(body: {
  id: string;
  name?: string;
  provider?: string;
  model?: string;
  workspace?: string;
}): Promise<{ ok: boolean; config?: Record<string, any> }> {
  try {
    const res = await fetch(`${API_BASE}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { ok: res.ok, config: data.config };
  } catch {
    return { ok: false };
  }
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchAgentPrompts(
  agentId: string,
): Promise<Record<string, string>> {
  try {
    const res = await fetch(
      `${API_BASE}/api/agents/${encodeURIComponent(agentId)}/prompts`,
    );
    if (!res.ok) return {};
    const data = await res.json();
    return data.prompts || {};
  } catch {
    return {};
  }
}

export async function updateAgentPrompt(
  agentId: string,
  filename: string,
  content: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${API_BASE}/api/agents/${encodeURIComponent(agentId)}/prompts/${encodeURIComponent(filename)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Diff / Rollback ────────────────────────────────────────────────

export async function fetchDiff(_toolId: string): Promise<{
  files: Array<{
    file: string;
    before_content: string;
    after_content: string;
    additions?: number;
    deletions?: number;
  }>;
  tool_name: string;
} | null> {
  return null;
}

export async function fetchDiffStat(
  _baseHashOrMessageId: string,
  _finalHash?: string,
  _workspace?: string,
): Promise<{
  files: any[];
  total_additions: number;
  total_deletions: number;
  total_files: number;
} | null> {
  return null;
}

export async function fetchSnapshotFileDiff(
  _workspace: string,
  _baseHash: string,
  _finalHash: string,
  _filePath: string,
): Promise<{
  diff: string;
  before_content: string;
  after_content: string;
} | null> {
  return null;
}

export async function fetchSnapshotFileContent(
  _workspace: string,
  _baseHash: string,
  _finalHash: string,
  _filePath: string,
): Promise<{ before_content: string; after_content: string } | null> {
  return null;
}

export async function revertDiff(
  _toolId: string,
): Promise<{ status: string } | null> {
  console.warn("[api] revertDiff not implemented");
  return null;
}

export async function previewRollback(
  _sessionId: string,
  _messageId: string,
): Promise<any> {
  return { error: "not_available", message: "回滚功能需要连接 AI 后端" };
}

export async function executeRollback(
  _sessionId: string,
  _messageId: string,
  _skipCodeRestore?: boolean,
): Promise<any> {
  return { error: "not_available", message: "回滚功能需要连接 AI 后端" };
}

// ─── Archives ───────────────────────────────────────────────────────

export interface ArchiveEntry {
  id: string;
  title?: string;
  summary?: string;
  content?: string;
  created_at?: number;
  workspace?: string;
  folder_id?: string;
  folder_ids?: string[];
  meta?: Record<string, any>;
}

export interface ArchiveFolder {
  id: string;
  name: string;
  workspace?: string;
  description?: string;
  sort_order?: number;
}

export async function fetchWorkspaceArchives(
  _workspace: string,
): Promise<{ archives: ArchiveEntry[] }> {
  return { archives: [] };
}

export async function fetchArchiveDetail(
  _archiveId: string,
): Promise<ArchiveEntry | null> {
  return null;
}

export async function fetchArchiveFolders(
  _workspace: string,
): Promise<{ folders: ArchiveFolder[] }> {
  return { folders: [] };
}

export async function createArchiveFolder(_data: {
  workspace: string;
  name: string;
  description?: string;
}): Promise<ArchiveFolder | { error: string }> {
  return { error: "not_implemented" };
}

export async function updateArchiveFolder(
  _folderId: string,
  _data: Partial<ArchiveFolder> & { description?: string },
): Promise<ArchiveFolder | { error: string }> {
  return { error: "not_implemented" };
}

export async function deleteArchiveFolder(
  _folderId: string,
): Promise<{ status: string } | null> {
  return null;
}

export async function linkArchiveToFolder(
  _archiveId: string,
  _folderId: string,
): Promise<{ status: string } | null> {
  return null;
}

export async function unlinkArchiveFromFolder(
  _archiveId: string,
  _folderId: string,
): Promise<{ status: string } | null> {
  return null;
}

export async function updateArchive(
  _archiveId: string,
  _data: Partial<ArchiveEntry>,
): Promise<{ status: string } | null> {
  return null;
}

export async function deleteArchive(
  _archiveId: string,
): Promise<{ status: string } | null> {
  return null;
}

// ─── Tasks ──────────────────────────────────────────────────────────

export interface TaskItem {
  id: string;
  type: string;
  status: string;
  created_at?: number;
  started_at?: number;
  completed_at?: number;
  result?: any;
  meta?: Record<string, any>;
  session_id?: string;
  name?: string;
  schedule?: string;
  agent_id?: string;
  data?: Record<string, any>;
  error?: string;
  detail?: string;
}

export async function fetchTasks(
  _filters?: any,
): Promise<{ tasks: TaskItem[]; total: number }> {
  return { tasks: [], total: 0 };
}

export async function fetchScheduledTasks(
  _params?: any,
): Promise<{ tasks: TaskItem[]; total: number }> {
  return { tasks: [], total: 0 };
}

export async function createScheduledTask(
  _data: any,
): Promise<TaskItem & { error?: string; detail?: string }> {
  return { id: "", type: "scheduled", status: "pending" };
}

export async function deleteScheduledTask(_taskId: string): Promise<void> { }

export async function triggerScheduledTask(_taskId: string): Promise<void> { }

export async function cancelScheduledTask(_taskId: string): Promise<void> { }

export async function fetchScheduledTaskRuns(
  _taskId: string,
  _params?: any,
): Promise<{ runs: any[]; total: number }> {
  return { runs: [], total: 0 };
}

export async function updateScheduledTask(
  _taskId: string,
  _data: any,
): Promise<{ error?: string; detail?: string }> {
  return { error: "功能暂不可用", detail: "需要连接 AI 后端" };
}

// ─── Rooms (Agent multi-chat) ───────────────────────────────────────

export interface RoomInfo {
  id: string;
  room_id?: string;
  name?: string;
  members?: RoomMember[];
  updated_at?: number;
}

export interface RoomMember {
  agent_id: string;
  agent_name?: string;
  name?: string;
  role?: string;
  color?: string;
  description?: string;
  workspace?: string;
}

export interface RoomMessage {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name?: string;
  content: string;
  timestamp?: number;
  type?: string;
  color?: string;
}

export async function fetchRooms(_workspace?: string): Promise<RoomInfo[]> {
  return [];
}

export async function fetchRoomMessages(
  _roomId: string,
  _sinceTs?: number,
): Promise<RoomMessage[]> {
  return [];
}

export async function sendRoomMessage(
  _roomId: string,
  _content: string,
  _senderId?: string,
  _targetAgentIds?: string[],
): Promise<void> { }

// ─── MCP 服务器管理 ───────────────────────────────────────────────

const MCP_API = `${API_BASE}/api/mcp`;

export type McpScope = "global" | "private";

export interface McpServerConfig {
  name: string;
  type: "local" | "remote";
  /** local 专用 */
  command?: string[];
  environment?: Record<string, string>;
  /** remote 专用 */
  url?: string;
  headers?: Record<string, string>;
  /** 通用 */
  disabled?: boolean;
  timeout?: number;
  /** 运行时状态（仅 GET 返回） */
  status?: "connected" | "disconnected";
  /** 作用域（GET 返回） */
  scope?: McpScope;
}

export async function fetchMcpServers(
  scope: "all" | McpScope = "all",
  agentId: string = "default",
): Promise<McpServerConfig[]> {
  const params = new URLSearchParams();
  if (scope !== "all") params.set("scope", scope);
  if (scope === "private") params.set("agent_id", agentId);
  const qs = params.toString();
  const res = await fetch(qs ? `${MCP_API}?${qs}` : MCP_API);
  const data = await res.json();
  return data.servers || [];
}

export async function createMcpServer(
  config: Omit<McpServerConfig, "status" | "scope">,
  scope: McpScope = "global",
  agentId: string = "default",
): Promise<McpServerConfig> {
  const params = new URLSearchParams({ scope });
  if (scope === "private") params.set("agent_id", agentId);
  const res = await fetch(`${MCP_API}?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `创建失败 (${res.status})`);
  }
  return res.json();
}

export async function updateMcpServer(
  name: string,
  patch: Partial<McpServerConfig>,
  scope: McpScope = "global",
  agentId: string = "default",
): Promise<McpServerConfig> {
  const params = new URLSearchParams({ scope });
  if (scope === "private") params.set("agent_id", agentId);
  const res = await fetch(`${MCP_API}/${encodeURIComponent(name)}?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `更新失败 (${res.status})`);
  }
  return res.json();
}

export async function deleteMcpServer(
  name: string,
  scope: McpScope = "global",
  agentId: string = "default",
): Promise<{ ok: true } | { error: string }> {
  const params = new URLSearchParams({ scope });
  if (scope === "private") params.set("agent_id", agentId);
  const res = await fetch(`${MCP_API}/${encodeURIComponent(name)}?${params}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    return { error: data.detail || `删除失败 (${res.status})` };
  }
  return { ok: true };
}

// ─── Agent Traces ──────────────────────────────────────────────────

export type TraceRunType = "agent" | "llm" | "tool";
export type TraceRunStatus = "running" | "completed" | "error" | "cancelled";

export interface TraceEvent {
  name: string;
  time: string;
  data: Record<string, unknown>;
}

export interface TraceRun {
  id: string;
  trace_id: string;
  parent_run_id: string | null;
  name: string;
  run_type: TraceRunType;
  status: TraceRunStatus;
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  events: TraceEvent[];
  payload_loaded?: boolean;
}

export interface TraceSummary {
  trace_id: string;
  name: string;
  status: TraceRunStatus | "unknown";
  start_time: string;
  end_time: string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  tags: string[];
  outputs: Record<string, unknown>;
  run_count: number;
  llm_run_count: number;
  tool_run_count: number;
  stop_without_tools: number;
  response_models: string[];
  error_count: number;
}

export interface TracePage {
  traces: TraceSummary[];
  path: string;
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  has_more: boolean;
}

export async function fetchTraces(limit = 100, offset = 0): Promise<TracePage> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetch(`${API_BASE}/api/traces?${params.toString()}`);
  if (!response.ok) throw new Error(`加载 Trace 失败 (${response.status})`);
  return response.json();
}

export async function fetchTrace(traceId: string): Promise<{ trace_id: string; runs: TraceRun[] }> {
  const response = await fetch(`${API_BASE}/api/traces/${encodeURIComponent(traceId)}`);
  if (!response.ok) throw new Error(`加载 Trace 详情失败 (${response.status})`);
  return response.json();
}

export async function fetchTraceRun(traceId: string, runId: string): Promise<TraceRun> {
  const response = await fetch(
    `${API_BASE}/api/traces/${encodeURIComponent(traceId)}/runs/${encodeURIComponent(runId)}`,
  );
  if (!response.ok) throw new Error(`加载 Run Payload 失败 (${response.status})`);
  const data = await response.json();
  return data.run;
}
