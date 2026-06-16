/**
 * SettingsDialog — 全局设置对话框
 *
 * 通过派发全局事件 `ftre:open-settings` 打开，detail.section 决定初始 tab：
 *   window.dispatchEvent(
 *     new CustomEvent("ftre:open-settings", { detail: { section: "models" } }),
 *   );
 *
 * 也可以通过 `<SettingsDialog open onClose />` 直接控制（SessionPanel 用这种方式
 * 在底部按钮上一键打开）。
 */
import { useState, useEffect, useCallback } from "react";
import { X, Sun, Moon, Monitor } from "lucide-react";
import { Modal } from "@/components/Modal";
import { ModelSettings } from "@/features/settings/ModelSettings";
import { GatewaySettings } from "@/features/settings/GatewaySettings";
import { AgentDefSettings } from "@/features/settings/AgentDefSettings";
import { McpSettings } from "@/features/settings/McpSettings";
import { useTheme, type ThemeMode } from "@/stores/theme";
import { OPEN_SETTINGS_EVENT, type SettingsSection } from "./settings-events";

export { OPEN_SETTINGS_EVENT, type SettingsSection };

interface SettingsDialogProps {
  /** 受控模式：传入 true 强制打开 */
  open?: boolean;
  /** 受控模式：关闭回调 */
  onClose?: () => void;
}

/**
 * 自管理的全局设置对话框：
 * - 不传 open/onClose：监听全局事件自管理 visibility
 * - 传 open + onClose：受控
 */
export function SettingsDialog(props: SettingsDialogProps = {}) {
  const controlled = props.open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [pendingSection, setPendingSection] =
    useState<SettingsSection | null>(null);

  const open = controlled ? props.open! : internalOpen;
  const handleClose = useCallback(() => {
    if (controlled) props.onClose?.();
    else setInternalOpen(false);
    setPendingSection(null);
  }, [controlled, props]);

  // 全局事件监听（仅在非受控模式下）
  useEffect(() => {
    if (controlled) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { section?: SettingsSection }
        | undefined;
      if (detail?.section) setPendingSection(detail.section);
      setInternalOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
  }, [controlled]);

  if (!open) return null;
  return (
    <SettingsDialogBody
      onClose={handleClose}
      initialSection={pendingSection}
    />
  );
}

function SettingsDialogBody({
  onClose,
  initialSection,
}: {
  onClose: () => void;
  initialSection?: SettingsSection | null;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    initialSection ?? "general",
  );

  useEffect(() => {
    if (initialSection) setActiveSection(initialSection);
  }, [initialSection]);

  const navSections = [
    {
      group: "功能",
      items: [
        { id: "general", label: "通用" },
        { id: "models", label: "模型" },
        { id: "gateway", label: "网关连接" },
        { id: "agents", label: "智能体" },
        { id: "mcp", label: "MCP 服务器" },
      ] satisfies { id: SettingsSection; label: string }[],
    },
  ];

  return (
    <Modal open onClose={onClose} title="设置" className="w-[900px]" width={900}>
      <div className="flex h-[640px] -m-6">
        {/* Left Nav */}
        <nav className="w-[200px] border-r border-border flex flex-col py-5 shrink-0 overflow-y-auto">
          {navSections.map((section) => (
            <div key={section.group} className="mb-4">
              <div className="px-5 mb-2 text-[11px] uppercase tracking-wider text-t-ghost">
                {section.group}
              </div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-[calc(100%-16px)] mx-2 text-left px-3 py-2.5 text-[13px] rounded-md transition-colors ${activeSection === item.id
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
          <div className="flex-1 overflow-y-auto p-6">
            {activeSection === "models" && <ModelSettings />}
            {activeSection === "gateway" && <GatewaySettings />}
            {activeSection === "agents" && <AgentDefSettings />}
            {activeSection === "general" && <GeneralSettings />}
            {activeSection === "mcp" && <McpSettings />}
          </div>
        </div>
      </div>
    </Modal>
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
                className={`flex flex-col items-center gap-2 p-2 rounded-xl border-2 transition-all ${selected
                  ? "border-accent ring-1 ring-accent/40"
                  : "border-transparent hover:border-border-subtle"
                  }`}
              >
                <ThemePreviewCard variant={value} />
                <div
                  className={`flex items-center gap-1.5 text-[12px] ${selected ? "text-t-primary" : "text-t-secondary"
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
        className={`absolute left-2 top-1.5 flex gap-1 ${half === "right" ? "opacity-0" : ""
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
