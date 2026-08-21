import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CodeDiff } from "@jiang_quan_ming/react-code-diff";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  fetchAgentStateMessage,
  fetchAgentStatePage,
  type AgentStateMessage,
  type AgentStatePage,
} from "@/services/api";
import { wsClient, type ServerMessage } from "@/services/websocket-client";
import { useChat } from "@/stores/chat";
import { useLayout } from "@/stores/layout";

const PAGE_SIZE = 50;
const STATE_CHECKPOINT_EVENTS = new Set([
  "USER_MESSAGE", "REPLY_START", "TEXT_BLOCK_END", "THINKING_BLOCK_END",
  "DATA_BLOCK_END", "TOOL_CALL_START", "TOOL_CALL_END", "TOOL_RESULT_END",
  "MODEL_CALL_END", "REQUIRE_USER_CONFIRM", "USER_CONFIRM_RESULT", "REPLY_END", "CUSTOM",
]);

export function SessionStateRenderer({ active }: { active: boolean }) {
  const sessionId = useChat((state) => state.sessionId);
  const inspectorVisible = useLayout((state) => state.panelVisible.inspector);
  const [page, setPage] = useState<AgentStatePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fullMessages, setFullMessages] = useState<Map<string, AgentStateMessage>>(new Map());
  const [loadingFull, setLoadingFull] = useState<Set<string>>(new Set());
  const [hasNewerState, setHasNewerState] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const fullRequestRefs = useRef<Map<string, AbortController>>(new Map());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPage = useCallback(async (offset?: number, quiet = false) => {
    if (!sessionId || !active || !inspectorVisible) return;
    requestRef.current?.abort();
    fullRequestRefs.current.forEach((request) => request.abort());
    fullRequestRefs.current.clear();
    const controller = new AbortController();
    requestRef.current = controller;
    quiet ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const next = await fetchAgentStatePage(sessionId, {
        offset,
        limit: PAGE_SIZE,
        signal: controller.signal,
      });
      setPage(next);
      setExpanded(new Set());
      setFullMessages(new Map());
      setHasNewerState(false);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      quiet ? setRefreshing(false) : setLoading(false);
    }
  }, [active, inspectorVisible, sessionId]);

  useEffect(() => {
    setPage(null);
    setExpanded(new Set());
    setFullMessages(new Map());
    setHasNewerState(false);
    if (active && inspectorVisible && sessionId) void loadPage();
    return () => {
      requestRef.current?.abort();
      fullRequestRefs.current.forEach((request) => request.abort());
      fullRequestRefs.current.clear();
    };
  }, [active, inspectorVisible, sessionId, loadPage]);

  useEffect(() => {
    if (!active || !inspectorVisible || !sessionId) return;
    return wsClient.onMessage((message: ServerMessage) => {
      const eventType = (message.data as any)?.type;
      if (
        message.type !== "agent_event"
        || message.metadata?.session_id !== sessionId
        || !STATE_CHECKPOINT_EVENTS.has(eventType)
      ) return;
      const viewingTail = !page
        || page.page.offset + page.messages.length >= page.page.total;
      if (!viewingTail) {
        setHasNewerState(true);
        return;
      }
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => void loadPage(undefined, true), 200);
    });
  }, [active, inspectorVisible, loadPage, page, sessionId]);

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  const truncatedIds = useMemo(
    () => new Set(page?.truncated_message_ids ?? []),
    [page?.truncated_message_ids],
  );

  const loadFullMessage = useCallback(async (messageId: string) => {
    if (!sessionId || loadingFull.has(messageId)) return;
    const controller = new AbortController();
    fullRequestRefs.current.set(messageId, controller);
    setLoadingFull((current) => new Set(current).add(messageId));
    try {
      const message = await fetchAgentStateMessage(sessionId, messageId, controller.signal);
      setFullMessages((current) => new Map(current).set(messageId, message));
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") {
        console.error("[state-viewer] load full message failed:", reason);
      }
    } finally {
      if (fullRequestRefs.current.get(messageId) === controller) {
        fullRequestRefs.current.delete(messageId);
      }
      setLoadingFull((current) => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
    }
  }, [loadingFull, sessionId]);

  const copyMessage = useCallback(async (
    message: AgentStateMessage,
    truncated: boolean,
  ) => {
    let source = fullMessages.get(message.id) ?? message;
    if (truncated && !fullMessages.has(message.id) && sessionId) {
      source = await fetchAgentStateMessage(sessionId, message.id);
      setFullMessages((current) => new Map(current).set(message.id, source));
    }
    await navigator.clipboard.writeText(JSON.stringify(source, null, 2));
  }, [fullMessages, sessionId]);

  if (!sessionId) return <CenteredText>请选择一个会话</CenteredText>;
  if (loading && !page) return <CenteredSpinner />;
  if (error && !page) {
    return (
      <CenteredText>
        <span>{error}</span>
        <button className="underline" onClick={() => void loadPage()}>重试</button>
      </CenteredText>
    );
  }
  if (!page) return null;

  const first = page.page.total === 0 ? 0 : page.page.offset + 1;
  const last = page.page.offset + page.messages.length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-t-primary">
      <div className="flex h-8 shrink-0 items-center gap-2 bg-white px-4 text-[11px]">
        <span className="min-w-0 truncate font-mono text-t-ghost" title={sessionId}>
          {sessionId}
        </span>
        <button
          type="button"
          title="在资源管理器中打开 state.json"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-t-muted transition-colors hover:bg-hover hover:text-t-primary"
          onClick={() => {
            const reveal = window.desktop?.fs?.revealInExplorer;
            if (!reveal) {
              console.warn("[state-viewer] 当前环境不支持打开资源管理器");
              return;
            }
            void reveal(page.file_path).catch((reason) => {
              console.error("[state-viewer] reveal state.json failed:", reason);
            });
          }}
        >
          <FolderOpen size={13} /> 打开文件
        </button>
        {hasNewerState && <span className="text-t-muted">有更新</span>}
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton
            title="复制当前页 JSON"
            onClick={() => void navigator.clipboard.writeText(JSON.stringify({
              schema_version: page.schema_version,
              session: page.session,
              messages: page.messages,
              metadata: page.metadata,
            }, null, 2))}
          >
            <Copy size={13} />
          </ToolbarButton>
          <ToolbarButton title="刷新到最新状态" onClick={() => void loadPage(undefined, true)}>
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </ToolbarButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Overview page={page} />
        <Composition stats={page.stats} />
        <div className="space-y-1 px-5 pt-3">
          <JsonDisclosure label="session" value={page.session} />
          <JsonDisclosure label="metadata" value={page.metadata} />
        </div>

        <section className="px-5 pb-5 pt-7">
          <div className="mb-2.5 flex items-center">
            <h3 className="text-[13px] text-t-muted">原始消息</h3>
            <span className="ml-auto font-mono text-[12px] text-t-ghost">
              {first}–{last} / {page.page.total}
            </span>
          </div>
          <div className="overflow-hidden rounded-md border border-border bg-surface">
            {page.messages.map((message) => {
              const displayMessage = fullMessages.get(message.id) ?? message;
              return (
                <MessageRow
                  key={message.id}
                  message={displayMessage}
                  expanded={expanded.has(message.id)}
                  truncated={truncatedIds.has(message.id) && !fullMessages.has(message.id)}
                  loadingFull={loadingFull.has(message.id)}
                  onCopy={() => copyMessage(displayMessage, truncatedIds.has(message.id) && !fullMessages.has(message.id))}
                  onToggle={() => setExpanded((current) => {
                    const next = new Set(current);
                    next.has(message.id) ? next.delete(message.id) : next.add(message.id);
                    return next;
                  })}
                  onLoadFull={() => void loadFullMessage(message.id)}
                />
              );
            })}
            {page.messages.length === 0 && (
              <div className="py-12 text-center text-[13px] text-t-ghost">messages 为空</div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <PageButton
              disabled={!page.page.has_more_before || loading}
              onClick={() => void loadPage(Math.max(0, page.page.offset - PAGE_SIZE))}
            >
              <ChevronLeft size={13} /> 更早
            </PageButton>
            <PageButton
              disabled={!page.page.has_more_after && !hasNewerState}
              onClick={() => void loadPage()}
            >
              最新
            </PageButton>
            <PageButton
              disabled={!page.page.has_more_after || loading}
              onClick={() => void loadPage(page.page.offset + page.messages.length)}
            >
              更晚 <ChevronRight size={13} />
            </PageButton>
          </div>
        </section>
      </div>
    </div>
  );
}

