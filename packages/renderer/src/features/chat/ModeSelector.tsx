import { useState, useEffect, useRef, memo } from "react";
import { MessageSquare, ClipboardList } from "lucide-react";
import { useChat } from "@/stores/chat";

const modes = [
  { key: "chat" as const, label: "聊天", icon: MessageSquare },
  { key: "plan" as const, label: "计划", icon: ClipboardList },
];

export const ModeSelector = memo(function ModeSelector() {
  const mode = useChat((s) => s.mode);
  const setMode = useChat((s) => s.setMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = modes.find((m) => m.key === mode) || modes[0];
  const CurrentIcon = current.icon;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[13px] h-7 px-2.5 rounded-md font-mono transition-colors duration-150 text-t-muted hover:text-t-primary hover:bg-white/[0.05]"
      >
        <CurrentIcon size={13} className="shrink-0" strokeWidth={1.5} />
        <span className="leading-none">{current.label}</span>
        <svg width="6" height="4" viewBox="0 0 6 4" className="shrink-0 ml-0.5 opacity-60">
          <path d="M0.5 0.5L3 3.5L5.5 0.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 min-w-[120px] bg-elevated border border-border-subtle rounded-lg shadow-xl z-[100] overflow-hidden py-1"
          style={{ animation: "fadeIn 0.1s ease-out" }}
        >
          {modes.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => {
                  setMode(m.key);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-mono transition-colors duration-150 ${
                  isActive ? "text-neon bg-neon-ghost" : "text-t-primary hover:bg-white/[0.05]"
                }`}
              >
                <Icon size={13} />
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
