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
  RefreshCw,
} from "lucide-react";
import {
  fetchMcpServers,
  updateMcpServer,
  type McpServerConfig,
} from "@/services/api";
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
      const list = await fetchMcpServers("all");
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
    const key = `${server.scope}-${server.name}`;
    setToggling(key);
    try {
      await updateMcpServer(server.name, { disabled: !server.disabled }, server.scope || "global");
      await refresh();
    } catch (e: any) {
      setError(e.message || "切换失败");
    } finally {
      setToggling(null);
    }
  };

  const openSettings = () => {
    useLayout.getState().setMcpPopoverOpen(false);
    useLayout.getState().setActiveLeftPanel("settings");
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
                key={`${server.scope}-${server.name}`}
                server={server}
                toggling={toggling === `${server.scope}-${server.name}`}
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
  const isDisconnected = !isConnected && !isDisabled;

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-hover/60 transition-colors">
      {/* 状态圆点 */}
      <Circle
        size={7}
        fill={isConnected ? "var(--ftre-accent-default)" : "none"}
        stroke={isDisabled ? "var(--ftre-text-ghost)" : isDisconnected ? "var(--ftre-status-error)" : "var(--ftre-accent-default)"}
        strokeWidth={2}
        className="shrink-0"
      />

      {/* 名称 */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span
          className={`text-[12px] font-mono truncate ${
            isDisabled ? "text-t-ghost" : "text-t-primary"
          }`}
        >
          {server.name}
        </span>
        {server.scope === "private" && (
          <span className="shrink-0 text-[9px] text-t-ghost/60 px-1 py-0.5 rounded bg-surface border border-border/30">
            私有
          </span>
        )}
      </div>

      {/* 开关 */}
      <button
        onClick={onToggle}
        disabled={toggling}
        className={`shrink-0 relative w-[36px] h-[20px] rounded-full transition-colors duration-200 ${
          toggling
            ? "bg-t-ghost/30 cursor-wait"
            : isDisabled
              ? "bg-t-ghost/20 cursor-pointer hover:bg-t-ghost/30"
              : "bg-neon/60 cursor-pointer hover:bg-neon/80"
        }`}
        aria-label={isDisabled ? "启用" : "禁用"}
        title={isDisabled ? "启用服务器" : "禁用服务器"}
      >
        {toggling ? (
          <RefreshCw size={10} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-t-ghost" strokeWidth={2} />
        ) : (
          <span
            className={`absolute top-[2px] w-[16px] h-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
              isDisabled ? "left-[2px]" : "left-[18px]"
            }`}
          />
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