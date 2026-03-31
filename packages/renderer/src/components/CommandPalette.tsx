import { useState, useRef, useEffect, useMemo } from "react";
import { Search, X } from "lucide-react";
import { useShortcut, type ShortcutBinding } from "@/stores/shortcut";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Format a key binding string like "ctrl+shift+p" into a readable display
 * e.g. "Ctrl+Shift+P"
 */
function formatKeys(keys: string): string {
  return keys
    .split("+")
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join("+");
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const bindings = useShortcut((s) => s.bindings);

  // Filter commands by case-insensitive includes on the label
  const filtered = useMemo<ShortcutBinding[]>(() => {
    if (!query) return bindings;
    const q = query.toLowerCase();
    return bindings.filter((b) => b.label.toLowerCase().includes(q));
  }, [bindings, query]);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  const handleSelect = (binding: ShortcutBinding) => {
    binding.execute();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex]);
      }
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Palette */}
      <div className="fixed top-[12%] left-1/2 -translate-x-1/2 w-full max-w-lg bg-elevated border border-border-subtle rounded-xl shadow-2xl z-50 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={14} className="text-t-ghost shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入命令..."
            className="flex-1 bg-transparent text-[13px] text-white placeholder-t-ghost outline-none font-mono"
          />
          <button onClick={onClose} className="text-t-ghost hover:text-t-secondary transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.map((binding, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={binding.id}
                onClick={() => handleSelect(binding)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left transition-colors ${
                  isSelected ? "bg-neon-ghost" : "hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {binding.category && <span className="text-[11px] text-t-ghost font-mono shrink-0">{binding.category}:</span>}
                  <span className={`text-[13px] truncate font-mono ${isSelected ? "text-white" : "text-t-secondary"}`}>{binding.label}</span>
                </div>
                <span className="text-[12px] text-t-ghost font-mono shrink-0">{formatKeys(binding.keys)}</span>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-[12px] text-t-ghost font-mono">未找到命令</div>}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2.5 border-t border-border flex items-center gap-4 text-[11px] text-t-faint font-mono">
          <span>↑↓ 导航</span>
          <span>回车 执行</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </>
  );
}
