import { MessageSquare, Zap, Settings } from "lucide-react";
import { useLayout } from "@/stores/layout";

export function ActivityBar() {
  const activeLeftPanel = useLayout((s) => s.activeLeftPanel);
  const setActiveLeftPanel = useLayout((s) => s.setActiveLeftPanel);

  const items = [
    { id: "chat" as const, icon: MessageSquare, title: "会话" },
    { id: "skills" as const, icon: Zap, title: "技能" },
  ];

  return (
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
          onClick={() => setActiveLeftPanel("settings")}
          className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors ${
            activeLeftPanel === "settings"
              ? "text-t-primary bg-white/[0.06]"
              : "text-t-dim hover:bg-white/[0.04] hover:text-t-muted"
          }`}
          title="设置"
        >
          <Settings size={20} strokeWidth={1.5} />
        </button>
      </div>
    </aside>
  );
}
