/**
 * GlobalEventStream — 全局 SSE 连接
 *
 * 连接后端 GET /events/stream，接收所有 session 的实时事件。
 * 根据 session_id 分发到 streamManager 中对应的 StreamSession。
 *
 * 这是前端接收所有 session 事件的唯一通道。
 * chat.py 和 dispatcher 都通过 EventBus 推送事件到这里。
 */
import { streamManager, type StreamSession } from "./stream-manager";
import { useSession } from "@/stores/session";
import { useWorkspace } from "@/stores/workspace";
import {
  useEditor,
  buildDiffId,
  buildDiffTabPath,
  type DiffEntry,
} from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import {
  resolveFilePathWithWorkspace,
  resolveFilePath,
  normalizePathForCompare,
} from "@/utils/pathUtils";
import { fetchUsage, fetchSessionMessages } from "./api";

const BACKEND_URL = "http://localhost:9988";
const RECONNECT_DELAY = 3000;

/** 文件操作相关的工具名 */
const FILE_WRITE_TOOLS = new Set(["write", "edit"]);

function resolveForSession(filePath: string, session: StreamSession): string {
  if (session.workspace) {
    return resolveFilePathWithWorkspace(filePath, session.workspace);
  }
  return resolveFilePath(filePath);
}

class GlobalEventStream {
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    this.disconnect();

    const source = new EventSource(`${BACKEND_URL}/events/stream`);
    this.source = source;

    source.addEventListener("connected", () => {
      console.log("[GlobalEventStream] connected");
    });

    // session 创建
    source.addEventListener("session_created", (e) => {
      try {
        const raw = JSON.parse((e as MessageEvent).data);
        const payload = raw.payload || raw;
        const sessionId = payload.session_id || raw.session_id;
        const workspace = payload.workspace || "";
        const eventTimestamp = Date.now();

        console.log(`[session_created] 收到事件 时间戳=${eventTimestamp} sessionId=${sessionId} workspace=${workspace}`);

        if (!sessionId) return;

        // 如果有 pendingSession（用户刚发消息），先注册 session_id
        const pending = streamManager.getActive();
        let session: StreamSession;
        if (pending && !pending.sessionId) {
          streamManager.registerSessionId(pending, sessionId);
          session = pending;
        } else {
          session = streamManager.getOrCreate(sessionId);
        }

        if (!session.workspace && workspace) {
          session.workspace = workspace;
        }

        // 如果是当前 workspace 的 session，刷新列表 + 自动加入 openTabs
        const currentWorkspace = useWorkspace.getState().rootPath;
        if (
          currentWorkspace &&
          normalizePathForCompare(workspace) ===
            normalizePathForCompare(currentWorkspace)
        ) {
          useSession
            .getState()
            .loadAllSessions()
            .then(() => {
              const loadTimestamp = Date.now();
              const allSessions = useSession.getState().allSessions;
              const found = allSessions.find(s => s.session_id === sessionId);
              console.log(`[session_created] loadAllSessions完成 时间戳=${loadTimestamp} 耗时=${loadTimestamp - eventTimestamp}ms sessionId=${sessionId} 列表长度=${allSessions.length} 是否包含新session=${!!found}`);
              if (!found) {
                console.log(`[session_created] 列表中所有session:`, allSessions.map(s => ({ id: s.session_id, title: s.title })));
              }
              useSession.getState().openTab(sessionId);
            })
            .catch(() => {
              /* ignore */
            });
        }
      } catch {
        /* ignore */
      }
    });

