import { MessageSquare, Zap, Settings } from "lucide-react";
import { useState } from "react";
import { useLayout } from "@/stores/layout";

export function ActivityBar() {
  const activeLeftPanel = useLayout((s) => s.activeLeftPanel);
  const setActiveLeftPanel = useLayout((s) => s.setActiveLeftPanel);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const items = [
    { id: "chat" as const, icon: MessageSquare, title: "会话" },
    { id: "skills" as const, icon: Zap, title: "技能" },
  ];

  return (
    <>
      <aside className="w-[70px] h-full bg-surface border-r border-border flex flex-col items-center py-3 justify-between shrink-0">
        {/* Top */}
        <div className="flex flex-col items-center gap-1">
          {items.map(({ id, icon: Icon, title }) => (
            <button
              key={id}
              onClick={() => setActiveLeftPanel(id)}
              className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors ${
                activeLeftPanel === id
                  ? "text-t-primary bg-white/[0.06]"
                  : "text-t-dim hover:bg-white/[0.04] hover:text-t-muted"
              }`}
              title={title}
            >
              <Icon size={20} strokeWidth={1.5} />
            </button>
          ))}
        </div>

        {/* Bottom */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-11 h-11 rounded-lg flex items-center justify-center transition-colors text-t-dim hover:bg-white/[0.04] hover:text-t-muted"
            title="设置"
          >
            <Settings size={20} strokeWidth={1.5} />
          </button>
        </div>
      </aside>

      {/* Settings Dialog */}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

// ─── Settings Dialog ────────────────────────────────────────────────

import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { X } from "lucide-react";

function SettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Dialog */}
      <div className="relative w-[700px] max-h-[80vh] bg-surface border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-t-primary">设置</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-t-ghost hover:text-t-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SettingsPanel />
        </div>
      </div>
    </div>
  );
}
