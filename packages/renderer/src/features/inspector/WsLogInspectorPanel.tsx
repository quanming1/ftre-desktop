import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-react";
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

/**
 * WebSocket 审计日志面板：只保留当前页在 React 内存中，历史记录按 cursor 从主进程分页读取。
 * 这样消息再多也不会把整个日志文件加载到渲染进程或 Zustand。 
 */
export function WsLogInspectorPanel({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<WsLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<WsLogStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    if (!window.desktop?.wsLog || !window.confirm("清空全部 WebSocket 审计日志？")) return;
    await window.desktop.wsLog.clear();
    setEntries([]);
    setNextCursor(null);
    setStats(EMPTY_STATS);
  }, []);

  if (!window.desktop?.wsLog) {
    return <div className="h-full flex items-center justify-center text-xs text-t-muted">仅桌面版可用</div>;
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-surface text-t-secondary">
      <div className="shrink-0 border-b border-border px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-t-primary">WebSocket Logs</span>
          <span className="text-[10px] text-t-muted">{stats.entries.toLocaleString()} 条 · {formatBytes(stats.bytes)}</span>
          <span className="flex-1" />
          <button type="button" title="打开日志目录" className="p-1 rounded hover:bg-elevated" onClick={() => void window.desktop.wsLog.reveal()}>
            <ExternalLink size={13} />
          </button>
          <button type="button" title="刷新" className="p-1 rounded hover:bg-elevated" onClick={() => void load(false)} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button type="button" title="清空日志" className="p-1 rounded hover:bg-red-50 text-red-500" onClick={() => void clear()}>
            <Trash2 size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索原始帧 / request_id" className="min-w-0 flex-1 h-7 rounded border border-border bg-transparent px-2 text-[11px] outline-none focus:border-t-primary" />
          <select value={direction ?? ""} onChange={(event) => setDirection((event.target.value || undefined) as WsLogQuery["direction"])} className="h-7 rounded border border-border bg-transparent px-1 text-[11px]">
            <option value="">全部</option>
            <option value="out">发送</option>
            <option value="in">接收</option>
            <option value="system">系统</option>
          </select>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-2 py-1 font-mono text-[10px]">
        {entries.length === 0 && !loading && <div className="py-8 text-center text-t-muted">暂无日志</div>}
        {entries.map((entry) => {
          const expanded = expandedId === entry.id;
          return (
            <div key={entry.id} className="border-b border-border/60 last:border-b-0">
              <button type="button" className="w-full text-left py-1.5 grid grid-cols-[52px_34px_minmax(0,1fr)_70px] gap-1 items-center hover:bg-elevated/60" onClick={() => setExpandedId(expanded ? null : entry.id)}>
                <span className="text-t-muted">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span className={entry.direction === "in" ? "text-blue-600" : entry.direction === "out" ? "text-emerald-600" : "text-amber-600"}>{entry.direction === "in" ? "← in" : entry.direction === "out" ? "→ out" : "· sys"}</span>
                <span className="truncate text-t-primary">{entry.type || entry.eventType || "frame"}{entry.eventType && entry.type ? ` · ${entry.eventType}` : ""}</span>
                <span className="text-right text-t-muted">{formatBytes(entry.bytes)}</span>
              </button>
              <div className="px-1 pb-1 text-t-muted truncate">sid={short(entry.sessionId)} req={short(entry.requestId)} frame={short(entry.frameId)} {entry.attempt ? `· ${entry.attempt}` : ""}</div>
              {expanded && <pre className="mb-2 max-h-72 overflow-auto rounded bg-black/[0.03] p-2 text-[10px] leading-4 whitespace-pre-wrap break-all text-t-secondary">{prettyRaw(entry.raw)}</pre>}
            </div>
          );
        })}
        {nextCursor && <button type="button" className="w-full py-2 text-center text-[11px] text-t-muted hover:text-t-primary" onClick={() => void load(true, nextCursor)} disabled={loading}>加载更早日志</button>}
      </div>
      <div className="shrink-0 border-t border-border px-3 py-1 text-[10px] text-t-muted">目录：{stats.directory} · {stats.files} 个文件{stats.dropped ? ` · 丢弃 ${stats.dropped} 条` : ""}</div>
    </div>
  );
}
