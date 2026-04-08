/**
 * SettingsPanel - 设置面板组件
 *
 * 参考 VSCode 的 SettingsEditor2，作为一种特殊的 EditorPane 渲染。
 * 当 OpenFile.type === 'settings' 时，EditorArea 会渲染此组件。
 */

import { Settings, Keyboard, Palette, Monitor, Code2 } from "lucide-react";

interface SettingsCategoryProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}

function SettingsCategory({ icon, title, description, children }: SettingsCategoryProps) {
  return (
    <div className="border border-border rounded-lg p-4 hover:border-border-subtle transition-colors">
      <div className="flex items-start gap-3">
        <div className="text-t-muted mt-0.5">{icon}</div>
        <div className="flex-1">
          <h3 className="text-[14px] font-medium text-t-primary mb-1">{title}</h3>
          <p className="text-[13px] text-t-secondary">{description}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  return (
    <div className="h-full overflow-auto bg-surface">
      <div className="max-w-[800px] mx-auto p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Settings size={24} className="text-t-muted" />
          <div>
            <h1 className="text-[20px] font-semibold text-t-primary">Settings</h1>
            <p className="text-[13px] text-t-secondary">Configure your ftre experience</p>
          </div>
        </div>

        {/* Search (placeholder) */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search settings..."
            className="w-full h-9 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-accent"
          />
        </div>

        {/* Categories */}
        <div className="space-y-4">
          <SettingsCategory
            icon={<Code2 size={18} />}
            title="Editor"
            description="Configure editor behavior, font size, tab settings, and more."
          />

          <SettingsCategory
            icon={<Palette size={18} />}
            title="Appearance"
            description="Customize colors, themes, and visual elements."
          />

          <SettingsCategory
            icon={<Keyboard size={18} />}
            title="Keyboard Shortcuts"
            description="View and customize keyboard shortcuts."
          />

          <SettingsCategory
            icon={<Monitor size={18} />}
            title="Window"
            description="Configure window behavior and layout preferences."
          />
        </div>

        {/* Coming soon notice */}
        <div className="mt-8 p-4 rounded-lg bg-elevated border border-border">
          <p className="text-[13px] text-t-secondary text-center">
            More settings coming soon. Currently, you can configure settings via the command palette.
          </p>
        </div>
      </div>
    </div>
  );
}
