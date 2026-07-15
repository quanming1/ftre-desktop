/**
 * Select — 轻量下拉选择器
 *
 * 触发按钮 + AnimatePresence 浮层，匹配项目视觉风格。
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder = "选择",
  className = "",
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleSelect = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-full items-center justify-between gap-1 rounded-md border border-black/[0.1] bg-white/70 px-2 text-[11px] font-mono text-t-secondary outline-none transition-colors hover:border-black/[0.2]"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={11}
          className={`shrink-0 text-t-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 origin-top"
          >
            <div className="overflow-hidden rounded-lg border border-black/[0.08] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
              {options.map((o) => (
                <button
                  key={o.value}
                  onClick={() => handleSelect(o.value)}
                  className={`flex w-full items-center px-2.5 py-1.5 text-left text-[11px] font-mono transition-colors hover:bg-black/[0.04] ${
                    o.value === value
                      ? "text-t-primary bg-black/[0.03]"
                      : "text-t-secondary"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}