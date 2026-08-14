import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CodeDiff } from "@jiang_quan_ming/react-code-diff";
import { Check, ChevronDown, Copy, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import type { WsLogEntry, WsLogPage, WsLogQuery, WsLogStats } from "@ftre/shared";

const EMPTY_STATS: WsLogStats = { directory: "~/.ftre/logs/ws", files: 0, bytes: 0, entries: 0, dropped: 0 };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function short(value: string | undefined, length = 12): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function prettyRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function dirDot(direction: WsLogEntry["direction"]): string {
  if (direction === "in") return "bg-blue-600";
  if (direction === "out") return "bg-emerald-600";
  return "bg-amber-600";
}

function dirTitle(direction: WsLogEntry["direction"]): string {
  if (direction === "in") return "接收";
  if (direction === "out") return "发送";
  return "系统";
}

function metaText(entry: WsLogEntry): string {
  const parts: string[] = [];
  if (entry.sessionId) parts.push(`sid ${short(entry.sessionId)}`);
  if (entry.requestId) parts.push(`req ${short(entry.requestId)}`);
  if (entry.frameId) parts.push(`frame ${short(entry.frameId)}`);
  if (entry.attempt) parts.push(entry.attempt);
  return parts.join(" · ");
}

/**
 * WebSocket 审计日志面板：只保留当前页在 React 内存中，历史记录按 cursor 从主进程分页读取。
 * 设计语言与 SessionStateRenderer（state.json 预览）统一：h-10 行 + 圆点 + mono 类型 + CodeDiff 预览。
 */
export function WsLogInspectorPanel({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<WsLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<WsLogStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<WsLogQuery["direction"]>();

  const query = useMemo<WsLogQuery>(() => ({
    limit: 100,
    search: search.trim() || undefined,
    direction,
  }), [direction, search]);

  const load = useCallback(async (append: boolean, cursor?: string | null) => {
    if (!window.desktop?.wsLog) return;
    setLoading(true);
    try {
      const page: WsLogPage = await window.desktop.wsLog.query({
        ...query,
        ...(append && cursor ? { cursor } : {}),
      });
      // 首页是最新一页；加载更早记录时放到前面，时间顺序始终保持从旧到新。
      setEntries((previous) => append ? [...page.entries, ...previous] : page.entries);
      setNextCursor(page.nextCursor);
      const nextStats = await window.desktop.wsLog.stats();
      setStats(nextStats);
    } catch (error) {
      console.warn("[ws-log] query failed", error);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!active) return;
    void load(false);
    const timer = window.setInterval(() => void load(false), 1_000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const clear = useCallback(async () => {
    if (!window.desktop?.wsLog) return;
    await window.desktop.wsLog.clear();
    setEntries([]);
    setNextCursor(null);
    setStats(EMPTY_STATS);
  }, []);

  /** 相邻且 (direction, type, eventType) 完全相同的日志折叠成一组。 */
  const groups = useMemo(() => {
    const result: { id: string; key: string; entries: WsLogEntry[] }[] = [];
    for (const entry of entries) {
      const key = `${entry.direction}|${entry.type ?? ""}|${entry.eventType ?? ""}`;
      const last = result[result.length - 1];
      if (last && last.key === key) {
        last.entries.push(entry);
      } else {
        result.push({ id: entry.id, key, entries: [entry] });
      }
    }
    return result;
  }, [entries]);

  const toggleGroup = useCallback((id: string) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copyRaw = useCallback(async (entry: WsLogEntry) => {
    try {
      await navigator.clipboard.writeText(entry.raw);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((current) => (current === entry.id ? null : current)), 1200);
    } catch (error) {
      console.warn("[ws-log] copy failed", error);
    }
  }, []);

  const renderEntry = (entry: WsLogEntry) => {
    const expanded = expandedId === entry.id;
    return (
      <LogRow
        key={entry.id}
        entry={entry}
        expanded={expanded}
        copied={copiedId === entry.id}
        onToggle={() => setExpandedId(expanded ? null : entry.id)}
        onCopy={() => void copyRaw(entry)}
        expandedContent={
          <div className="border-t border-border bg-[#fafafa] px-4 py-3 dark:bg-black/10">
            <RawPreview raw={entry.raw} fileName={`${entry.type || entry.eventType || "frame"}.json`} />
          </div>
        }
      />
    );
  };

  if (!window.desktop?.wsLog) {
    return <CenteredText>仅桌面版可用</CenteredText>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-t-primary">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
        <span className="text-[14px] font-medium">WebSocket Logs</span>
        <span className="ml-2 font-mono text-[12px] text-t-ghost">
          {stats.entries.toLocaleString()} 条 · {formatBytes(stats.bytes)}{stats.dropped ? ` · 丢弃 ${stats.dropped} 条` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton title="打开日志目录" onClick={() => void window.desktop.wsLog.reveal()}>
            <ExternalLink size={13} />
          </ToolbarButton>
          <ToolbarButton title="刷新" onClick={() => void load(false)}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </ToolbarButton>
          <ToolbarButton title="清空日志" onClick={() => void clear()}>
            <Trash2 size={13} />
          </ToolbarButton>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索原始帧 / request_id"
          className="min-w-0 flex-1 h-8 rounded-md border border-border bg-surface px-2 text-xs outline-none focus:border-t-primary"
        />
        <select
          value={direction ?? ""}
          onChange={(event) => setDirection((event.target.value || undefined) as WsLogQuery["direction"])}
          className="h-8 rounded-md border border-border bg-surface px-1 text-xs outline-none"
        >
          <option value="">全部</option>
          <option value="out">发送</option>
          <option value="in">接收</option>
          <option value="system">系统</option>
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 && !loading && <div className="py-12 text-center text-[13px] text-t-ghost">暂无日志</div>}
        {groups.map((group) => {
          if (group.entries.length === 1) return renderEntry(group.entries[0]);
          const first = group.entries[0];
          const expanded = expandedGroups.has(group.id);
          const totalBytes = group.entries.reduce((sum, entry) => sum + entry.bytes, 0);
          return (
            <LogRow
              key={group.id}
              entry={first}
              expanded={expanded}
              count={group.entries.length}
              bytes={totalBytes}
              onToggle={() => toggleGroup(group.id)}
              expandedContent={
                <div className="border-t border-border bg-[#fafafa] px-2 py-2 dark:bg-black/10">
                  {group.entries.map(renderEntry)}
                </div>
              }
            />
          );
        })}
        {nextCursor && <button type="button" className="w-full py-2 text-center text-xs text-t-muted hover:text-t-primary" onClick={() => void load(true, nextCursor)} disabled={loading}>加载更早日志</button>}
      </div>
    </div>
  );
}

function LogRow({
  entry,
  expanded,
  copied = false,
  count,
  bytes,
  onToggle,
  onCopy,
  expandedContent,
}: {
  entry: WsLogEntry;
  expanded: boolean;
  copied?: boolean;
  count?: number;
  bytes?: number;
  onToggle: () => void;
  onCopy?: () => void;
  expandedContent?: ReactNode;
}) {
  // type 与 data.type 相同时折叠重复，只显示一个。
  const label = entry.type || entry.eventType || "frame";
  const eventSuffix = entry.type && entry.eventType && entry.eventType !== entry.type ? ` · ${entry.eventType}` : "";
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex h-10 items-center hover:bg-hover">
        <button type="button" className="flex h-full min-w-0 flex-1 items-center px-3 text-left" onClick={onToggle}>
          <span className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dirDot(entry.direction)}`} title={dirTitle(entry.direction)} />
          <span className="truncate font-mono text-[13px] text-t-primary">{label}{eventSuffix}</span>
          {count !== undefined && count > 1 && (
            <span className="ml-2 shrink-0 rounded-full bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-t-muted">{count}</span>
          )}
          <span className="mx-2 text-[12px] text-t-ghost">•</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-t-muted">{metaText(entry)}</span>
          <span className="ml-3 shrink-0 font-mono text-[12px] text-t-ghost">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          <span className="ml-2 shrink-0 font-mono text-[12px] text-t-ghost">{formatBytes(bytes ?? entry.bytes)}</span>
          <ChevronDown size={14} className={`ml-2 shrink-0 text-t-ghost transition-transform ${expanded ? "" : "-rotate-90"}`} />
        </button>
        {onCopy && (
          <button
            type="button"
            title="复制原始帧"
            className="mr-2 rounded p-1.5 text-t-ghost hover:bg-black/[0.05] hover:text-t-primary dark:hover:bg-white/[0.06]"
            onClick={() => void onCopy()}
          >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          </button>
        )}
      </div>
      {expanded && expandedContent}
    </div>
  );
}

function RawPreview({ raw, fileName }: { raw: string; fileName: string }) {
  const text = useMemo(() => prettyRaw(raw), [raw]);
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

function ToolbarButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button title={title} onClick={onClick} className="rounded p-1.5 text-t-ghost hover:bg-hover hover:text-t-primary">{children}</button>;
}

function CenteredText({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 text-[14px] text-t-ghost">{children}</div>;
}
