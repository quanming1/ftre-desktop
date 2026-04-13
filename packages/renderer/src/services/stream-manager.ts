/**
 * StreamSession + SessionStreamManager
 *
 * 全局 SSE 会话管理器 —— 生命周期与 App 一致。
 * 每个会话一个 StreamSession 实例，切换会话时后台流不中断，
 * 切换回来时 UI 直接接上实时增量。
 */
import type {
  AnyMessage,
  ChatMessage,
  ToolCallMessage,
  ActionButtonMessage,
  CodeRef,
  MessagePart,
  DiffMeta,
} from "@/types/chat";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { useWorkspace } from "@/stores/workspace";
import { useEditor } from "@/stores/editor";
import { sendChat, cancelChat, retryChat } from "./api";
import { parse as parsePartialJson } from "partial-json";

/** 同步读取当前工作区路径 */
function getCurrentWorkspace(): string | null {
  return useWorkspace.getState().rootPath;
}

// ═══════════════════════════════════════════════════════════════════════
// ID 生成
// ═══════════════════════════════════════════════════════════════════════

let msgCounter = 0;
function nextId(): string {
  return `msg-${++msgCounter}-${Date.now()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// StreamSession — 每个会话一个实例
// ═══════════════════════════════════════════════════════════════════════

/** 延迟的编辑器副作用（非 active 时积累，切回来时回放） */
export interface DeferredEditorAction {
  type: "addDiff";
  diff: import("@/stores/editor").DiffEntry;
  filePath: string;
  newContent: string;
}

/** LLM 重试状态 */
export interface RetryState {
  code: string;
  message: string;
  attempt: number;
  maxAttempts: number;
}

export class StreamSession {
  sessionId: string | null;
  /** 此 session 所属的工作区路径 */
  workspace: string | null;
  messages: AnyMessage[] = [];
  isStreaming = false;
  streamingMessageId: string | null = null;
  contextTokens = 0;
  /** LLM 重试状态，null 表示无重试 */
  retryState: RetryState | null = null;

  // SSE 内部状态
  currentAssistantId: string | null = null;
  pendingToolArgs = new Map<string, Record<string, unknown>>();
  pendingSnapshots = new Map<
    string,
    { filePath: string; beforeContent: string }
  >();

  /** 延迟的编辑器副作用（后台流产生的 diff/refresh，等切回来时回放） */
  deferredEditorActions: DeferredEditorAction[] = [];

  /**
   * 流式 tool_call 追踪
   * key = index（LLM 返回的 tool_call 序号）
   * 用 index 而非 id，因为首帧可能只有 index 没有 id
   */
  private streamingToolCalls = new Map<
    number,
    {
      id: string | null;
      name: string;
      argsBuffer: string;
      messageId: string;
    }
  >();

  /**
   * Manager 注入的回调 —— 当且仅当此 session 是 active 时，
   * 每次消息变更都会调用此函数，将状态同步到 chat store。
   */
  onChanged: (() => void) | null = null;

  constructor(sessionId: string | null, workspace?: string | null) {
    this.sessionId = sessionId;
    this.workspace = workspace ?? null;
  }

  // ── 消息操作（接口与 chat store 一致）──────────────────────────

  setSessionId(id: string): void {
    this.sessionId = id;
    this.emitChange();
  }

  addUserMessage(
    content: string,
    codeRefs?: CodeRef[],
    parts?: MessagePart[],
    backendId?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const msg: ChatMessage = {
      id: backendId || nextId(),
      role: "user",
      content,
      codeRefs,
      parts,
      metadata,
    };
    this.messages = [...this.messages, msg];
    this.emitChange();
  }

  startAssistantMessage(backendId?: string): string {
    const id = backendId || nextId();
    const msg: ChatMessage = {
      id,
      role: "assistant",
      content: "",
      streaming: true,
    };
    this.messages = [...this.messages, msg];
    this.streamingMessageId = id;
    this.currentAssistantId = id;
    this.emitChange();
    return id;
  }

  appendAssistantContent(id: string, content: string): void {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx >= 0 && "content" in this.messages[idx]) {
      const msg = this.messages[idx] as any;
      const newArr = this.messages.slice();
      newArr[idx] = { ...msg, content: msg.content + content };
      this.messages = newArr;
    }
    this.emitChangeThrottled();
  }

  finalizeAssistantMessage(id: string): void {
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, streaming: false } : m,
    );
    this.streamingMessageId = null;
    this.currentAssistantId = null;
    this.emitChange();
  }

  addToolCall(
    toolId: string,
    name: string,
    args: Record<string, unknown>,
    backendId?: string,
  ): string {
    const id = backendId || nextId();
    const msg: ToolCallMessage = {
      id,
      role: "tool",
      toolId,
      name,
      arguments: args,
      status: "running",
    };
    this.messages = [...this.messages, msg];
    this.emitChange();
    return id;
  }

  updateToolResult(
    toolId: string,
    result: string,
    status: "completed" | "error" | "cancelled" = "completed",
  ): void {
    this.messages = this.messages.map((m) =>
      "toolId" in m && m.toolId === toolId ? { ...m, result, status } : m,
    );
    this.emitChange();
  }

  addSystemMessage(content: string): void {
    const msg: ChatMessage = { id: nextId(), role: "system", content };
    this.messages = [...this.messages, msg];
    this.emitChange();
  }

  /**
   * 将 diffMeta 附加到最后一条 user 消息上
   * 用于 replayInto 时从后端事件恢复 diff_meta 信息
   */
  attachDiffMetaToLastUserMessage(diffMeta: DiffMeta): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if ("role" in msg && msg.role === "user") {
        const newArr = this.messages.slice();
        newArr[i] = { ...msg, diffMeta } as ChatMessage;
        this.messages = newArr;
        this.emitChange();
        return;
      }
    }
  }

  addActionButton(label: string, step: string, summary: string): void {
    const msg: ActionButtonMessage = {
      id: nextId(),
      role: "action_button",
      label,
      step,
      summary,
    };
    this.messages = [...this.messages, msg];
    this.emitChange();
  }

  setStreaming(v: boolean): void {
    // 流结束时清理 streamingToolCalls，防止跨轮次 index 复用导致参数拼接异常
    if (!v && this.streamingToolCalls.size > 0) {
      // 将残留的 streaming 状态工具调用标记为 cancelled
      for (const [, entry] of this.streamingToolCalls) {
        this.messages = this.messages.map((m) =>
          m.id === entry.messageId && "toolId" in m && m.status === "streaming"
            ? { ...m, status: "cancelled" as const }
            : m,
        );
      }
      this.streamingToolCalls.clear();
    }
    this.isStreaming = v;
    this.emitChange();
  }

  setContextTokens(n: number): void {
    this.contextTokens = n;
    this.emitChange();
  }

  setRetryState(state: RetryState | null): void {
    this.retryState = state;
    this.emitChange();
  }

  // ── 流生命周期 ──────────────────────────────────────────────────

  async cancelStream(): Promise<void> {
    if (this.sessionId) {
      await cancelChat(this.sessionId).catch(() => {});
    }
  }

  dispose(): void {
    this.cancelThrottledEmit();
    this.onChanged = null;
    this.messages = [];
    this.isStreaming = false;
    this.streamingMessageId = null;
    this.currentAssistantId = null;
    this.pendingToolArgs.clear();
    this.pendingSnapshots.clear();
    this.streamingToolCalls.clear();
    this.deferredEditorActions = [];
  }

  /** 判断此 session 当前是否是 active 的（有 onChanged 回调绑定） */
  get isActive(): boolean {
    return this.onChanged !== null;
  }

  // ── 流式 tool_call 管理 ────────────────────────────────────────

  /** 处理 tool_call_streaming 事件的单个 chunk */
  handleToolCallStreamingChunk(chunk: {
    index: number;
    id?: string;
    name?: string;
    arguments_delta?: string;
  }): void {
    let entry = this.streamingToolCalls.get(chunk.index);

    if (!entry) {
      // 首帧：创建 streaming 状态的 ToolCallMessage
      if (this.currentAssistantId) {
        this.finalizeAssistantMessage(this.currentAssistantId);
      }
      const name = chunk.name || "unknown";
      const messageId = this.addStreamingToolCall(
        chunk.id || `pending-${chunk.index}`,
        name,
      );
      entry = { id: chunk.id || null, name, argsBuffer: "", messageId };
      this.streamingToolCalls.set(chunk.index, entry);
    }

    // 更新 id（某些 chunk 才携带 id）
    if (chunk.id && !entry.id) {
      entry.id = chunk.id;
    }

    // 累积 arguments 并用 partial-json 解析
    if (chunk.arguments_delta) {
      entry.argsBuffer += chunk.arguments_delta;
      this.updateStreamingToolCallArgs(entry);
    }
  }

  /** 创建 status:'streaming' 的 ToolCallMessage */
  private addStreamingToolCall(toolId: string, name: string): string {
    const id = nextId();
    const msg: ToolCallMessage = {
      id,
      role: "tool",
      toolId,
      name,
      arguments: {},
      status: "streaming",
    };
    this.messages = [...this.messages, msg];
    this.emitChange();
    return id;
  }

  /** 用 partial-json 解析累积的参数字符串，更新 ToolCallMessage.arguments */
  private updateStreamingToolCallArgs(entry: {
    argsBuffer: string;
    messageId: string;
  }): void {
    try {
      const parsed = parsePartialJson(entry.argsBuffer);
      if (parsed && typeof parsed === "object") {
        this.messages = this.messages.map((m) =>
          m.id === entry.messageId && "toolId" in m
            ? { ...m, arguments: parsed as Record<string, unknown> }
            : m,
        );
        this.emitChangeThrottled();
      }
    } catch {
      // partial-json 解析失败，等更多数据到达
    }
  }

  /**
   * tool_call 完整事件到达时，定稿流式 tool_call。
   * 返回 true 表示找到了已有的 streaming 消息并定稿，false 表示需要走原逻辑。
   */
  finalizeStreamingToolCall(
    toolId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): boolean {
    for (const [index, entry] of this.streamingToolCalls) {
      if (entry.id === toolId || (!entry.id && entry.name === toolName)) {
        // 更新为完整参数 + status: 'running'
        this.messages = this.messages.map((m) =>
          m.id === entry.messageId && "toolId" in m
            ? { ...m, toolId, arguments: args, status: "running" as const }
            : m,
        );
        this.streamingToolCalls.delete(index);
        this.emitChange();
        return true;
      }
    }
    return false;
  }

  // ── 内部 ────────────────────────────────────────────────────────

  private emitChange(): void {
    // 立即同步 —— 用于结构性变更（新增消息、工具状态、流式结束等）
    this.cancelThrottledEmit();
    this.onChanged?.();
  }

  private throttleRaf: number | null = null;

  private emitChangeThrottled(): void {
    // rAF 节流 —— 每帧最多同步一次，与浏览器渲染周期对齐
    if (this.throttleRaf) return;
    this.throttleRaf = requestAnimationFrame(() => {
      this.throttleRaf = null;
      this.onChanged?.();
    });
  }

  private cancelThrottledEmit(): void {
    if (this.throttleRaf) {
      cancelAnimationFrame(this.throttleRaf);
      this.throttleRaf = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SessionStreamManager — 全局单例
// ═══════════════════════════════════════════════════════════════════════

class SessionStreamManager {
  private sessions = new Map<string, StreamSession>();
  private activeSessionId: string | null = null;
  /** 新会话（sessionId 尚未分配） */
  private pendingSession: StreamSession | null = null;

  // ── 获取 session ────────────────────────────────────────────────

  /** 按 ID 获取 session 实例（不存在则返回 undefined） */
  get(sessionId: string): StreamSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** 按 ID 获取或创建 session 实例 */
  getOrCreate(sessionId: string): StreamSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new StreamSession(sessionId);
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /** 获取当前活跃的 session 实例 */
  getActive(): StreamSession | null {
    if (this.pendingSession && this.activeSessionId === null) {
      return this.pendingSession;
    }
    if (this.activeSessionId) {
      return this.sessions.get(this.activeSessionId) ?? null;
    }
    return null;
  }

  // ── 会话切换 ────────────────────────────────────────────────────

  /** 切换到指定会话，将其消息同步到 chat store */
  switchTo(sessionId: string): void {
    // 解绑旧 session 的回调
    const oldSession = this.getActive();
    if (oldSession) {
      oldSession.onChanged = null;
    }

    this.activeSessionId = sessionId;
    this.pendingSession = null;

    const session = this.getOrCreate(sessionId);
    this.bindAndSync(session);
  }

  /** 新建空会话 */
  newSession(): void {
    // 解绑旧 session
    const oldSession = this.getActive();
    if (oldSession) {
      oldSession.onChanged = null;
    }

    this.activeSessionId = null;
    const workspace = getCurrentWorkspace();
    this.pendingSession = new StreamSession(null, workspace);
    this.bindAndSync(this.pendingSession);
  }

  // ── 发送消息 ────────────────────────────────────────────────────

  /** 发送消息（fire-and-forget，事件通过全局 SSE 推送） */
  async sendMessage(params: {
    message: Array<{ type: string; data: unknown }>;
    text: string;
    codeRefs?: CodeRef[];
    parts?: MessagePart[];
    model: string | null;
    workspace: string | null;
    agentId?: string;
  }): Promise<void> {
    let session = this.getActive();
    if (!session) {
      this.newSession();
      session = this.pendingSession!;
    }

    if (!session.workspace && params.workspace) {
      session.workspace = params.workspace;
    }

    // 不在本地渲染用户消息和设置 streaming 状态
    // 统一由后端 EventBus → 全局 SSE → GlobalEventStream 推送

    try {
      const result = await sendChat({
        message: params.message,
        sessionId: session.sessionId,
        model: params.model,
        workspace: params.workspace,
        agentId: params.agentId,
      });

      // 后端返回 session_id，注册到 map
      if (result.session_id) {
        this.registerSessionId(session, result.session_id);
      }

      // 立即同步 model/agentId 到前端 sessions 数组，确保切换会话时能恢复
      const sid = result.session_id || session.sessionId;
      if (sid) {
        import("@/stores/session").then(({ useSession }) => {
          useSession.getState().patchSession(sid, {
            model: params.model,
            agentId: params.agentId,
          });
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        session.addSystemMessage(err.message || "Network error");
      }
    }
  }

  // ── 取消流 ──────────────────────────────────────────────────────

  async cancelStream(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.activeSessionId;
    if (!id) {
      // 可能是 pending session
      await this.pendingSession?.cancelStream();
      return;
    }
    const session = this.sessions.get(id);
    if (session) {
      await session.cancelStream();
    }
  }

  // ── 重试上一轮 ────────────────────────────────────────────────

  async retryLastMessage(model?: string | null): Promise<void> {
    const session = this.getActive();
    if (!session?.sessionId) return;
    if (session.isStreaming) return;

    try {
      await retryChat({
        sessionId: session.sessionId,
        model,
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        session.addSystemMessage(err.message || "Retry failed");
      }
    }
  }

  // ── 删除 / 清理 ────────────────────────────────────────────────

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.dispose();
      this.sessions.delete(sessionId);
    }
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  /** 切换工作区 —— 解绑回调、清空 UI，清理非流式 session 避免内存泄漏 */
  switchWorkspace(): void {
    const oldSession = this.getActive();
    if (oldSession) {
      oldSession.onChanged = null;
    }
    this.activeSessionId = null;
    this.pendingSession?.dispose();
    this.pendingSession = null;
    useChat.getState().clearMessages();

    // 清理非流式 session 释放内存，保留正在流式中的（让后台流继续跑）
    for (const [id, session] of this.sessions) {
      if (!session.isStreaming) {
        session.dispose();
        this.sessions.delete(id);
      }
    }
  }

  /** 强制销毁所有 session（App 卸载等场景） */
  clearAll(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.pendingSession?.dispose();
    this.pendingSession = null;
    this.activeSessionId = null;
    useChat.getState().clearMessages();
  }

  /** 查询某个 session 是否正在流式中 */
  isSessionStreaming(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isStreaming ?? false;
  }

  // ── 从后端事件回放消息 ──────────────────────────────────────────

  /**
   * 从后端历史事件重建消息列表。
   *
   * 后端返回的是已入库的完整历史。如果 session 正在流式中，
   * 流式产生的未入库增量（streaming message）会被保留并追加在末尾。
   *
   * 这样 switchSession 可以始终调用 replayInto，不需要跳过。
   */
  replayInto(
    sessionId: string,
    events: Array<{
      id: string;
      type: string;
      data: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }>,
  ): void {
    const session = this.getOrCreate(sessionId);

    // 保存流式增量：如果 session 正在流式中，
    // streamingMessageId 对应的消息是实时推送的、还没入库的，需要保留
    let streamingTail: AnyMessage[] = [];
    if (session.isStreaming && session.streamingMessageId) {
      const streamIdx = session.messages.findIndex(
        (m) => m.id === session.streamingMessageId,
      );
      if (streamIdx >= 0) {
        streamingTail = session.messages.slice(streamIdx);
      }
    }

    // 暂时禁用 onChanged，回放完再统一同步一次
    const savedCallback = session.onChanged;
    session.onChanged = null;

    // 清空并从后端历史重建
    session.messages = [];
    session.streamingMessageId = null;
    session.currentAssistantId = null;

    for (const event of events) {
      const { id: eventId, type, data } = event;
      switch (type) {
        case "user_input": {
          const parts = data.parts as
            | Array<{ type: string; data: unknown }>
            | undefined;
          let text = (data.content as string) || "";
          let codeRefs: CodeRef[] | undefined;

          if (parts && Array.isArray(parts)) {
            const texts: string[] = [];
            const refs: CodeRef[] = [];
            for (const p of parts) {
              if (p.type === "text") {
                texts.push(p.data as string);
              } else if (p.type === "code_ref") {
                const d = p.data as {
                  path: string;
                  name: string;
                  lines: number[];
                  raw: string;
                };
                refs.push({
                  filePath: d.path,
                  fileName: d.name,
                  startLine: d.lines[0],
                  endLine: d.lines[1],
                  content: d.raw,
                });
              }
            }
            text = texts.join(" ").trim() || text;
            if (refs.length > 0) codeRefs = refs;
          }

          // 使用后端返回的真实消息 ID（用于回滚等操作）
          session.addUserMessage(
            text,
            codeRefs,
            parts as MessagePart[] | undefined,
            eventId,
            event.metadata,
          );
          const diffMeta = (event.metadata as any)?.diff_meta;
          if (diffMeta) {
            session.attachDiffMetaToLastUserMessage(diffMeta);
          }
          break;
        }
        case "message_complete": {
          // 使用后端 event.id 作为消息 ID，确保 replayInto 多次调用时 ID 稳定
          const id = session.startAssistantMessage(eventId);
          session.appendAssistantContent(id, (data.content as string) || "");
          session.finalizeAssistantMessage(id);
          break;
        }
        case "tool_call":
          // 使用后端 event.id 作为消息 ID，确保 replayInto 多次调用时 ID 稳定
          session.addToolCall(
            (data.id as string) || "",
            (data.name as string) || "",
            (data.arguments || {}) as Record<string, unknown>,
            eventId,
          );
          break;
        case "tool_result":
          session.updateToolResult(
            (data.id as string) || "",
            (data.result as string) || "",
            (data.status as "completed" | "error") || "completed",
          );
          break;
        case "error": {
          session.addSystemMessage((data.message as string) || "Unknown error");
          break;
        }
      }
    }

    // 追加流式增量（未入库的实时消息）
    if (streamingTail.length > 0) {
      session.messages = [...session.messages, ...streamingTail];
      // 恢复 streaming 状态
      const lastTail = streamingTail[streamingTail.length - 1];
      if ("streaming" in lastTail && lastTail.streaming) {
        session.streamingMessageId = lastTail.id;
        session.currentAssistantId = lastTail.id;
      }
    }

    // 恢复回调并触发一次同步
    session.onChanged = savedCallback;
    if (savedCallback) {
      this.syncToChatStore(session);
    }
  }

  /**
   * SSE 'session' 事件回调 —— 后端分配了 sessionId，
   * 如果当前是 pendingSession 需要注册到 map。
   */
  registerSessionId(session: StreamSession, sessionId: string): void {
    session.setSessionId(sessionId);

    if (session === this.pendingSession) {
      this.sessions.set(sessionId, session);
      this.activeSessionId = sessionId;
      this.pendingSession = null;
    } else if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, session);
    }
  }

  // ── 内部同步 ────────────────────────────────────────────────────

  private bindAndSync(session: StreamSession): void {
    session.onChanged = () => this.syncToChatStore(session);
    this.syncToChatStore(session);

    // 回放延迟的编辑器副作用（后台流期间积累的 diff/refresh）
    if (session.deferredEditorActions.length > 0) {
      const editorState = useEditor.getState();
      for (const action of session.deferredEditorActions) {
        if (action.type === "addDiff") {
          editorState.addDiff(action.diff);
          editorState.refreshFile(action.filePath, action.newContent);
        }
      }
      session.deferredEditorActions = [];
    }
  }

  syncToChatStore(session: StreamSession): void {
    useChat.getState().syncFrom({
      sessionId: session.sessionId,
      messages: session.messages,
      isStreaming: session.isStreaming,
      streamingMessageId: session.streamingMessageId,
      contextTokens: session.contextTokens,
      retryState: session.retryState,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 全局单例
// ═══════════════════════════════════════════════════════════════════════

export const streamManager = new SessionStreamManager();
