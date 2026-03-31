import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { useOutput } from "@/stores/output";

export function OutputPanel() {
  const channels = useOutput((s) => s.channels);
  const activeChannel = useOutput((s) => s.activeChannel);
  const setActiveChannel = useOutput((s) => s.setActiveChannel);
  const clearChannel = useOutput((s) => s.clearChannel);

  const bottomRef = useRef<HTMLDivElement>(null);
  const current = channels.find((ch) => ch.name === activeChannel);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [current?.lines.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 h-8 border-b border-border shrink-0">
        <select
          value={activeChannel}
          onChange={(e) => setActiveChannel(e.target.value)}
          aria-label="输出通道"
          className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 text-t-default outline-none focus:border-accent"
        >
          {channels.map((ch) => (
            <option key={ch.name} value={ch.name}>
              {ch.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => clearChannel(activeChannel)}
          title="清除输出"
          aria-label="清除输出"
          className="p-1 text-t-ghost hover:text-t-muted rounded transition-colors"
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-auto px-3 py-1 font-mono text-xs leading-5 text-t-muted">
        {current && current.lines.length > 0 ? (
          current.lines.map((line, i) => <div key={i}>{line}</div>)
        ) : (
          <div className="text-t-ghost pt-2">暂无输出</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
