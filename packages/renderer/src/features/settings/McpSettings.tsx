/**
 * McpSettings — MCP 服务器管理设置页
 *
 * 设计风格：服务器机架仪表板
 * - 清晰的信息层级：名称 → 类型 → 预览 → 状态
 * - 紧凑的卡片布局，展开后显示完整配置
 * - 状态用圆点而非标签（更简洁、更易扫描）
 * - 表单分段布局，不堆叠
 * - 删除带确认
 * - 空状态带引导性插图
 *
 * 所有操作通过后端 API 热生效，无需重启网关。
 */
import { useState, useEffect, useCallback } from "react";
import {
  Trash2,
  Terminal,
  Globe,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  Pencil,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Button } from "@ftre/ui";
import {
  fetchMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  type McpServerConfig,
} from "@/services/api";

// ─── Types ──────────────────────────────────────────────────────────

type ServerFormState = Omit<McpServerConfig, "status"> & {
  _originalName?: string;
};

const EMPTY_LOCAL: ServerFormState = {
  name: "",
  type: "local",
  command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
  environment: {},
  disabled: false,
  timeout: 30000,
};

const EMPTY_REMOTE: ServerFormState = {
  name: "",
  type: "remote",
  url: "",
  headers: {},
  disabled: false,
  timeout: 30000,
};

// ─── 主组件 ──────────────────────────────────────────────────────────

