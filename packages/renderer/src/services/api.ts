/**
 * API service — all communication goes through WebSocket.
 * This file provides a simple interface for components.
 * Functions that previously called HTTP endpoints are stubbed as no-ops or return defaults.
 */

import { wsClient } from "./websocket-client";
import { streamManager } from "./ws-stream-manager";
import type { MediaItem } from "./ws-protocol";

export type { MediaItem };

// ─── Connection ─────────────────────────────────────────────────────

export function initConnection(): void {
  wsClient.connect();
}

export function isConnected(): boolean {
  return wsClient.connected;
}

export function getActiveChatId(): string | null {
  return wsClient.chatId;
}

// ─── Chat Actions ───────────────────────────────────────────────────

export function sendMessage(content: string, media?: MediaItem[]): void {
  streamManager.sendMessage(content, media);
}

export function newChat(): void {
  streamManager.newChat();
}

export function switchChat(chatId: string): void {
  streamManager.switchChat(chatId);
}

export function cancelStream(): void {
  console.warn("[api] cancelStream not implemented yet");
}

export function retryLastMessage(): void {
  console.warn("[api] retryLastMessage not implemented yet");
}

// ─── Sessions ───────────────────────────────────────────────────────

/** Known session channel types */
const SESSION_CHANNELS = ["websocket", "dmwork", "cli", "telegram"] as const;
type KnownChannel = (typeof SESSION_CHANNELS)[number];
export type SessionChannel = KnownChannel | "unknown";

export interface SessionSummary {
  session_id: string;
  /** Original key from backend (e.g., "websocket:uuid", "dmwork:xxx") */
  key?: string;
  workspace?: string;
  agent_id?: string;
  title?: string;
  created_at?: number;
  updated_at?: number;
  meta?: Record<string, any>;
  source?: string;
  channel?: SessionChannel;
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

/**
 * Extract session_id from the key field.
 * Keys can be in format "channel:id" (e.g., "websocket:uuid", "dmwork:xxx")
 */
function extractSessionId(key: string): string {
  const colonIndex = key.indexOf(":");
  if (colonIndex !== -1) {
    return key.substring(colonIndex + 1);
  }
  return key;
}

export async function fetchSessions(
  _workspace?: string | null,
): Promise<SessionSummary[]> {
  try {
    const res = await fetch(`http://127.0.0.1:18790/api/sessions`);
    if (!res.ok) return [];
    const data = await res.json();
    const sessions = data.sessions || [];
    return sessions.map((s: any) => {
      const sessionId = s.key || s.session_id;
      // Cache the mapping for later API calls (key is used directly as session_id)
      if (s.key) {
        registerSessionKey(sessionId, s.key);
      }
      return {
        session_id: sessionId,
        key: s.key,
        workspace: s.workspace,
        agent_id: s.agent_id,
        title: s.title,
        created_at: s.created_at
          ? new Date(s.created_at).getTime() / 1000
          : undefined,
        updated_at: s.updated_at
          ? new Date(s.updated_at).getTime() / 1000
          : undefined,
        meta: s.meta,
        source: s.source,
        channel: (s.channel as SessionChannel) || "unknown",
      };
    });
  } catch {
    return [];
  }
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
 * v5 REST API message format (same as WebSocket format).
 * Each message has: id, role, and data (the actual message content).
 */
export interface SessionMessage {
  id: string;
  role:
  | "user"
  | "assistant"
  | "assistant.delta"
  | "tool_call"
  | "tool_result"
  | "system"
  | "control";
  data: Record<string, any>;
}

/**
 * Fetch messages for a session from REST API.
 * Returns raw v5 format: `{id, role, data}[]`.
 * The consumer (e.g., ws-stream-manager.loadHistory) handles format conversion.
 */
export async function fetchSessionMessages(
  sessionId: string,
): Promise<SessionMessage[]> {
  try {
    const key = encodeSessionKey(sessionId);
    const res = await fetch(
      `http://127.0.0.1:18790/api/sessions/${key}/messages`,
    );
    if (!res.ok) return [];
    // v5 response: { title: string, messages: SessionMessage[] }
    const data = await res.json();
    const messages = data.messages || [];
    console.log("[API] fetchSessionMessages response:", {
      sessionId,
      messageCount: messages.length,
      sampleMessage: messages[0],
      isV5Format: messages[0] && "role" in messages[0] && "data" in messages[0],
    });
    return messages;
  } catch (e) {
    console.error("[API] fetchSessionMessages error:", e);
    return [];
  }
}

export async function fetchUsage(_sessionId: string): Promise<number> {
  return 0;
}

export async function updateSession(
  _sessionId: string,
  _data: any,
): Promise<{ status: string } | null> {
  return { status: "updated" };
}

export async function triggerCompaction(
  _sessionId: string,
): Promise<{ status: string } | null> {
  return { status: "ok" };
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
  try {
    const result = await window.desktop.fs.readFile(AI_BASE_CONFIG_PATH);
    // IPC returns { content: string, language?: string } or { content: "", error: string }
    const raw = typeof result === "string" ? result : result?.content || "";
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
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

// ─── Skills ─────────────────────────────────────────────────────────

export interface SkillDef {
  id: string;
  name: string;
  description: string;
}

export async function fetchSkills(
  _workspace?: string | null,
): Promise<SkillDef[]> {
  return [];
}

// ─── Agents ─────────────────────────────────────────────────────────

export interface ChatAgent {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  is_builtin?: boolean;
  tools?: string[];
}

export async function fetchChatAgents(
  _workspace?: string | null,
): Promise<ChatAgent[]> {
  return [
    {
      id: "code_agent",
      name: "Ftre",
      description: "Default coding agent",
      is_builtin: true,
    },
  ];
}

export interface AgentDef {
  id: string;
  name: string;
  description?: string;
  system_prompt?: string;
  tools?: string[];
}

export async function fetchAgentDefs(
  _workspace?: string | null,
): Promise<AgentDef[]> {
  return [];
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