function Overview({ page }: { page: AgentStatePage }) {
  const stats = page.stats;
  return (
    <section className="grid grid-cols-2 gap-x-12 gap-y-4 px-5 pt-5">
      <OverviewItem label="会话" value={page.session.title || "未命名会话"} />
      <OverviewItem label="消息数" value={formatNumber(stats.message_count)} />
      <OverviewItem label="Agent" value={page.session.agent_id} />
      <OverviewItem label="模型" value={stats.model || "—"} />
      <OverviewItem label="工作区" value={page.session.workspace || "—"} mono />
      <OverviewItem label="总 token" value={formatNumber(stats.total_tokens)} />
      <OverviewItem label="用户消息" value={formatNumber(stats.user_messages)} />
      <OverviewItem label="输入 token" value={formatNumber(stats.prompt_tokens)} />
      <OverviewItem label="助手消息" value={formatNumber(stats.assistant_messages)} />
      <OverviewItem label="输出 token" value={formatNumber(stats.completion_tokens)} />
      <OverviewItem label="创建时间" value={formatDate(page.session.created_at)} />
      <OverviewItem label="最后活动" value={formatDate(page.session.updated_at)} />
    </section>
  );
}

function OverviewItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[12px] text-t-ghost">{label}</div>
      <div className={`truncate text-[14px] text-t-primary ${mono ? "font-mono" : ""}`} title={value}>{value}</div>
    </div>
  );
}

