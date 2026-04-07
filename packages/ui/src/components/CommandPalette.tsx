import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../utils/cn";

export interface CommandItem {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface CommandPaletteProps<T extends CommandItem> {
  open: boolean;
  onClose: () => void;
  items: T[];
  onSelect: (item: T) => void;
  placeholder?: string;
  emptyMessage?: string;
  /** Custom filter function */
  filterFn?: (item: T, query: string) => boolean;
  /** Custom render function for items */
  renderItem?: (item: T, isSelected: boolean) => ReactNode;
  className?: string;
}

function defaultFilter<T extends CommandItem>(item: T, query: string): boolean {
  const q = query.toLowerCase();
  return item.label.toLowerCase().includes(q);
}

function formatKeys(keys: string): string {
  return keys
    .split("+")
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join("+");
}

export function CommandPalette<T extends CommandItem>({
  open,
  onClose,
  items,
  onSelect,
  placeholder = "Type a command...",
  emptyMessage = "No commands found",
  filterFn = defaultFilter,
  renderItem,
  className,
}: CommandPaletteProps<T>) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo<T[]>(() => {
    if (!query) return items;
    return items.filter((item) => filterFn(item, query));
  }, [items, query, filterFn]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleSelect = (item: T) => {
    if (item.disabled) return;
    onSelect(item);
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
      if (filtered[selectedIndex] && !filtered[selectedIndex].disabled) {
        handleSelect(filtered[selectedIndex]);
      }
    }
  };

  const defaultRenderItem = (item: T, isSelected: boolean) => (
    <>
      <div className="flex items-center gap-2 min-w-0">
        {item.icon && <span className="shrink-0">{item.icon}</span>}
        {item.category && (
          <span className="text-[11px] text-[var(--ftre-text-ghost,#888e98)] font-mono shrink-0">
            {item.category}:
          </span>
        )}
        <span
          className={cn(
            "text-[13px] truncate",
            isSelected
              ? "text-[var(--ftre-text-primary,#e8e8e8)]"
              : "text-[var(--ftre-text-secondary,#cccccc)]",
          )}
        >
          {item.label}
        </span>
      </div>
      {item.shortcut && (
        <span className="text-[12px] text-[var(--ftre-text-ghost,#888e98)] font-mono shrink-0">
          {formatKeys(item.shortcut)}
        </span>
      )}
    </>
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={cn(
              "fixed top-[12%] left-1/2 -translate-x-1/2 w-full max-w-lg rounded-md border shadow-2xl z-50 overflow-hidden",
              "bg-[var(--ftre-elevated,#2d2d2d)] border-[var(--ftre-border,#3c3c3c)]",
              className,
            )}
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ftre-border,#3c3c3c)]">
              <Search
                size={14}
                className="text-[var(--ftre-text-ghost,#888e98)] shrink-0"
              />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="flex-1 bg-transparent text-[13px] text-[var(--ftre-text-primary,#e8e8e8)] placeholder-[var(--ftre-text-ghost,#888e98)] outline-none"
              />
              <button
                onClick={onClose}
                className="text-[var(--ftre-text-ghost,#888e98)] hover:text-[var(--ftre-text-secondary,#cccccc)] transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Command list */}
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
              {filtered.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    disabled={item.disabled}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-4 py-2 text-left transition-colors",
                      item.disabled && "opacity-50 cursor-not-allowed",
                      isSelected
                        ? "bg-[var(--ftre-accent-dim,rgba(0,255,136,0.12))]"
                        : "hover:bg-[var(--ftre-accent-ghost,rgba(0,255,136,0.06))]",
                    )}
                  >
                    {renderItem
                      ? renderItem(item, isSelected)
                      : defaultRenderItem(item, isSelected)}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-[var(--ftre-text-ghost,#888e98)]">
                  {emptyMessage}
                </div>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-[var(--ftre-border,#3c3c3c)] flex items-center gap-4 text-[11px] text-[var(--ftre-text-faint,#7a8088)]">
              <span>↑↓ Navigate</span>
              <span>Enter Select</span>
              <span>Esc Close</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