export function McpSettings() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ServerFormState | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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

  useEffect(() => { refresh(); }, [refresh]);

  const handleSave = async () => {
    if (!editing) return;
    setError(null);
    try {
      if (editing._originalName) {
        const { _originalName, ...patch } = editing;
        await updateMcpServer(_originalName, patch as any);
      } else {
        const { _originalName, ...data } = editing;
        await createMcpServer(data as any);
      }
      setEditing(null);
      await refresh();
    } catch (e: any) {
      setError(e.message || "保存失败");
    }
  };

  const handleToggle = async (server: McpServerConfig) => {
    setError(null);
    try {
      await updateMcpServer(server.name, { disabled: !server.disabled });
      await refresh();
    } catch (e: any) {
      setError(e.message || "切换失败");
    }
  };

  const handleDelete = async (name: string) => {
    setError(null);
    const result = await deleteMcpServer(name);
    if ("error" in result) {
      setError(result.error);
    } else {
      setDeleteConfirm(null);
      await refresh();
    }
  };

  // ─── 加载态 ───

  if (loading && servers.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-t-ghost text-[13px]">
        <RefreshCw size={14} className="animate-spin mr-2" />
        正在加载服务器列表…
      </div>
    );
  }

  // ─── 编辑态 ───

  if (editing) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setEditing(null); setError(null); }}
            className="flex items-center gap-1 text-[13px] text-t-dim hover:text-t-primary transition-colors"
          >
            <ChevronLeft size={14} />
            返回列表
          </button>
          <span className="text-t-ghost">·</span>
          <span className="text-[13px] text-t-secondary">
            {editing._originalName ? `编辑 ${editing._originalName}` : "添加服务器"}
          </span>
        </div>

        {error && (
          <div className="px-3 py-2 text-[12px] rounded-md bg-[var(--ftre-status-error)]/10 text-[var(--ftre-status-error)]">
            {error}
          </div>
        )}

        <McpServerForm
          data={editing}
          onChange={setEditing}
          onSave={handleSave}
        />
      </div>
    );
  }

  // ─── 列表态 ───

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[15px] font-medium text-t-primary">MCP 服务器</h2>
        <p className="text-[12px] text-t-ghost mt-1">
          连接外部工具服务器，扩展 Agent 可用工具集
        </p>
      </div>

      {error && (
        <div className="px-3 py-2 text-[12px] rounded-md bg-[var(--ftre-status-error)]/10 text-[var(--ftre-status-error)]">
          {error}
        </div>
      )}

      {/* 操作栏 */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setEditing({ ...EMPTY_LOCAL })}>
          <Terminal size={13} />
          本地
        </Button>
        <Button size="sm" onClick={() => setEditing({ ...EMPTY_REMOTE })}>
          <Globe size={13} />
          远程
        </Button>
        <button
          onClick={refresh}
          className="ml-auto flex items-center gap-1 text-[12px] text-t-ghost hover:text-t-secondary transition-colors"
        >
          <RefreshCw size={12} />
          刷新
        </button>
      </div>

      {/* 删除确认浮层 */}
      {deleteConfirm && (
        <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[var(--ftre-status-error)]/5 border border-[var(--ftre-status-error)]/20">
          <span className="text-[12px] text-[var(--ftre-status-error)]">
            确定删除 <strong>{deleteConfirm}</strong>？
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="text-[12px] text-t-secondary hover:text-t-primary transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => handleDelete(deleteConfirm)}
              className="text-[12px] text-[var(--ftre-status-error)] hover:text-[var(--ftre-status-danger)] font-medium transition-colors"
            >
              删除
            </button>
          </div>
        </div>
      )}

      {/* 服务器列表 */}
      {servers.length === 0 ? (
        <EmptyState onAddLocal={() => setEditing({ ...EMPTY_LOCAL })} onAddRemote={() => setEditing({ ...EMPTY_REMOTE })} />
      ) : (
        <div className="space-y-1.5">
          {servers.map((s) => (
            <McpServerCard
              key={s.name}
              server={s}
              expanded={expanded === s.name}
              onExpand={() => setExpanded(expanded === s.name ? null : s.name)}
              onEdit={() => setEditing({ ...s, _originalName: s.name })}
              onToggle={() => handleToggle(s)}
              onDelete={() => setDeleteConfirm(s.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 空状态 ──────────────────────────────────────────────────────────

function EmptyState({ onAddLocal, onAddRemote }: { onAddLocal: () => void; onAddRemote: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* MCP logo — 简单的菱形图标 */}
      <div className="w-10 h-10 rounded-lg bg-elevated border border-border flex items-center justify-center mb-4">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-t-ghost">
          <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="10" y1="6" x2="10" y2="14" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
        </svg>
      </div>
      <p className="text-[13px] text-t-secondary mb-1">暂无 MCP 服务器</p>
      <p className="text-[11px] text-t-ghost mb-4">
        添加服务器以扩展 Agent 工具集
      </p>
      <div className="flex gap-2">
        <button
          onClick={onAddLocal}
          className="flex items-center gap-1.5 px-3 py-2 text-[12px] rounded-md border border-border text-t-secondary hover:border-neon hover:text-neon transition-colors"
        >
          <Terminal size={12} />
          本地 (stdio)
        </button>
        <button
          onClick={onAddRemote}
          className="flex items-center gap-1.5 px-3 py-2 text-[12px] rounded-md border border-border text-t-secondary hover:border-neon hover:text-neon transition-colors"
        >
          <Globe size={12} />
          远程 (HTTP)
        </button>
      </div>
    </div>
  );
}

// ─── 服务器卡片 ──────────────────────────────────────────────────────────

function McpServerCard({
  server,
  expanded,
  onExpand,
  onEdit,
  onToggle,
  onDelete,
}: {
  server: McpServerConfig;
  expanded: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const isLocal = server.type === "local";
  const isDisabled = server.disabled;
  const isConnected = !isDisabled && server.status === "connected";

  // 状态颜色映射
  const statusColor = isDisabled
    ? "bg-t-faint"      // 灰色 — 禁用
    : isConnected
      ? "bg-neon"         // 绿色 — 已连接
      : "bg-[var(--ftre-status-warning)]"; // 黄色 — 未连接

  const statusLabel = isDisabled ? "禁用" : isConnected ? "已连接" : "未连接";

  // 命令/URL 预览
  const preview = isLocal
    ? (server.command || []).slice(0, 3).join(" ") + ((server.command?.length ?? 0) > 3 ? " ..." : "")
    : server.url || "";

  return (
    <div className={`group rounded-md border transition-colors ${
      isDisabled
        ? "border-border bg-elevated/30"
        : "border-border hover:border-border-subtle bg-surface"
    }`}>
      {/* 主行：名称 + 类型 + 预览 + 状态 + 操作 */}
      <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={onExpand}>
        {/* 类型图标 */}
        <div className={`shrink-0 w-7 h-7 rounded flex items-center justify-center ${
          isDisabled ? "bg-elevated" : "bg-elevated group-hover:bg-neon-dim"
        }`}>
          {isLocal
            ? <Terminal size={13} className={isDisabled ? "text-t-faint" : "text-t-ghost group-hover:text-neon"} />
            : <Globe size={13} className={isDisabled ? "text-t-faint" : "text-t-ghost group-hover:text-neon"} />
          }
        </div>

        {/* 名称 */}
        <span className={`text-[13px] truncate ${isDisabled ? "text-t-ghost" : "text-t-primary"}`}>
          {server.name}
        </span>

        {/* 预览 */}
        <span className="text-[11px] text-t-ghost truncate flex-1">
          {preview}
        </span>

        {/* 状态圆点 */}
        <div className="shrink-0 flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className={`text-[10px] ${isDisabled ? "text-t-faint" : "text-t-dim"}`}>
            {statusLabel}
          </span>
        </div>

        {/* 操作按钮 */}
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); onToggle(); }} title={isDisabled ? "启用" : "禁用"}
            className="p-1.5 rounded hover:bg-elevated text-t-ghost hover:text-t-secondary transition-colors">
            <ToggleLeft size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 rounded hover:bg-elevated text-t-ghost hover:text-neon transition-colors">
            <Pencil size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded hover:bg-elevated text-t-ghost hover:text-[var(--ftre-status-error)] transition-colors">
            <Trash2 size={13} />
          </button>
        </div>

        {/* 展开箭头 */}
        <ChevronDown size={12} className={`shrink-0 text-t-faint transition-transform ${expanded ? "rotate-180" : ""}`} />
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
          {isLocal ? (
            <>
              <DetailRow label="命令" value={(server.command || []).join(" ")} mono />
              <DetailRow label="环境变量" value={
                Object.entries(server.environment || {}).map(([k, v]) => `${k}=${v}`).join("\n") || "无"
              } mono />
            </>
          ) : (
            <>
              <DetailRow label="URL" value={server.url || "—"} mono />
              <DetailRow label="请求头" value={
                Object.entries(server.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n") || "无"
              } mono />
            </>
          )}
          <DetailRow label="超时" value={`${server.timeout || 30000}ms`} />
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil size={12} />
              编辑配置
            </Button>
            <Button size="sm" variant="ghost" onClick={onToggle}>
              {isDisabled ? "启用" : "禁用"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 详情行 ──────────────────────────────────────────────────────────

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-4 text-[12px]">
      <span className="shrink-0 w-16 text-t-ghost">{label}</span>
      <span className={`flex-1 text-t-secondary whitespace-pre-wrap ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

// ─── 表单 ──────────────────────────────────────────────────────────

function McpServerForm({
  data,
  onChange,
  onSave,
}: {
  data: ServerFormState;
  onChange: (d: ServerFormState) => void;
  onSave: () => void;
}) {
  const isLocal = data.type === "local";
  const isEdit = !!data._originalName;

  const commandStr = (data.command || []).join(" ");
  const envStr = Object.entries(data.environment || {})
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const headersStr = Object.entries(data.headers || {})
    .map(([k, v]) => `${k}: ${v}`).join("\n");

  return (
    <div className="space-y-5">
      {/* 名称 */}
      <FormField label="服务器名称" hint="仅允许字母、数字、连字符和下划线">
        <input
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
          disabled={isEdit}
          placeholder="filesystem"
          className="w-full h-9 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon disabled:opacity-40 transition-colors"
        />
      </FormField>

      {/* 类型切换（仅新建时） */}
      {!isEdit && (
        <FormField label="连接类型">
          <div className="flex gap-2">
            {(["local", "remote"] as const).map((t) => (
              <button
                key={t}
                onClick={() => onChange({
                  ...(t === "local" ? EMPTY_LOCAL : EMPTY_REMOTE),
                  name: data.name,
                })}
                className={`flex items-center gap-2 px-4 py-2.5 text-[12px] rounded-md border transition-all ${
                  data.type === t
                    ? "border-neon text-neon bg-neon-ghost"
                    : "border-border text-t-secondary hover:border-border-subtle"
                }`}
              >
                {t === "local" ? <Terminal size={14} /> : <Globe size={14} />}
                {t === "local" ? "本地 stdio" : "远程 HTTP"}
              </button>
            ))}
          </div>
        </FormField>
      )}

      {/* Local 字段 */}
      {isLocal && (
        <>
          <FormField label="启动命令" hint="空格分隔，如 npx -y @mcp/server-fs /path">
            <input
              value={commandStr}
              onChange={(e) => onChange({ ...data, command: e.target.value.split(/\s+/).filter(Boolean) })}
              placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
              className="w-full h-9 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon font-mono transition-colors"
            />
          </FormField>
          <FormField label="环境变量" hint="每行 KEY=VALUE">
            <textarea
              value={envStr}
              onChange={(e) => {
                const env: Record<string, string> = {};
                for (const line of e.target.value.split("\n")) {
                  const eq = line.indexOf("=");
                  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
                }
                onChange({ ...data, environment: env });
              }}
              rows={3}
              placeholder="API_KEY=xxx&#10;DEBUG=true"
              className="w-full px-3 py-2 rounded-md bg-elevated border border-border text-[12px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon font-mono resize-y transition-colors"
            />
          </FormField>
        </>
      )}

      {/* Remote 字段 */}
      {!isLocal && (
        <>
          <FormField label="服务器 URL">
            <input
              value={data.url || ""}
              onChange={(e) => onChange({ ...data, url: e.target.value })}
              placeholder="https://example.com/mcp"
              className="w-full h-9 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon font-mono transition-colors"
            />
          </FormField>
          <FormField label="请求头" hint="每行 Key: Value">
            <textarea
              value={headersStr}
              onChange={(e) => {
                const hdrs: Record<string, string> = {};
                for (const line of e.target.value.split("\n")) {
                  const colon = line.indexOf(":");
                  if (colon > 0) hdrs[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
                }
                onChange({ ...data, headers: hdrs });
              }}
              rows={3}
              placeholder="Authorization: Bearer xxx"
              className="w-full px-3 py-2 rounded-md bg-elevated border border-border text-[12px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-neon font-mono resize-y transition-colors"
            />
          </FormField>
        </>
      )}

      {/* 通用字段 */}
      <div className="flex items-start gap-6">
        <FormField label="超时" className="w-28">
          <input
            type="number"
            value={data.timeout || 30000}
            onChange={(e) => onChange({ ...data, timeout: parseInt(e.target.value) || 30000 })}
            className="w-full h-9 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary focus:outline-none focus:border-neon transition-colors"
          />
        </FormField>
        <div className="flex items-center gap-2 pt-7">
          <button
            onClick={() => onChange({ ...data, disabled: !data.disabled })}
            className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-colors ${
              data.disabled
                ? "border-neon bg-neon text-[var(--ftre-bg-base)]"
                : "border-border bg-elevated"
            }`}
          >
            {data.disabled && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4L3 6L7 2" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>}
          </button>
          <span className="text-[12px] text-t-secondary">创建时禁用</span>
        </div>
      </div>

      {/* 保存 */}
      <div className="flex items-center gap-3 pt-2 border-t border-border/50">
        <Button onClick={onSave} disabled={!data.name.trim() || (isLocal && !data.command?.length) || (!isLocal && !data.url)}>
          保存
        </Button>
        <button
          onClick={() => { onChange(data); }}
          className="text-[12px] text-t-ghost hover:text-t-secondary transition-colors"
        >
          重置表单
        </button>
      </div>
    </div>
  );
}

// ─── 表单字段容器 ──────────────────────────────────────────────────────────

function FormField({ label, hint, children, className }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[12px] font-medium text-t-primary">{label}</span>
        {hint && <span className="text-[10px] text-t-ghost">{hint}</span>}
      </div>
      {children}
    </div>
  );
}