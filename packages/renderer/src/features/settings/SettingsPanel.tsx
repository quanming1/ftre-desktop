/**
 * SettingsPanel - 设置面板组件
 */

import { useState } from "react";
import { Settings, Bot, ChevronRight, Cpu, Wifi } from "lucide-react";
import { AgentDefSettings } from "./AgentDefSettings";
import { ModelSettings } from "./ModelSettings";
import { GatewaySettings } from "./GatewaySettings";

type SettingsView = "home" | "agents" | "models" | "gateway";

interface SettingsCategoryProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  children?: React.ReactNode;
}

function SettingsCategory({
  icon,
  title,
  description,
  onClick,
  children,
}: SettingsCategoryProps) {
  const isClickable = !!onClick;
  return (
    <div
      className={`border border-border rounded-lg p-4 transition-colors ${
        isClickable
          ? "cursor-pointer hover:border-accent hover:bg-white/[0.02]"
          : "opacity-50 cursor-not-allowed"
      }`}
      onClick={isClickable ? onClick : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="text-t-muted mt-0.5">{icon}</div>
        <div className="flex-1">
          <h3 className="text-[14px] font-medium text-t-primary mb-1">
            {title}
          </h3>
          <p className="text-[13px] text-t-secondary">{description}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
        {isClickable && (
          <ChevronRight size={16} className="text-t-muted mt-0.5" />
        )}
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const [view, setView] = useState<SettingsView>("home");

  if (view === "agents") {
    return (
      <div className="h-full overflow-auto bg-surface">
        <div className="max-w-[800px] mx-auto p-8">
          <button
            onClick={() => setView("home")}
            className="flex items-center gap-2 text-[18px] text-t-muted hover:text-t-primary mb-6 transition-colors"
          >
            <Settings size={18} />
            <span>设置</span>
            <ChevronRight size={18} />
            <span className="text-t-primary font-medium">智能体</span>
          </button>

          <AgentDefSettings />
        </div>
      </div>
    );
  }

  if (view === "models") {
    return (
      <div className="h-full overflow-auto bg-surface">
        <div className="max-w-[800px] mx-auto p-8">
          <button
            onClick={() => setView("home")}
            className="flex items-center gap-2 text-[18px] text-t-muted hover:text-t-primary mb-6 transition-colors"
          >
            <Settings size={18} />
            <span>设置</span>
            <ChevronRight size={18} />
            <span className="text-t-primary font-medium">模型</span>
          </button>

          <ModelSettings />
        </div>
      </div>
    );
  }

  if (view === "gateway") {
    return (
      <div className="h-full overflow-auto bg-surface">
        <div className="max-w-[800px] mx-auto p-8">
          <button
            onClick={() => setView("home")}
            className="flex items-center gap-2 text-[18px] text-t-muted hover:text-t-primary mb-6 transition-colors"
          >
            <Settings size={18} />
            <span>设置</span>
            <ChevronRight size={18} />
            <span className="text-t-primary font-medium">网关</span>
          </button>

          <GatewaySettings />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-surface">
      <div className="max-w-[800px] mx-auto p-8">
        {/* 标题 */}
        <div className="flex items-center gap-3 mb-8">
          <Settings size={24} className="text-t-muted" />
          <div>
            <h1 className="text-[20px] font-semibold text-t-primary">设置</h1>
            <p className="text-[13px] text-t-secondary">
              配置你的 FTRE 使用体验
            </p>
          </div>
        </div>

        {/* 搜索（占位） */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="搜索设置..."
            className="w-full h-9 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-accent"
          />
        </div>

        {/* 分类 */}
        <div className="space-y-4">
          <SettingsCategory
            icon={<Bot size={18} />}
            title="智能体"
            description="配置跨工作区协作的 AI 智能体。"
            onClick={() => setView("agents")}
          />

          <SettingsCategory
            icon={<Cpu size={18} />}
            title="模型"
            description="配置 AI 提供商和模型设置。"
            onClick={() => setView("models")}
          />

          <SettingsCategory
            icon={<Wifi size={18} />}
            title="网关"
            description="配置 AI 后端（ai-base gateway）连接地址。"
            onClick={() => setView("gateway")}
          />
        </div>
      </div>
    </div>
  );
}
