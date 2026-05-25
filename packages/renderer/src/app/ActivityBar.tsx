import { MessageSquare, Zap, Clock, Settings } from "lucide-react";
import { useState, useEffect } from "react";
import { useLayout } from "@/stores/layout";

/**
 * 打开设置面板的全局事件名。
 * detail.section 可选: "general" | "models" | "gateway" | "agents"
 *
 * 任何地方都可以通过派发该事件来打开设置：
 *   window.dispatchEvent(
 *     new CustomEvent("ftre:open-settings", { detail: { section: "models" } }),
 *   );
 */
export const OPEN_SETTINGS_EVENT = "ftre:open-settings";

type SettingsSection = "general" | "models" | "gateway" | "agents";

export function ActivityBar() {
  const activeLeftPanel = useLayout((s) => s.activeLeftPanel);
  const setActiveLeftPanel = useLayout((s) => s.setActiveLeftPanel);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingSection, setPendingSection] =
    useState<SettingsSection | null>(null);

  // 监听全局事件：允许其他模块（如 ModelSelector）一键打开设置
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { section?: SettingsSection }
        | undefined;
      if (detail?.section) setPendingSection(detail.section);
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
  }, []);

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
      {settingsOpen && (
        <SettingsDialog
          initialSection={pendingSection}
          onClose={() => {
            setSettingsOpen(false);
            setPendingSection(null);
          }}
        />
      )}
    </>
  );
}

// ─── Settings Dialog ────────────────────────────────────────────────

import { ModelSettings } from "@/features/settings/ModelSettings";
import { GatewaySettings } from "@/features/settings/GatewaySettings";
import { AgentDefSettings } from "@/features/settings/AgentDefSettings";
import { X } from "lucide-react";

function SettingsDialog({
  onClose,
  initialSection,
}: {
  onClose: () => void;
  initialSection?: SettingsSection | null;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    initialSection ?? "general",
  );

  // 父组件在 dialog 已挂载时再次派发事件可切换 section
  useEffect(() => {
    if (initialSection) setActiveSection(initialSection);
  }, [initialSection]);

  const navSections = [
    { group: "功能", items: [
      { id: "general", label: "通用" },
      { id: "models", label: "模型" },
      { id: "gateway", label: "网关连接" },
      { id: "agents", label: "Agent 设置" },
    ] satisfies { id: SettingsSection; label: string }[] },
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
            {activeSection === "general" && <GeneralSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useTheme, type ThemeMode } from "@/stores/theme";
import { Sun, Moon, Monitor } from "lucide-react";

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
        <h2 className="text-[16px] font-semibold text-t-primary mb-2">通用设置</h2>
      </div>

      {/* 主题切换 */}
      <div>
        <label className="block text-[13px] font-medium text-t-primary mb-3">外观主题</label>
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
    </div>
  );
}

/** 主题预览卡片：浅色 / 深色 / 半色（跟随系统） */
function ThemePreviewCard({ variant }: { variant: ThemeMode }) {
  if (variant === "system") {
    // 半浅半深的拼接预览
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

/** 单边预览 */
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
      {/* 顶部三个伪装窗口控制点 */}
      <div className={`absolute left-2 top-1.5 flex gap-1 ${half === "right" ? "opacity-0" : ""}`}>
        <div className={`w-1 h-1 rounded-full ${lineSub}`} />
        <div className={`w-1 h-1 rounded-full ${lineSub}`} />
        <div className={`w-1 h-1 rounded-full ${lineSub}`} />
      </div>
      {/* 两条占位文字线 */}
      <div className={`absolute left-3 right-3 top-4 h-1 rounded-full ${lineMain}`} />
      <div
        className={`absolute left-3 top-6 h-1 rounded-full ${lineSub}`}
        style={{ width: half === "full" ? "55%" : "70%" }}
      />
      {/* 右下角圆形按钮 */}
      <div className={`absolute right-2 bottom-1.5 w-3 h-1.5 rounded-full ${dotBg}`} />
    </div>
  );
}
