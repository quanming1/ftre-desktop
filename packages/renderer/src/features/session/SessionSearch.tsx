/**
 * 会话搜索 — 输入框 + 结果列表（纯展示组件）+ 防抖请求 hook。
 *
 * 状态由 useSessionSearch 提升持有，SessionPanel 把输入框放在段头位置、
 * 结果渲染在列表区通道内——搜索态直接顶替会话列表，视觉与 SessionRow 对齐。
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import {
  fetchSessionSearch,
  type SessionSearchResponse,
  type SessionSearchResult,
} from "@/services/api";
import { HighlightText } from "@/components/HighlightText";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 50;

// ─── 防抖 + 请求取消 ─────────────────────────────────────────

export function useSessionSearch() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SessionSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);

  const trimmed = query.trim();
  const active = trimmed.length > 0;

  useEffect(() => {
    // 查询变化时立即取消旧请求，而非等下一个 300ms 防抖窗口结束。
    abortRef.current?.abort();
    abortRef.current = null;
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    const requestVersion = ++requestVersionRef.current;
    if (!trimmed) {
      setResponse(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetchSessionSearch({
          q: trimmed, limit: PAGE_SIZE, offset: 0, signal: ctrl.signal,
        });
        if (ctrl.signal.aborted || requestVersion !== requestVersionRef.current) return;
        setResponse(res);
      } finally {
        if (!ctrl.signal.aborted && requestVersion === requestVersionRef.current) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  useEffect(() => () => {
    abortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
  }, []);

  const loadMore = useCallback(async () => {
    if (!response?.has_more || loadingMore) return;
    const offset = (response.offset ?? 0) + response.results.length;
    const ctrl = new AbortController();
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = ctrl;
    const requestVersion = requestVersionRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchSessionSearch({
        q: trimmed, limit: PAGE_SIZE, offset, signal: ctrl.signal,
      });
      if (!page || ctrl.signal.aborted || requestVersion !== requestVersionRef.current) return;
      setResponse((current) => {
        if (!current || current.query !== page.query) return current;
        return {
          ...page,
          offset: current.offset ?? 0,
          results: [...current.results, ...page.results],
        };
      });
    } finally {
      if (!ctrl.signal.aborted && requestVersion === requestVersionRef.current) {
        setLoadingMore(false);
      }
    }
  }, [loadingMore, response, trimmed]);

  /** 打开会话并清空搜索（open 由调用方传入，避免闭包顺序问题） */
  const openAndReset = useCallback((sid: string, open: (sid: string) => void) => {
    setQuery("");
    open(sid);
  }, []);

  return {
    query,
    setQuery,
    response,
    loading: loading || loadingMore,
    loadingMore,
    active,
    trimmed,
    loadMore,
    openAndReset,
  };
}

// ─── 输入框（透明融入面板背景，无独立边框盒子）────────────────

export const SessionSearchInput = memo(function SessionSearchInput({
  query,
  loading,
  onChange,
}: {
  query: string;
  loading: boolean;
  onChange: (q: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && query) {
        onChange("");
        inputRef.current?.blur();
      }
    },
    [query, onChange],
  );

  return (
    <div
      className="group flex h-8 items-center gap-2 rounded-lg px-3 transition-colors hover:bg-hover/60 focus-within:bg-hover/60"
      data-testid="session-search"
    >
      <Search size={13} className="shrink-0 text-t-ghost" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="搜索会话..."
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-t-primary outline-none placeholder:text-t-ghost"
      />
      {query && (
        <button
          type="button"
          title="清空 (Esc)"
          aria-label="清空搜索"
          onClick={() => onChange("")}
          className="shrink-0 rounded p-0.5 text-t-ghost transition-colors hover:text-t-primary"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
        </button>
      )}
    </div>
  );
});

// ─── 结果列表（渲染在会话列表通道内，行视觉对齐 SessionRow）──────

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  const d = new Date(t);
  const same_year = d.getFullYear() === new Date().getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return same_year ? `${mm}-${dd}` : `${d.getFullYear()}-${mm}-${dd}`;
}

function workspaceName(ws: string): string {
  if (!ws) return "";
  const norm = ws.replace(/\\/g, "/");
  return norm.split("/").filter(Boolean).pop() || norm;
}

const ResultRow = memo(function ResultRow({
  result,
  query,
  onOpen,
}: {
  result: SessionSearchResult;
  query: string;
  onOpen: (sid: string) => void;
}) {
  return (
    <div
      onClick={() => onOpen(result.session_id)}
      className="flex cursor-pointer select-none flex-col justify-center gap-[3px] rounded-lg px-3 py-2 transition-colors hover:bg-hover"
    >
      {/* 标题行：与 SessionRow 同字号色阶 */}
      <div className="flex min-w-0 items-center gap-1.5">
        {result.title_matched && (
          <span className="shrink-0 rounded bg-neon/15 px-1 py-px text-[10px] leading-4 text-neon">
            标题
          </span>
        )}
        <span className="truncate text-[13.5px] leading-snug text-t-secondary">
          {result.title ? <HighlightText text={result.title} query={query} /> : "（无标题）"}
        </span>
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-t-dim">
          {timeAgo(result.updated_at)}
        </span>
      </div>
      {/* 命中摘要：与 SessionRow preview 同色阶 */}
      {result.hits.map((h, i) => (
        <div key={h.mid + i} className="truncate text-[12px] leading-tight text-t-dim">
          <span className="mr-1 text-t-ghost/80">{h.role === "user" ? "用户" : "AI"}</span>
          <HighlightText text={h.snippet} query={query} />
        </div>
      ))}
      {/* workspace：极轻的定位信息 */}
      {workspaceName(result.workspace) && (
        <div className="truncate text-[11px] leading-tight text-t-ghost/70">
          {workspaceName(result.workspace)}
        </div>
      )}
    </div>
  );
});

export const SessionSearchResults = memo(function SessionSearchResults({
  query,
  response,
  loading,
  loadingMore = false,
  onLoadMore,
  onOpen,
}: {
  query: string;
  response: SessionSearchResponse | null;
  loading: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onOpen: (sid: string) => void;
}) {
  return (
    <div data-testid="session-search-results">
      {/* 段头样式：与会话组头一致 */}
      <div className="flex items-center justify-between px-3 pb-1 pt-0.5">
        <span className="text-[12px] font-medium text-t-ghost">
          {loading && !response ? "搜索中..." : response ? `${response.total} 个会话匹配` : ""}
        </span>
      </div>
      {!loading && (!response || response.total === 0) && (
        <div className="px-2 py-12 text-center text-[13px] text-t-ghost">
          无匹配会话
        </div>
      )}
      {response?.results.map((r) => (
        <ResultRow key={r.session_id} result={r} query={query} onOpen={onOpen} />
      ))}
      {response?.has_more && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mx-2 my-2 w-[calc(100%-1rem)] rounded-lg py-2 text-[12px] text-t-muted transition-colors hover:bg-hover disabled:cursor-wait"
        >
          {loadingMore ? "加载中..." : `显示更多（已显示 ${response.results.length}/${response.total}）`}
        </button>
      )}
    </div>
  );
});
