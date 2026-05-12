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

export interface SessionSummary {
  session_id: string;
  workspace?: string;
  agent_id?: string;
  title?: string;
  created_at?: number;
  updated_at?: number;
  meta?: Record<string, any>;
  source?: string;
}

export async function fetchSessions(
  _workspace?: string | null,
): Promise<SessionSummary[]> {
  try {
    const res = await fetch(`http://127.0.0.1:18790/api/sessions`);
    if (!res.ok) return [];
    const data = await res.json();
    const sessions = data.sessions || [];
    return sessions.map((s: any) => ({
      session_id: s.key ? s.key.replace("websocket:", "") : s.session_id,
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
    }));
  } catch {
    return [];
  }
}

/**
 * Encode a session key for use in REST API URLs.
 * The backend accepts the raw key (e.g. "websocket:uuid") directly in the path.
 */
function encodeSessionKey(sessionId: string): string {
  return `websocket:${sessionId}`;
}

export async function fetchSessionMessages(sessionId: string): Promise<any[]> {
  try {
    const key = encodeSessionKey(sessionId);
    const res = await fetch(
      `http://127.0.0.1:18790/api/sessions/${key}/messages`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages || [];
  } catch {
    return [];
  }
}

export async function fetchUsage(_sessionId: string): Promise<number> {
  return 0;
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const key = encodeSessionKey(sessionId);
    await fetch(`http://127.0.0.1:18790/api/sessions/${key}/delete`);
  } catch {
    // Silent failure
  }
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
    models: name === currentProviderName
      ? { [currentModel]: currentModel }
      : {},
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
