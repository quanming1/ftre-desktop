import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { adjustMenuPosition } from "./menu-position";

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: LucideIcon;
  separator?: boolean;
  disabled?: boolean;
  action: () => void;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Returns indices of items that are focusable (not separator, not disabled).
 */
function getFocusableIndices(items: ContextMenuItem[]): number[] {
  return items.reduce<number[]>((acc, item, i) => {
    if (!item.separator && !item.disabled) acc.push(i);
    return acc;
  }, []);
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);

  const focusable = getFocusableIndices(items);

  // Adjust menu position to stay within viewport bounds
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const adjusted = adjustMenuPosition(
      position,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setAdjustedPosition(adjusted);
  }, [position]);

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Close on Escape + keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const currentPos = focusable.indexOf(prev);
          const nextPos = currentPos < focusable.length - 1 ? currentPos + 1 : 0;
          return focusable[nextPos] ?? -1;
        });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const currentPos = focusable.indexOf(prev);
          const nextPos = currentPos > 0 ? currentPos - 1 : focusable.length - 1;
          return focusable[nextPos] ?? -1;
        });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (focusedIndex >= 0 && items[focusedIndex] && !items[focusedIndex].separator && !items[focusedIndex].disabled) {
          items[focusedIndex].action();
          onClose();
        }
      }
    },
    [focusable, focusedIndex, items, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Focus the menu on mount so keyboard events work
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.separator || item.disabled) return;
    item.action();
    onClose();
  };

  return createPortal(
    <motion.div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      initial={{ opacity: 0, scale: 0.95, y: -5 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className="fixed z-[9999] min-w-[200px] bg-elevated border border-border-subtle rounded-lg shadow-2xl py-1.5 outline-none"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={item.id} role="separator" className="my-1 border-t border-border" />;
        }

        const isFocused = index === focusedIndex;
        const Icon = item.icon;

        return (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => handleItemClick(item)}
            onMouseEnter={() => {
              if (!item.disabled) setFocusedIndex(index);
            }}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] font-mono transition-colors duration-150 ${
              item.disabled
                ? "text-t-faint cursor-not-allowed opacity-50"
                : isFocused
                  ? "bg-neon-ghost text-white"
                  : "text-t-secondary hover:bg-white/[0.04]"
            }`}
          >
            <span className="w-4.5 h-4.5 flex items-center justify-center shrink-0">{Icon && <Icon size={15} />}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="text-[12px] text-t-ghost ml-4 shrink-0">{item.shortcut}</span>}
          </button>
        );
      })}
    </motion.div>,
    document.body,
  );
}
