import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { adjustMenuPosition } from "../utils/menu-position";
import { cn } from "../utils/cn";

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: LucideIcon;
  separator?: boolean;
  disabled?: boolean;
  /** 'primary' 绿色高亮按钮, 'danger' 红色危险操作, 'default' 普通样式 */
  variant?: "default" | "primary" | "danger";
  action: () => void;
}

export type ContextMenuSize = "sm" | "md";

export interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
  className?: string;
  size?: ContextMenuSize;
}

function getFocusableIndices(items: ContextMenuItem[]): number[] {
  return items.reduce<number[]>((acc, item, i) => {
    if (!item.separator && !item.disabled) acc.push(i);
    return acc;
  }, []);
}

export function ContextMenu({
  items,
  position,
  onClose,
  className,
  size = "md",
}: ContextMenuProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);

  const focusable = getFocusableIndices(items);

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

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

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
          const nextPos =
            currentPos < focusable.length - 1 ? currentPos + 1 : 0;
          return focusable[nextPos] ?? -1;
        });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const currentPos = focusable.indexOf(prev);
          const nextPos =
            currentPos > 0 ? currentPos - 1 : focusable.length - 1;
          return focusable[nextPos] ?? -1;
        });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (
          focusedIndex >= 0 &&
          items[focusedIndex] &&
          !items[focusedIndex].separator &&
          !items[focusedIndex].disabled
        ) {
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
      initial={{ opacity: 0, scale: 0.92, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "fixed z-[9999] rounded-lg shadow-xl outline-none",
        size === "sm" ? "min-w-[120px] py-1" : "min-w-[160px] py-1.5",
        "bg-[var(--ftre-elevated,#2d2d2d)] border border-[var(--ftre-border,#3c3c3c)]/50",
        "backdrop-blur-xl",
        className,
      )}
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return (
            <div
              key={item.id}
              role="separator"
              className="my-1.5 mx-3 border-t border-[var(--ftre-border,#3c3c3c)]/60"
            />
          );
        }

        const isFocused = index === focusedIndex;
        const Icon = item.icon;
        const variant = item.variant ?? "default";

        // Primary 样式 (微信绿色高亮按钮)
        if (variant === "primary") {
          return (
            <div key={item.id} className={size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1"}>
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => {
                  if (!item.disabled) setFocusedIndex(index);
                }}
                className={cn(
                  "w-full flex items-center justify-center gap-2 font-medium rounded-md transition-all duration-150",
                  size === "sm" ? "px-3 py-1.5 text-[12px]" : "px-4 py-2 text-[13px]",
                  item.disabled
                    ? "bg-[var(--ftre-accent,#00ff88)]/30 text-white/50 cursor-not-allowed"
                    : isFocused
                      ? "bg-[var(--ftre-accent,#00ff88)] text-[#1a1a1a] shadow-lg shadow-[var(--ftre-accent,#00ff88)]/25 scale-[1.02]"
                      : "bg-[var(--ftre-accent,#00ff88)] text-[#1a1a1a] hover:shadow-lg hover:shadow-[var(--ftre-accent,#00ff88)]/25",
                )}
              >
                {Icon && <Icon size={16} strokeWidth={2.5} />}
                <span>{item.label}</span>
              </button>
            </div>
          );
        }

        // Danger 样式 (红色删除按钮)
        if (variant === "danger") {
          return (
            <div key={item.id} className={size === "sm" ? "px-1" : "px-1.5"}>
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => {
                  if (!item.disabled) setFocusedIndex(index);
                }}
                className={cn(
                  "w-full flex items-center gap-3 text-left rounded-md transition-colors duration-150",
                  size === "sm" ? "px-2.5 py-1.5 text-[12px]" : "px-3 py-2 text-[13px]",
                  item.disabled
                    ? "text-red-400/40 cursor-not-allowed"
                    : isFocused
                      ? "bg-red-500/15 text-red-400"
                      : "text-red-400/80 hover:bg-red-500/10 hover:text-red-400",
                )}
              >
                <span className="w-5 h-5 flex items-center justify-center shrink-0">
                  {Icon && <Icon size={16} />}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <span className="text-[11px] text-red-400/50 font-mono ml-3 shrink-0">
                    {item.shortcut}
                  </span>
                )}
              </button>
            </div>
          );
        }

        // Default 样式
        return (
          <div key={item.id} className={size === "sm" ? "px-1" : "px-1.5"}>
            <button
              role="menuitem"
              disabled={item.disabled}
              onClick={() => handleItemClick(item)}
              onMouseEnter={() => {
                if (!item.disabled) setFocusedIndex(index);
              }}
              className={cn(
                "w-full flex items-center gap-3 text-left rounded-md transition-colors duration-150",
                size === "sm" ? "px-2.5 py-1.5 text-[12px]" : "px-3 py-2 text-[13px]",
                item.disabled
                  ? "text-[var(--ftre-text-faint,#7a8088)] cursor-not-allowed opacity-40"
                  : isFocused
                    ? "bg-[var(--ftre-accent,#00ff88)]/10 text-[var(--ftre-text-primary,#e8e8e8)]"
                    : "text-[var(--ftre-text-secondary,#b0b0b0)] hover:bg-[var(--ftre-accent,#00ff88)]/5 hover:text-[var(--ftre-text-primary,#e8e8e8)]",
              )}
            >
              <span className="w-5 h-5 flex items-center justify-center shrink-0 opacity-70">
                {Icon && <Icon size={16} />}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-[11px] text-[var(--ftre-text-ghost,#666)] font-mono ml-3 shrink-0">
                  {item.shortcut}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </motion.div>,
    document.body,
  );
}