    // session 状态变更（idle ↔ running）
    source.addEventListener("session_status_change", (e) => {
      try {
        const raw = JSON.parse((e as MessageEvent).data);
        const payload = raw.payload || raw;
        const sessionId = payload.session_id;
        const status = payload.status as "idle" | "running";

        if (!sessionId) return;

        const session = streamManager.get(sessionId);
        if (session) {
          session.setStreaming(status === "running");

          // 刷新该工作区的 sessionList
          const workspace = session.workspace;
          const currentWorkspace = useWorkspace.getState().rootPath;
          if (
            workspace &&
            currentWorkspace &&
            normalizePathForCompare(workspace) ===
              normalizePathForCompare(currentWorkspace)
          ) {
            useSession.getState().loadAllSessions();
          }
        }

        // 如果用户当前处于该 session，刷新消息列表
        const active = streamManager.getActive();
        if (active?.sessionId === sessionId) {
          fetchSessionMessages(sessionId).then((events) => {
            streamManager.replayInto(sessionId, events);
          });
          fetchUsage(sessionId).then((tokens) => {
            if (active) active.setContextTokens(tokens);
          });
        }
      } catch {
        /* ignore */
      }
    });

    // 所有事件类型统一处理
    const eventTypes = [
      "user_input",
      "message",
      "message_complete",
      "tool_call",
      "tool_call_streaming",
      "tool_result",
      "tool_cancelled",
      "tool_timed_out",
      "usage_update",
      "done",
      "error",
      "interrupt",
      "retry",
    ];

    for (const eventType of eventTypes) {
      source.addEventListener(eventType, (e) => {
        try {
          const raw = JSON.parse((e as MessageEvent).data);
          const sessionId = raw.session_id;
          const payload = raw.payload || {};
          if (!sessionId) return;

          const session = streamManager.getOrCreate(sessionId);
          this.dispatchEvent(session, eventType, payload);
        } catch {
          /* ignore */
        }
      });
    }

    source.onerror = () => {
      console.warn("[GlobalEventStream] error, reconnecting...");
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  private scheduleReconnect(): void {
    this.disconnect();
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY);
  }

