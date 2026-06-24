/**
 * McpSettings — MCP 服务器管理
 *
 * 所有操作通过后端 API 热生效，无需重启网关。
 */
import { useState, useEffect, useCallback } from "react";
import {
  Trash2,
  Terminal,
  Globe,
  RefreshCw,
  Plus,
  X,
  AlertTriangle,
  Check,
  Info,
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

  if (loading && servers.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-black/30 text-[13px]">
        <RefreshCw size={14} className="animate-spin mr-2" />
        正在加载…
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => { setEditing(null); setError(null); }}
          className="group flex items-center gap-1.5 text-[13px] text-black/40 hover:text-black transition-colors active:scale-[0.96] transition-transform"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M9 3L4 8L4 10L6 10L11 5" />
          </svg>
          {editing._originalName ? `编辑 ${editing._originalName}` : "添加服务器"}
        </button>

        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] rounded-lg bg-red-50 text-red-600">
            <AlertTriangle size={13} />
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-black">MCP 服务器</h2>
        <p className="text-[12px] text-black/40 mt-1">
          连接外部工具服务器，扩展 Agent 可用工具集
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] rounded-lg bg-black/[0.02] border border-black/[0.06] text-black/60">
          <AlertTriangle size={13} className="text-black/40" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-black/30 hover:text-black/60 transition-colors active:scale-[0.96] transition-transform">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => setEditing({ ...EMPTY_LOCAL })}
          className="flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]"
        >
          <Plus size={14} />
          添加本地
        </button>
        <button
          onClick={() => setEditing({ ...EMPTY_REMOTE })}
          className="flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium bg-black/[0.04] text-black/70 hover:bg-black/[0.08] active:scale-[0.96] transition-[background-color,transform]"
        >
          <Plus size={14} />
          添加远程
        </button>
        <button
          onClick={refresh}
          className="ml-auto flex items-center gap-1.5 text-[12px] text-black/30 hover:text-black/60 active:scale-[0.96] transition-[color,transform]"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>

      {deleteConfirm && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-black/[0.02] border border-black/[0.06]">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-black/40" />
            <span className="text-[13px] text-black/70">
              确定删除 <strong className="font-semibold text-black">{deleteConfirm}</strong>？
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="px-3 py-1.5 text-[12px] font-medium rounded-lg text-black/50 hover:text-black hover:bg-black/[0.04] active:scale-[0.96] transition-[color,background-color,transform]"
            >
              取消
            </button>
            <button
              onClick={() => handleDelete(deleteConfirm)}
              className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]"
            >
              删除
            </button>
          </div>
        </div>
      )}

      {servers.length === 0 ? (
        <EmptyState
          onAddLocal={() => setEditing({ ...EMPTY_LOCAL })}
          onAddRemote={() => setEditing({ ...EMPTY_REMOTE })}
        />
      ) : (
        <div className="space-y-2">
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
    <div className="flex flex-col items-center justify-center py-12 rounded-2xl bg-black/[0.01] border border-dashed border-black/[0.06]">
      <div className="w-12 h-12 rounded-2xl bg-black/[0.03] flex items-center justify-center mb-4">
        <Terminal size={20} className="text-black/30" />
      </div>
      <p className="text-[13px] font-medium text-black/60 mb-1">暂无 MCP 服务器</p>
      <p className="text-[11px] text-black/30 mb-6">添加服务器以扩展 Agent 工具集</p>
      <div className="flex gap-2">
        <button onClick={onAddLocal} className="flex items-center gap-2 h-8 px-4 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]">
          <Terminal size={13} />本地
        </button>
        <button onClick={onAddRemote} className="flex items-center gap-2 h-8 px-4 rounded-full text-[13px] font-medium bg-black/[0.04] text-black/70 hover:bg-black/[0.08] active:scale-[0.96] transition-[background-color,transform]">
          <Globe size={13} />远程
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
  const isDisabled = !!server.disabled;
  const status = server.status;
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="rounded-xl border border-black/[0.06] bg-white hover:border-black/[0.1] transition-colors">
      <button
        onClick={onExpand}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:scale-[0.99] transition-transform"
      >
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.03]`}>
          {isLocal ? <Terminal size={15} className="text-black/50" /> : <Globe size={15} className="text-black/50" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-black truncate">{server.name}</span>
            <span className={`shrink-0 text-[10px] font-medium rounded px-1.5 py-0.5 ${isDisabled ? "bg-black/[0.04] text-black/40" : "bg-black/[0.04] text-black/60"}`}>
              {isDisabled ? "已禁用" : "启用"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-black/40">{isLocal ? "stdio" : "remote"}</span>
            {!isDisabled && (
              <>
                <span className="text-black/15">·</span>
                <span className="flex items-center gap-1 text-[11px] text-black/40">
                  <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-black/40" : isConnecting ? "bg-black/20 animate-pulse" : "bg-black/15"}`} />
                  {status || "未知"}
                </span>
              </>
            )}
          </div>
        </div>
        <svg
          className={`shrink-0 text-black/25 transition-transform ${expanded ? "rotate-180" : ""}`}
          width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
        >
          <path d="M3 5L6 8L9 5" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-black/[0.04] px-4 py-4 space-y-3">
          {isLocal ? (
            <DetailRow label="命令" value={(server.command || []).join(" ") || "—"} mono />
          ) : (
            <DetailRow label="URL" value={server.url || "—"} mono />
          )}
          <DetailRow label="超时" value={`${server.timeout || 30000}ms`} />
          <div className="flex gap-2 pt-1">
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-medium bg-black/[0.03] text-black/60 hover:bg-black/[0.06] hover:text-black active:scale-[0.96] transition-[background-color,color,transform]"
            >
              编辑
            </button>
            <button
              onClick={onToggle}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-medium bg-black/[0.03] text-black/60 hover:bg-black/[0.06] hover:text-black active:scale-[0.96] transition-[background-color,color,transform]"
            >
              {isDisabled ? "启用" : "禁用"}
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-medium text-black/40 hover:text-black hover:bg-black/[0.04] active:scale-[0.96] transition-[background-color,color,transform]"
            >
              <Trash2 size={12} />
              删除
            </button>
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
      <span className="shrink-0 w-14 text-black/35">{label}</span>
      <span className={`flex-1 text-black/60 whitespace-pre-wrap ${mono ? "font-mono text-[11px]" : ""}`}>
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

  const valid = data.name.trim() && (isLocal ? data.command?.length : data.url);

  return (
    <div className="space-y-5">
      <FormField label="服务器名称" hint="仅允许字母、数字、连字符和下划线">
        <input
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
          disabled={isEdit}
          placeholder="filesystem"
          className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white disabled:opacity-40 transition-all"
        />
      </FormField>

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
                className={`flex items-center gap-2 px-4 py-2.5 text-[12px] font-medium rounded-lg border transition-all active:scale-[0.96] ${
                  data.type === t
                    ? "border-black bg-black text-white"
                    : "border-black/[0.08] bg-white text-black/60 hover:border-black/[0.15]"
                }`}
              >
                {t === "local" ? <Terminal size={14} /> : <Globe size={14} />}
                {t === "local" ? "本地 stdio" : "远程 HTTP"}
              </button>
            ))}
          </div>
        </FormField>
      )}

      {isLocal && (
        <>
          <FormField label="启动命令" hint="空格分隔">
            <input
              value={commandStr}
              onChange={(e) => onChange({ ...data, command: e.target.value.split(/\s+/).filter(Boolean) })}
              placeholder="npx -y @mcp/server-fs /path"
              className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono transition-all"
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
              placeholder="API_KEY=xxx"
              className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[12px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono resize-y transition-all"
            />
          </FormField>
        </>
      )}

      {!isLocal && (
        <>
          <FormField label="服务器 URL">
            <input
              value={data.url || ""}
              onChange={(e) => onChange({ ...data, url: e.target.value })}
              placeholder="https://example.com/mcp"
              className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono transition-all"
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
              className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[12px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono resize-y transition-all"
            />
          </FormField>
        </>
      )}

      <div className="flex items-start gap-6">
        <FormField label="超时" className="w-32">
          <input
            type="number"
            value={data.timeout || 30000}
            onChange={(e) => onChange({ ...data, timeout: parseInt(e.target.value) || 30000 })}
            className="w-full h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black focus:outline-none focus:border-black/30 focus:bg-white tabular-nums transition-all"
          />
        </FormField>
        <div className="flex items-center gap-2 pt-7">
          <button
            onClick={() => onChange({ ...data, disabled: !data.disabled })}
            className={`flex items-center gap-1.5 text-[12px] text-black/50 hover:text-black transition-colors active:scale-[0.96] transition-transform`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
              data.disabled
                ? "border-black bg-black text-white"
                : "border-black/[0.15] bg-white"
            }`}>
              {data.disabled && <Check size={10} strokeWidth={2.5} />}
            </div>
            创建时禁用
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-black/[0.06]">
        <button
          onClick={onSave}
          disabled={!valid}
          className="h-9 px-5 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform] disabled:opacity-30 disabled:pointer-events-none"
        >
          保存
        </button>
        <button
          onClick={() => onChange(data)}
          className="text-[12px] text-black/35 hover:text-black/60 active:scale-[0.96] transition-[color,transform]"
        >
          重置
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
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[12px] font-semibold text-black/70">{label}</span>
        {hint && <span className="text-[10px] text-black/30">{hint}</span>}
      </div>
      {children}
    </div>
  );
}