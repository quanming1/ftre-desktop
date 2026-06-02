/**
 * WorkspaceBadge — 输入框工具栏左侧的"当前工作区"徽章 + 编辑器
 *
 * 数据源 / 写入位置取决于是否已有 session：
 * - 有 sessionId：sessions 表的 workspace 字段。读 useSession.sessions[current]，
 *   写 PUT /api/sessions/:id { workspace }，写完后局部刷新 store。
 * - 无 sessionId（欢迎页 / 刚 newChat）：useChat.pendingWorkspace（内存）。
 *   发出第一条消息创建 session 时通过 query param 一起带给后端，落到 DB。
 *
 * 首次挂载时，如果 pendingWorkspace 还没值，从 ~/.ftre/config.json 读
 * agents.defaults.workspace 作为预设值。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ExternalLink, Folder, FolderOpen } from "lucide-react";
import { Tooltip } from "@ftre/ui";
import { useSession } from "@/stores/session";
import { useChat, useSessionId } from "@/stores/chat";
import { useNotification } from "@/stores/notification";
import { fetchAppConfig, updateSession } from "@/services/api";

/** 取路径最后一段：D:\proj\src\ftre → ftre */
function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return path;
  return parts[parts.length - 1];
}

/** 弹出编辑器：输入框 + 选择目录按钮 + 保存 */
function WorkspaceEditor({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string;
  onSave: (value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const handlePick = useCallback(async () => {
    try {
      const result = await window.desktop?.fs?.selectFolder?.();
      if (result?.path) setValue(result.path);
    } catch {
      setError("无法打开目录选择器");
    }
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("路径不能为空");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(trimmed);
    } catch (e) {
      setError((e as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }, [value, onSave]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 w-[360px]">
      <div className="text-[11px] uppercase tracking-wider text-t-ghost">
        修改工作区
      </div>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder="输入绝对路径"
          spellCheck={false}
          className="flex-1 h-8 px-2 text-[13px] font-mono bg-base border border-border rounded-md text-t-primary placeholder:text-t-ghost outline-none focus:border-accent transition-colors"
        />
        <button
          type="button"
          onClick={handlePick}
          title="选择文件夹"
          aria-label="选择文件夹"
          className="h-8 w-8 flex items-center justify-center rounded-full text-t-secondary hover:text-t-primary hover:bg-hover transition-colors"
        >
          <FolderOpen size={14} />
        </button>
      </div>
      {error && (
        <div className="text-[11.5px] text-red-400/90">{error}</div>
      )}
      <div className="flex items-center justify-end gap-1.5 mt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-7 px-2.5 text-[12px] text-t-secondary rounded-md hover:bg-hover disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !value.trim()}
          className="h-7 px-3 text-[12px] rounded-md bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

export function WorkspaceBadge() {
  const sessionId = useSessionId();
  const sessions = useSession((s) => s.sessions);
  const allSessions = useSession((s) => s.allSessions);
  const pendingWorkspace = useChat((s) => s.pendingWorkspace);
  const setPendingWorkspace = useChat((s) => s.setPendingWorkspace);

  const sessionWorkspace = useMemo(() => {
    if (!sessionId) return "";
    const lookup = (arr: typeof sessions) =>
      arr.find((s) => s.session_id === sessionId)?.workspace || "";
    return lookup(sessions) || lookup(allSessions);
  }, [sessionId, sessions, allSessions]);

  // 当前生效路径：有 session 用 DB 字段，否则用 pending（内存）
  const workspace = sessionId ? sessionWorkspace : pendingWorkspace || "";

  // 首次挂载且 pendingWorkspace 还为空时，从 config 默认值预填
  useEffect(() => {
    if (sessionId || pendingWorkspace !== null) return;
    let cancelled = false;
    fetchAppConfig()
      .then((cfg) => {
        if (cancelled) return;
        const def = cfg?.agents?.defaults?.workspace;
        if (typeof def === "string" && def.trim()) {
          setPendingWorkspace(def);
        }
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, [sessionId, pendingWorkspace, setPendingWorkspace]);

  const [editing, setEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部 → 关闭编辑器
  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setEditing(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  const handleReveal = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!workspace) return;
      try {
        window.desktop?.fs?.revealInExplorer(workspace);
      } catch {
        useNotification.getState().addNotification({
          level: "error",
          message: "无法打开资源管理器",
        });
      }
    },
    [workspace],
  );

  const handleSave = useCallback(
    async (next: string) => {
      if (sessionId) {
        // 已有 session：写后端 + 局部刷 store
        const result = await updateSession(sessionId, { workspace: next });
        if (!result) throw new Error("保存失败");
        useSession.setState((s) => ({
          sessions: s.sessions.map((x) =>
            x.session_id === sessionId ? { ...x, workspace: next } : x,
          ),
          allSessions: s.allSessions.map((x) =>
            x.session_id === sessionId ? { ...x, workspace: next } : x,
          ),
        }));
      } else {
        // 还没 session：先存 pending，等发第一条消息时随 create 一起落库
        setPendingWorkspace(next);
      }
      setEditing(false);
    },
    [sessionId, setPendingWorkspace],
  );

  const hasWorkspace = !!workspace;
  const display = hasWorkspace ? basename(workspace) : "未设置工作区";

  const tooltip = hasWorkspace ? (
    <div className="flex flex-col gap-1 min-w-[200px]">
      <div className="text-[10.5px] uppercase tracking-wider text-t-ghost">
        当前工作区
      </div>
      <div className="font-mono text-[11.5px] text-t-secondary break-all leading-snug">
        {workspace}
      </div>
      <div className="text-[10.5px] text-t-ghost mt-1">
        {sessionId ? "点击修改" : "首条消息发出后会绑定到该会话"}
      </div>
    </div>
  ) : (
    <div className="text-[11.5px] text-t-secondary">点击设置工作区</div>
  );

  return (
    <div ref={containerRef} className="relative">
      <Tooltip content={tooltip} side="top">
        <div
          className={`group relative flex items-center h-8 rounded-full transition-colors ${
            editing ? "bg-[#e7e7e8]" : "hover:bg-[#e7e7e8]"
          }`}
        >
          <button
            type="button"
            onClick={() => setEditing((p) => !p)}
            className={`flex items-center gap-1 h-8 px-3 text-[13px] font-mono transition-colors ${
              hasWorkspace
                ? "text-t-secondary hover:text-t-primary"
                : "text-t-ghost hover:text-t-secondary"
            }`}
          >
            <Folder size={11} className="opacity-70" />
            <span className="truncate max-w-[140px]">{display}</span>
            <ChevronDown
              size={11}
              className={`opacity-50 transition-transform ${editing ? "rotate-180" : ""}`}
            />
          </button>

          {hasWorkspace && (
            <button
              type="button"
              onClick={handleReveal}
              title="在资源管理器中打开"
              aria-label="在资源管理器中打开"
              className="ml-0.5 mr-1 h-5 w-5 flex items-center justify-center rounded-full text-t-ghost opacity-0 group-hover:opacity-100 hover:text-t-primary hover:bg-elevated transition-all"
            >
              <ExternalLink size={11} />
            </button>
          )}
        </div>
      </Tooltip>

      {editing && (
        <div
          className="absolute bottom-full left-0 mb-1 bg-elevated border border-border-subtle rounded-xl shadow-2xl z-[100]"
          style={{ animation: "fadeIn 0.1s ease-out" }}
        >
          <WorkspaceEditor
            initialValue={workspace}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
