import { useState } from "react";
import { Bot, Cpu, Wifi } from "lucide-react";
import { AgentDefSettings } from "./AgentDefSettings";
import { ModelSettings } from "./ModelSettings";
import { GatewaySettings } from "./GatewaySettings";
import { McpSettings } from "./McpSettings";
import { ChevronRight, Server } from "lucide-react";

type SettingsView = "home" | "agents" | "models" | "gateway" | "mcp";

export function SettingsPanel() {
  const [view, setView] = useState<SettingsView>("home");

  if (view !== "home") {
    const titles: Record<string, string> = {
      agents: "智能体",
      models: "模型",
      gateway: "网关",
      mcp: "MCP 服务器",
    };
    return (
      <div className="h-full overflow-auto bg-white">
        <div className="max-w-[800px] mx-auto p-8">
          <button
            onClick={() => setView("home")}
            className="flex items-center gap-1.5 text-[13px] text-black/40 hover:text-black mb-6 transition-colors active:scale-[0.96] transition-transform"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 3L4 8L4 10L6 10L11 5" /></svg>
            设置 / {titles[view]}
          </button>
          {view === "agents" && <AgentDefSettings />}
          {view === "models" && <ModelSettings />}
          {view === "gateway" && <GatewaySettings />}
          {view === "mcp" && <McpSettings />}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white">
      <div className="max-w-[800px] mx-auto p-8">
        <div className="mb-8">
          <h1 className="text-[15px] font-semibold text-black">设置</h1>
          <p className="text-[12px] text-black/40 mt-1">配置你的 FTRE 使用体验</p>
        </div>

        <div className="space-y-3">
          {[
            { icon: <Bot size={18} />, title: "智能体", desc: "跨工作区协作的 AI 智能体", view: "agents" as const },
            { icon: <Cpu size={18} />, title: "模型", desc: "AI 提供商和模型设置", view: "models" as const },
            { icon: <Server size={18} />, title: "MCP 服务器", desc: "连接外部工具服务器", view: "mcp" as const },
            { icon: <Wifi size={18} />, title: "网关", desc: "ftre gateway 连接地址", view: "gateway" as const },
          ].map(({ icon, title, desc, view: v }) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="flex w-full items-center gap-4 p-4 rounded-xl border border-black/[0.06] bg-white hover:border-black/[0.1] transition-colors text-left active:scale-[0.99]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/[0.03] text-black/50">
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-black">{title}</div>
                <div className="text-[12px] text-black/40 mt-0.5">{desc}</div>
              </div>
              <ChevronRight size={16} className="text-black/20" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}