function Composition({ stats }: { stats: AgentStatePage["stats"] }) {
  const parts = [
    { label: "用户", value: stats.user_messages, color: "#16a34a" },
    { label: "助手", value: stats.text_blocks, color: "#d66a2c" },
    { label: "工具", value: stats.tool_calls + stats.tool_results, color: "#8a6413" },
    { label: "其他", value: stats.thinking_blocks + stats.data_blocks + stats.system_messages, color: "#666b73" },
  ];
  const total = Math.max(1, parts.reduce((sum, part) => sum + part.value, 0));
  return (
    <section className="px-5 pt-8">
      <div className="mb-2 text-[13px] text-t-muted">消息构成</div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-elevated">
        {parts.filter((part) => part.value > 0).map((part) => (
          <div key={part.label} style={{ width: `${(part.value / total) * 100}%`, backgroundColor: part.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((part) => (
          <span key={part.label} className="inline-flex items-center gap-1 text-[12px] text-t-ghost">
            <i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: part.color }} />
            {part.label} {((part.value / total) * 100).toFixed(1)}%
          </span>
        ))}
      </div>
    </section>
  );
}

function MessageRow({
  message,
  expanded,
  truncated,
  loadingFull,
  onCopy,
  onToggle,
  onLoadFull,
}: {
  message: AgentStateMessage;
  expanded: boolean;
  truncated: boolean;
  loadingFull: boolean;
  onCopy: () => Promise<void>;
  onToggle: () => void;
  onLoadFull: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await onCopy();
      setCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1_500);
    } catch (reason) {
      console.error("[state-viewer] copy message JSON failed:", reason);
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex h-10 items-center hover:bg-hover">
        <button className="flex h-full min-w-0 flex-1 items-center px-3 text-left" onClick={onToggle}>
          <span className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${roleDot(message.role)}`} />
          <span className="font-mono text-[13px] text-t-primary">{message.role}</span>
          <span className="mx-1 text-[12px] text-t-ghost">•</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-t-muted">{message.id}</span>
          <span className="ml-3 shrink-0 text-[12px] text-t-ghost">{formatDate(message.created_at)}</span>
          <ChevronDown size={14} className={`ml-2 shrink-0 text-t-ghost transition-transform ${expanded ? "" : "-rotate-90"}`} />
        </button>
        <button
          type="button"
          title="复制该消息 JSON"
          aria-label={`复制消息 ${message.id} JSON`}
          className="mr-2 rounded p-1.5 text-t-ghost hover:bg-black/[0.05] hover:text-t-primary dark:hover:bg-white/[0.06]"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border bg-[#fafafa] px-4 py-3 dark:bg-black/10">
          {truncated && (
            <div className="mb-2 flex items-center justify-between border-b border-border pb-2 text-[12px] text-t-muted">
              <span>超长字段已折叠</span>
              <button className="underline" disabled={loadingFull} onClick={onLoadFull}>
                {loadingFull ? "加载中…" : "加载完整消息"}
              </button>
            </div>
          )}
          <JsonPreview
            value={message}
            fileName={`${message.role}.${message.id}.json`}
          />
        </div>
      )}
    </div>
  );
}

function JsonPreview({ value, fileName = "state.json" }: { value: unknown; fileName?: string }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const lines = useMemo(() => text.split("\n"), [text]);
  const height = Math.min(560, Math.max(160, lines.length * 22 + 18));
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface" style={{ height }}>
      <CodeDiff
        oldValue=""
        newValue={text}
        language="json"
        fileName={fileName}
        viewMode="preview"
        theme="light"
        showToolbar={false}
        wrapLines
        style={{ height: "100%" }}
      />
    </div>
  );
}

function JsonDisclosure({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[12px]">
      <button className="inline-flex items-center gap-1 font-mono text-t-muted" onClick={() => setOpen(!open)}>
        <ChevronDown size={11} className={`transition-transform ${open ? "" : "-rotate-90"}`} /> {label}
      </button>
      {open && <div className="mt-2"><JsonPreview value={value} fileName={`${label}.json`} /></div>}
    </div>
  );
}

function roleDot(role: AgentStateMessage["role"]): string {
  if (role === "user") return "bg-emerald-600";
  if (role === "assistant") return "bg-orange-600";
  return "bg-zinc-500";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function ToolbarButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button title={title} onClick={onClick} className="rounded p-1.5 text-t-ghost hover:bg-hover hover:text-t-primary">{children}</button>;
}

function PageButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  return <button disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1 text-[12px] text-t-muted disabled:opacity-30">{children}</button>;
}

function CenteredSpinner() {
  return <div className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-t-ghost" /></div>;
}

function CenteredText({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 text-[14px] text-t-ghost">{children}</div>;
}
