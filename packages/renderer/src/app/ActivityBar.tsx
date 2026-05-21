import { MessageSquare, Zap, Clock, Settings } from "lucide-react";
import { useState } from "react";
import { useLayout } from "@/stores/layout";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export function ActivityBar() {
  const activeLeftPanel = useLayout((s) => s.activeLeftPanel);
  const setActiveLeftPanel = useLayout((s) => s.setActiveLeftPanel);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const items = [
    { id: "chat" as const, icon: MessageSquare, label: "对话" },
    { id: "skills" as const, icon: Zap, label: "专家" },
    { id: "cron" as const, icon: Clock, label: "定时" },
  ];

  return (
    <>
      <aside className="w-[72px] h-full bg-elevated border-r border-border flex flex-col items-center pt-6 pb-4 justify-between shrink-0">
        {/* Top */}
        <div className="flex flex-col items-center gap-5">
          {items.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveLeftPanel(id)}
              className={`flex flex-col items-center gap-1 w-full px-2 py-1.5 rounded-lg transition-colors ${
                activeLeftPanel === id
                  ? "text-t-primary"
                  : "text-t-dim hover:text-t-muted"
              }`}
            >
              <Icon size={24} strokeWidth={1.5} />
              <span className="text-[11px] leading-tight">{label}</span>
            </button>
          ))}
        </div>

        {/* Bottom */}
        <div className="flex flex-col items-center gap-5">
          <ThemeSwitcher />
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex flex-col items-center gap-1 w-full px-2 py-1.5 rounded-lg transition-colors text-t-dim hover:text-t-muted"
          >
            <Settings size={24} strokeWidth={1.5} />
            <span className="text-[11px] leading-tight">设置</span>
          </button>
        </div>
      </aside>

      {/* Settings Dialog */}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

// ─── Settings Dialog ────────────────────────────────────────────────

import { ModelSettings } from "@/features/settings/ModelSettings";
import { GatewaySettings } from "@/features/settings/GatewaySettings";
import { AgentDefSettings } from "@/features/settings/AgentDefSettings";
import { X } from "lucide-react";

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [activeSection, setActiveSection] = useState("general");

  const navSections = [
    { group: "账户", items: [
      { id: "account", label: "账户" },
      { id: "usage", label: "用量与计费" },
      { id: "personalization", label: "个性化" },
    ]},
    { group: "功能", items: [
      { id: "general", label: "通用" },
      { id: "models", label: "模型" },
      { id: "gateway", label: "网关连接" },
      { id: "agents", label: "Agent 设置" },
    ]},
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[900px] h-[640px] bg-surface border border-border rounded-xl shadow-2xl overflow-hidden flex">
        {/* Left Nav */}
        <nav className="w-[200px] border-r border-border flex flex-col py-5 shrink-0 overflow-y-auto">
          {navSections.map((section) => (
            <div key={section.group} className="mb-4">
              <div className="px-5 mb-2 text-[11px] uppercase tracking-wider text-t-ghost">{section.group}</div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-[calc(100%-16px)] mx-2 text-left px-3 py-2.5 text-[13px] rounded-md transition-colors ${
                    activeSection === item.id
                      ? "bg-hover text-t-primary"
                      : "text-t-secondary hover:bg-hover"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Right Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-end px-4 py-2 border-b border-border">
            <button onClick={onClose} className="p-1 rounded hover:bg-hover text-t-ghost hover:text-t-primary transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {activeSection === "models" && <ModelSettings />}
            {activeSection === "gateway" && <GatewaySettings />}
            {activeSection === "agents" && <AgentDefSettings />}
            {activeSection === "general" && <PlaceholderSection title="通用" description="通用设置（开发中）" />}
            {activeSection === "account" && <PlaceholderSection title="账户" description="账户管理（开发中）" />}
            {activeSection === "usage" && <PlaceholderSection title="用量与计费" description="用量统计（开发中）" />}
            {activeSection === "personalization" && <PlaceholderSection title="个性化" description="个性化设置（开发中）" />}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderSection({ title, description }: { title: string; description: string }) {
  return (
    <div className="text-center py-16">
      <h3 className="text-sm font-medium text-t-primary mb-2">{title}</h3>
      <p className="text-xs text-t-ghost">{description}</p>
    </div>
  );
}
