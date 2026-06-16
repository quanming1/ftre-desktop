/**
 * McpPopover — 标题栏 MCP 快捷面板
 *
 * 从标题栏 MCP 按钮下方弹出的紧凑面板：
 * - 显示当前 MCP 服务器列表及状态
 * - 快捷启禁用切换（无需打开设置页）
 * - 底部按钮跳转到完整 MCP 设置页
 * - 点击外部自动关闭
 *
 * 设计风格：与标题栏一体化的深色弹出层，neon 绿色状态指示
 */
import { useState, useEffect, useCallback } from "react";
import {
  Plug,
  Settings,
  Circle,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Wrench,
} from "lucide-react";
import {
  fetchMcpServers,
  updateMcpServer,
  type McpServerConfig,
} from "@/services/api";
import { OPEN_SETTINGS_EVENT } from "@/app/settings-events";
import { useLayout } from "@/stores/layout";

// ─── 主组件 ──────────────────────────────────────────────────

export function McpPopover() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchMcpServers();
      setServers(list);
      setError(null);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => { refresh(); }, [refresh]);

  const handleToggle = async (server: McpServerConfig) => {
    setToggling(server.name);
    try {
      await updateMcpServer(server.name, { disabled: !server.disabled });
      await refresh();
    } catch (e: any) {
      setError(e.message || "切换失败");
    } finally {
      setToggling(null);
    }
  };

  const openSettings = () => {
    useLayout.getState().setMcpPopoverOpen(false);
    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: "mcp" } }),
    );
  };

  // 统计信息
  const connectedCount = servers.filter(
    (s) => !s.disabled && s.status === "connected",
  ).length;
  const totalCount = servers.length;

  return (
    <div
      className="absolute top-full right-0 mt-1 w-[280px] bg-elevated border border-border-subtle rounded-xl shadow-2xl z-[70] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
    >
      {/* ── 头部：标题 + 刷新 ── */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Plug size={14} className="text-neon" strokeWidth={1.5} />
          <span className="text-[12px] text-t-primary font-medium">
            MCP 服务器
          </span>
          {totalCount > 0 && (
            <span className="text-[10px] text-t-ghost font-mono">
              {connectedCount}/{totalCount} 已连接
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 rounded-md text-t-ghost hover:text-t-secondary hover:bg-hover transition-colors"
          aria-label="刷新"
        >
          <RefreshCw
            size={12}
            className={loading ? "animate-spin" : ""}
            strokeWidth={1.5}
          />
        </button>
      </div>

      {/* ── 服务器列表 ── */}
      <div className="max-h-[280px] overflow-y-auto">
        {loading && servers.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-t-ghost text-[12px]">
            <RefreshCw size={12} className="animate-spin mr-2" />
            正在加载…
          </div>
        ) : error ? (
          <div className="px-3.5 py-4 text-[12px] text-[var(--ftre-status-error)] text-center">
            {error}
          </div>
        ) : servers.length === 0 ? (
          <EmptyPopoverContent onOpenSettings={openSettings} />
        ) : (
          <div className="py-1.5">
            {servers.map((server) => (
              <ServerRow
                key={server.name}
                server={server}
                toggling={toggling === server.name}
                onToggle={() => handleToggle(server)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 底部：设置按钮 ── */}
      {servers.length > 0 && (
        <div className="px-3.5 py-2 border-t border-border/40">
          <button
            onClick={openSettings}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-t-ghost hover:text-neon hover:bg-neon-ghost rounded-md transition-colors"
          >
            <Settings size={12} strokeWidth={1.5} />
            配置 MCP 服务器
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 服务器行 ──────────────────────────────────────────────────

function ServerRow({
  server,
  toggling,
  onToggle,
}: {
  server: McpServerConfig;
  toggling: boolean;
  onToggle: () => void;
}) {
  const isDisabled = server.disabled;
  const isConnected = server.status === "connected" && !isDisabled;
  const isDisconnected = !isConnected;

  return (
    <div className="flex items-center gap-2 px-3.5 py-2 hover:bg-hover/60 transition-colors group">
      {/* 状态圆点 */}
      <Circle
        size={8}
        fill={isConnected ? "var(--ftre-accent-default)" : "none"}
        stroke={isDisabled ? "var(--ftre-text-ghost)" : isDisconnected ? "var(--ftre-status-error)" : "var(--ftre-accent-default)"}
        strokeWidth={2}
        className="shrink-0"
      />

      {/* 名称 + 工具数 */}
      <div className="flex-1 min-w-0">
        <span
          className={`text-[12px] font-mono truncate ${
            isDisabled ? "text-t-ghost" : "text-t-primary"
          }`}
        >
          {server.name}
        </span>
        {isConnected && (
          <span className="text-[9px] text-t-ghost font-mono ml-1.5">
            <Wrench size={9} className="inline -mt-0.5 mr-0.5" strokeWidth={1.5} />
            可用
          </span>
        )}
      </div>

      {/* 启禁用切换 */}
      <button
        onClick={onToggle}
        disabled={toggling}
        className={`shrink-0 flex items-center transition-colors ${
          toggling
            ? "opacity-50 cursor-wait"
            : "opacity-0 group-hover:opacity-100 cursor-pointer"
        }`}
        aria-label={isDisabled ? "启用" : "禁用"}
        title={isDisabled ? "启用服务器" : "禁用服务器"}
      >
        {toggling ? (
          <RefreshCw size={13} className="animate-spin text-t-ghost" strokeWidth={1.5} />
        ) : isDisabled ? (
          <ToggleLeft size={13} className="text-t-ghost hover:text-t-secondary" strokeWidth={1.5} />
        ) : (
          <ToggleRight size={13} className="text-neon" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}

// ─── 空状态 ──────────────────────────────────────────────────

function EmptyPopoverContent({
  onOpenSettings,
}: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col items-center py-6 px-4 gap-3">
      {/* 菱形图标 */}
      <div className="w-8 h-8 rounded-lg bg-surface border border-border/40 flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" className="text-t-ghost">
          <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="10" y1="6" x2="10" y2="14" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
        </svg>
      </div>
      <span className="text-[11px] text-t-muted text-center">
        暂无 MCP 服务器
      </span>
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-neon hover:bg-neon-ghost rounded-md transition-colors"
      >
        <Settings size={12} strokeWidth={1.5} />
        配置服务器
      </button>
    </div>
  );
}