  private async dispatchEvent(
    session: StreamSession,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (eventType) {
      case "user_input": {
        // 渲染用户消息
        const content =
          (payload.content as string) || (payload.text as string) || "";
        const parts = payload.parts as
          | Array<{ type: string; data: unknown }>
          | undefined;
        let text = content;
        let codeRefs: import("@/types/chat").CodeRef[] | undefined;

        if (parts && Array.isArray(parts)) {
          const texts: string[] = [];
          const refs: import("@/types/chat").CodeRef[] = [];
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

        session.addUserMessage(
          text,
          codeRefs,
          parts as import("@/types/chat").MessagePart[] | undefined,
        );
        break;
      }
      case "message": {
        // 重试成功，清除 retry 状态
        if (session.retryState) {
          session.setRetryState(null);
        }
        if (!session.currentAssistantId) {
          session.startAssistantMessage();
        }
        session.appendAssistantContent(
          session.currentAssistantId!,
          ((payload.content as string) || "").replace(/\\n/g, "\n"),
        );
        break;
      }
      case "message_complete": {
        if (session.currentAssistantId) {
          session.finalizeAssistantMessage(session.currentAssistantId);
        }
        break;
      }
      case "tool_call_streaming": {
        if (session.retryState) {
          session.setRetryState(null);
        }
        const toolCalls = payload.tool_calls as Array<{
          index: number;
          id?: string;
          name?: string;
          arguments_delta?: string;
        }>;
        if (toolCalls) {
          for (const tc of toolCalls) {
            session.handleToolCallStreamingChunk(tc);
          }
        }
        break;
      }
      case "tool_call": {
        if (session.retryState) {
          session.setRetryState(null);
        }
        if (session.currentAssistantId) {
          session.finalizeAssistantMessage(session.currentAssistantId);
        }

        const toolId = payload.id as string;
        const toolName = payload.name as string;
        const args = (payload.arguments || {}) as Record<string, unknown>;

        session.pendingToolArgs.set(toolId, args);

        // 对 write/edit 类 Tool，捕获文件原始内容快照
        if (FILE_WRITE_TOOLS.has(toolName)) {
          const filePath =
            (args.filePath as string) || (args.file_path as string);
          if (filePath) {
            try {
              const fullPath = resolveForSession(filePath, session);
              const result = await window.desktop.fs.readFile(fullPath);
              if (!result.error) {
                session.pendingSnapshots.set(toolId, {
                  filePath: fullPath,
                  beforeContent: result.content,
                });
              }
            } catch {
              /* ignore */
            }
          }
        }

        // 尝试定稿已有的 streaming 消息，否则走原逻辑创建
        if (!session.finalizeStreamingToolCall(toolId, toolName, args)) {
          session.addToolCall(toolId, toolName, args);
        }
        break;
      }
      case "tool_result": {
        const toolId = payload.id as string;
        const toolStatus = (payload.status as string) || "completed";
        const mappedStatus =
          toolStatus === "cancelled"
            ? "cancelled"
            : toolStatus === "error"
              ? "error"
              : "completed";
        session.updateToolResult(
          toolId,
          (payload.result as string) || "",
          mappedStatus,
        );

        // Diff 计算
        const snapshot = session.pendingSnapshots.get(toolId);
        if (snapshot) {
          session.pendingSnapshots.delete(toolId);
          try {
            const result = await window.desktop.fs.readFile(snapshot.filePath);
            if (!result.error && result.content !== snapshot.beforeContent) {
              const diffId = buildDiffId(toolId, snapshot.filePath);
              const diff: DiffEntry = {
                id: diffId,
                filePath: snapshot.filePath,
                tabPath: buildDiffTabPath(snapshot.filePath),
                originalContent: snapshot.beforeContent,
                newContent: result.content,
                toolName: (payload.name as string) || "",
                isApproximate: false,
              };

              if (session.isActive) {
                const editorState = useEditor.getState();
                editorState.addDiff(diff);
                editorState.refreshFile(snapshot.filePath, result.content);
                if (useLayout.getState().autoFollowFiles) {
                  this.autoOpenFile(snapshot.filePath);
                }
              } else {
                session.deferredEditorActions.push({
                  type: "addDiff",
                  diff,
                  filePath: snapshot.filePath,
                  newContent: result.content,
                });
              }
            }
          } catch {
            /* ignore */
          }
        }
        break;
      }
      case "usage_update": {
        // 每次 LLM 迭代后实时推送的 token 用量
        const usage = payload.usage as Record<string, number> | undefined;
        if (usage?.last_prompt_tokens != null) {
          session.setContextTokens(usage.last_prompt_tokens);
        }
        break;
      }
      case "done": {
        if (session.currentAssistantId) {
          session.finalizeAssistantMessage(session.currentAssistantId);
        }
        session.setStreaming(false);
        // 清除 retry 状态
        if (session.retryState) {
          session.setRetryState(null);
        }

        const sid = session.sessionId;
        if (sid) {
          fetchUsage(sid).then((tokens) => session.setContextTokens(tokens));
          useSession.getState().loadSessions(session.workspace);
        }
        break;
      }
      case "error": {
        session.addSystemMessage(
          (payload.message as string) || "Unknown error",
        );
        session.setStreaming(false);
        // 清除 retry 状态
        if (session.retryState) {
          session.setRetryState(null);
        }
        break;
      }

      case "retry": {
        session.setRetryState({
          code: (payload.code as string) || "unknown",
          message: (payload.message as string) || "正在重试",
          attempt: (payload.attempt as number) || 1,
          maxAttempts: (payload.max_attempts as number) || 3,
        });
        break;
      }
      // tool_cancelled, tool_timed_out 等生命周期事件目前不需要前端特殊处理
    }
  }

  private async autoOpenFile(fullPath: string): Promise<void> {
    const editorState = useEditor.getState();
    const existing = editorState.openFiles.find((f) => f.path === fullPath);
    if (existing) {
      editorState.setActive(fullPath);
      return;
    }
    try {
      const result = await window.desktop.fs.readFile(fullPath);
      if (result.error) return;
      const name = fullPath.split(/[\\/]/).pop() || fullPath;
      editorState.openFile({
        path: fullPath,
        name,
        language: result.language,
        content: result.content,
      });
    } catch {
      /* ignore */
    }
  }
}

export const globalEventStream = new GlobalEventStream();
