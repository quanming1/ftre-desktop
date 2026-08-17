/**
 * SessionSearch — 会话面板顶部的搜索框 + 结果列表。
 *
 * - 输入防抖 300ms 调 GET /sessions/search（后端 E1 内存态检索）；
 *   连续输入用 AbortController 取消旧请求，仅渲染最新结果。
 * - 结果：标题（命中高亮 + 「标题」角标）、命中摘要（最多 3 条，命中高亮）、
 *   workspace 名与更新时间；点击项切换会话并清空搜索。
 * - Esc 清空；清空后恢复原会话列表（onActiveChange 通知父级）。
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import {
  fetchSessionSearch,
  type SessionSearchResponse,
} from "@/services/api";
import { HighlightText } from "@/components/HighlightText";

const DEBOUNCE_MS = 300;

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return sameYear ? `${mm}-${dd} ${hh}:${mi}` : `${d.getFullYear()}-${mm}-${dd}`;
}

function workspaceName(ws: string): string {
  if (!ws) return "未设置工作区";
  const norm = ws.replace(/\\/g, "/");
  return norm.split("/").filter(Boolean).pop() || norm;
}

export const SessionSearch = memo(function SessionSearch({
  onOpenSession,
  onActiveChange,
}: {
  /** 点击结果项：切换到该会话 */
  onOpenSession: (sessionId: string) => void;
  /** 搜索模式开关通知（父级据此切换列表渲染） */
  onActiveChange: (active: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SessionSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = query.trim().length > 0;

  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      abortRef.current?.abort();
      abortRef.current = null;
      setResponse(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const res = await fetchSessionSearch({ q, signal: ctrl.signal });
      if (ctrl.signal.aborted) return; // 已被更新输入取消
      setResponse(res);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
    }
  }, []);

  const handleOpen = useCallback(
    (sessionId: string) => {
      setQuery("");
      onOpenSession(sessionId);
    },
    [onOpenSession],
  );

  return (
    <div className="shrink-0 px-2 pb-1" data-testid="session-search">
      {/* 输入框 */}
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-t-ghost"
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索会话内容..."
          spellCheck={false}
          className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-7 text-xs text-t-primary outline-none placeholder:text-t-ghost focus:border-t-primary"
        />
        {query && (
          <button
            type="button"
            title="清空 (Esc)"
            aria-label="清空搜索"
            onClick={() => setQuery("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-t-ghost hover:bg-hover hover:text-t-primary"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          </button>
        )}
      </div>

      {/* 搜索结果（替代父级会话列表渲染） */}
      {active && (
        <div
          className="mt-1 max-h-[60vh] overflow-y-auto scrollbar-thin rounded-md border border-border/60 bg-surface"
          data-testid="session-search-results"
        >
          {!loading && (!response || response.total === 0) && (
            <div className="px-3 py-8 text-center text-[12px] text-t-ghost">
              无匹配会话
            </div>
          )}
          {response && response.total > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[11px] text-t-ghost">
                {response.total} 个会话匹配
              </div>
              {response.results.map((r) => (
                <button
                  key={r.session_id}
                  type="button"
                  onClick={() => handleOpen(r.session_id)}
                  className="block w-full px-3 py-2 text-left transition-colors hover:bg-hover"
                >
                  <div className="flex items-center gap-1.5">
                    {r.title_matched && (
                      <span className="shrink-0 rounded-sm bg-emerald-100 px-1 text-[10px] leading-4 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        标题
                      </span>
                    )}
                    <span className="truncate text-[13px] font-medium text-t-primary">
                      {r.title ? <HighlightText text={r.title} query={query.trim()} /> : "（无标题）"}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-t-ghost">
                      {formatTime(r.updated_at)}
                    </span>
                  </div>
                  {r.hits.map((h, i) => (
                    <div
                      key={h.mid + i}
                      className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-t-muted"
                    >
                      <span className="mr-1 text-t-ghost">{h.role === "user" ? "用户" : "AI"}</span>
                      <HighlightText text={h.snippet} query={query.trim()} />
                    </div>
                  ))}
                  <div className="mt-1 truncate text-[10px] text-t-ghost">
                    {workspaceName(r.workspace)}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
});
