/**
 * SettingsPanel — 设置面板（右侧面板模式）
 *
 * 从 SettingsDialog 改造而来，去掉了 Modal 包裹，
 * 直接作为右侧面板渲染（与 Skills/Cron/Traces 同级切换）。
 */
import { useState, useEffect } from "react";
import { Sun, Moon, Monitor, ArrowLeft } from "lucide-react";
import { ModelSettings } from "@/features/settings/ModelSettings";
import { GatewaySettings } from "@/features/settings/GatewaySettings";
import { AgentDefSettings } from "@/features/settings/AgentDefSettings";
import { McpSettings } from "@/features/settings/McpSettings";
import { PromptSettings } from "@/features/settings/PromptSettings";
import { PerformanceSettings } from "@/features/settings/PerformanceSettings";
import { ShortcutsSettings } from "@/features/settings/ShortcutsSettings";
import { useTheme, type ThemeMode } from "@/stores/theme";
import { useLayout } from "@/stores/layout";
import type { SettingsSection } from "@/app/settings-events";

const navSections = [
  {
    group: "功能",
    items: [
      { id: "general", label: "通用" },
      { id: "models", label: "模型" },
      { id: "gateway", label: "网关连接" },
      { id: "agents", label: "智能体" },
      { id: "mcp", label: "MCP 服务器" },
      { id: "performance", label: "性能监控" },
    ] satisfies { id: SettingsSection; label: string }[],
  },
  {
    group: "快捷键",
    items: [
      { id: "shortcuts", label: "键盘快捷键" },
    ] satisfies { id: SettingsSection; label: string }[],
  },
];

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const setActiveLeftPanel = useLayout((s) => s.setActiveLeftPanel);

  return (
    <div className="settings-light-scope h-full flex bg-[#f6f7f9]">
      {/* Left Nav */}
      <nav className="w-[240px] flex flex-col py-5 shrink-0 overflow-y-auto bg-[#f6f7f9]">
        <div className="px-3 mb-3">
          <button
            onClick={() => setActiveLeftPanel("chat")}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[13px] font-medium text-t-secondary hover:text-t-primary hover:bg-hover transition-colors active:scale-[0.98]"
          >
            <ArrowLeft size={16} strokeWidth={1.8} />
            <span>返回</span>
          </button>
        </div>
        {navSections.map((section) => (
          <div key={section.group} className="mb-4">
            <div className="px-5 mb-2 text-[11px] uppercase tracking-wider text-t-ghost">
              {section.group}
            </div>
            {section.items.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-[calc(100%-16px)] mx-2 mb-1 text-left px-3 py-2.5 text-[13px] rounded-md transition-colors ${
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
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto w-full max-w-[800px]">
          {activeSection === "models" && <ModelSettings />}
          {activeSection === "gateway" && <GatewaySettings />}
          {activeSection === "agents" && <AgentDefSettings />}
          {activeSection === "general" && <GeneralSettings />}
          {activeSection === "mcp" && <McpSettings />}
          {activeSection === "performance" && <PerformanceSettings />}
          {activeSection === "shortcuts" && <ShortcutsSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── General Settings ───────────────────────────────────────────────

function GeneralSettings() {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);

  const options: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "浅色模式", icon: Sun },
    { value: "dark", label: "深色模式", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[16px] font-semibold text-t-primary mb-2">
          通用设置
        </h2>
      </div>

      <div>
        <label className="block text-[13px] font-medium text-t-primary mb-3">
          外观主题
        </label>
        <div className="grid grid-cols-3 gap-3">
          {options.map(({ value, label, icon: Icon }) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                onClick={() => setMode(value)}
                aria-pressed={selected}
                className={`flex flex-col items-center gap-2 p-2 rounded-xl border-2 transition-all ${
                  selected
                    ? "border-accent ring-1 ring-accent/40"
                    : "border-transparent hover:border-border-subtle"
                }`}
              >
                <ThemePreviewCard variant={value} />
                <div
                  className={`flex items-center gap-1.5 text-[12px] ${
                    selected ? "text-t-primary" : "text-t-secondary"
                  }`}
                >
                  <Icon size={13} strokeWidth={1.8} />
                  <span>{label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border-subtle pt-6">
        <PromptSettings />
      </div>
    </div>
  );
}

function ThemePreviewCard({ variant }: { variant: ThemeMode }) {
  if (variant === "system") {
    return (
      <div className="relative w-full aspect-[16/10] rounded-lg overflow-hidden border border-border-subtle">
        <div className="absolute inset-0 grid grid-cols-2">
          <ThemePreviewHalf scheme="light" half="left" />
          <ThemePreviewHalf scheme="dark" half="right" />
        </div>
      </div>
    );
  }
  return (
    <div className="w-full aspect-[16/10] rounded-lg overflow-hidden border border-border-subtle">
      <ThemePreviewHalf scheme={variant} half="full" />
    </div>
  );
}

function ThemePreviewHalf({
  scheme,
  half,
}: {
  scheme: "light" | "dark";
  half: "left" | "right" | "full";
}) {
  const isDark = scheme === "dark";
  const bg = isDark ? "bg-[#1f2125]" : "bg-white";
  const lineMain = isDark ? "bg-white/12" : "bg-black/8";
  const lineSub = isDark ? "bg-white/6" : "bg-black/4";
  const dotBg = isDark ? "bg-white/15" : "bg-black/10";

  return (
    <div className={`relative w-full h-full ${bg}`}>
      <div
        className={`absolute left-2 top-1.5 flex gap-1 ${
          half === "right" ? "opacity-0" : ""
        }`}
      >
        <div className={`w-1 h-1 rounded-full ${lineSub}`} />
        <div className={`w-1 h-1 rounded-full ${lineSub}`} />
        <div className={`w-1 h-1 rounded-full ${lineSub}`} />
      </div>
      <div className={`absolute left-3 right-3 top-4 h-1 rounded-full ${lineMain}`} />
      <div
        className={`absolute left-3 top-6 h-1 rounded-full ${lineSub}`}
        style={{ width: half === "full" ? "55%" : "70%" }}
      />
      <div className={`absolute right-2 bottom-1.5 w-3 h-1.5 rounded-full ${dotBg}`} />
    </div>
  );
}
