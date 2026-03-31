import { useState, useCallback } from "react";
import { RefreshCw, ChevronRight, ChevronDown, Plug, Wrench } from "lucide-react";

interface MCPTool {
  name: string;
  description: string;
}

interface MCPServer {
  name: string;
  status: "connected" | "disconnected";
  tools: MCPTool[];
}

export function ExtensionsPanel() {
  const [servers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    // TODO: fetch from backend when MCP IPC API is available
    // e.g. const result = await window.desktop.mcp.servers();
    // setServers(result.servers ?? []);
    setTimeout(() => setLoading(false), 300);
  }, []);

  const toggleExpand = useCallback((serverName: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverName)) {
        next.delete(serverName);
      } else {
        next.add(serverName);
      }
      return next;
    });
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-[11px] text-t-secondary font-mono uppercase tracking-wider">扩展</span>
        <button onClick={refresh} className="text-t-muted hover:text-t-primary transition-colors" aria-label="刷新 MCP 服务器" disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto">
        {servers.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 px-4 gap-3">
            <Plug size={28} className="text-t-dim" />
            <span className="text-[11px] text-t-muted font-mono text-center">未配置 MCP 服务器</span>
            <span className="text-[10px] text-t-dim font-mono text-center leading-relaxed">
              配置项目设置后，MCP 服务器将显示在此处。
            </span>
          </div>
        )}

        {servers.map((server) => {
          const isExpanded = expandedServers.has(server.name);
          return (
            <div key={server.name}>
              {/* Server card */}
              <div className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.04] cursor-pointer" onClick={() => toggleExpand(server.name)}>
                {isExpanded ? (
                  <ChevronDown size={12} className="text-t-muted shrink-0" />
                ) : (
                  <ChevronRight size={12} className="text-t-muted shrink-0" />
                )}
                <Plug size={14} className="text-t-secondary shrink-0" />
                <span className="text-[11px] text-t-primary font-mono truncate flex-1">{server.name}</span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    server.status === "connected" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {server.status === "connected" ? "已连接" : "已断开"}
                </span>
                <span className="text-[9px] text-t-dim font-mono shrink-0">{server.tools.length} 个工具</span>
              </div>

              {/* Expanded tools list */}
              {isExpanded && server.tools.length > 0 && (
                <div className="border-b border-border/50">
                  {server.tools.map((tool) => (
                    <div key={tool.name} className="flex items-start gap-2 pl-9 pr-3 py-1.5 hover:bg-white/[0.02]">
                      <Wrench size={11} className="text-t-dim shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-[10px] text-t-secondary font-mono truncate">{tool.name}</div>
                        {tool.description && <div className="text-[9px] text-t-dim font-mono truncate">{tool.description}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isExpanded && server.tools.length === 0 && (
                <div className="pl-9 pr-3 py-1.5 border-b border-border/50">
                  <span className="text-[9px] text-t-dim font-mono">暂无可用工具</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
