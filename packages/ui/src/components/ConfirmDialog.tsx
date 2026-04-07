import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { cn } from "../utils/cn";

export interface DialogButton {
  label: string;
  variant?: "default" | "danger" | "primary";
  action: () => void;
}

export interface ConfirmDialogProps {
  title: string;
  message: string;
  /** Traditional two-button mode */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Custom multi-button mode (takes precedence over confirmLabel/cancelLabel) */
  buttons?: DialogButton[];
  className?: string;
}

const VARIANT_CLASSES: Record<string, string> = {
  default:
    "text-[var(--ftre-text-secondary,#cccccc)] hover:text-[var(--ftre-text-primary,#e8e8e8)] bg-[var(--ftre-panel,#333333)] hover:bg-[var(--ftre-border,#3c3c3c)] border border-[var(--ftre-border,#3c3c3c)]",
  danger:
    "text-[var(--ftre-text-primary,#e8e8e8)] bg-[var(--ftre-error,#f85149)] hover:bg-[#e5443b]",
  primary:
    "text-[var(--ftre-base,#1e1e1e)] bg-[var(--ftre-accent,#00ff88)] hover:bg-[var(--ftre-accent-hover,#00cc6e)]",
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  buttons,
  className,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);

  const resolvedButtons: DialogButton[] = buttons ?? [
    { label: cancelLabel, variant: "default", action: onCancel },
    { label: confirmLabel, variant: "danger", action: onConfirm },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    firstBtnRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
    >
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className={cn(
          "rounded-md border p-6 shadow-2xl min-w-[340px] max-w-[440px] outline-none",
          "bg-[var(--ftre-elevated,#2d2d2d)] border-[var(--ftre-border,#3c3c3c)]",
          className,
        )}
      >
        <h3 className="text-[14px] font-medium text-[var(--ftre-text-primary,#e8e8e8)] mb-2">
          {title}
        </h3>
        <p className="text-[13px] text-[var(--ftre-text-secondary,#cccccc)] mb-5 leading-relaxed">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          {resolvedButtons.map((btn, i) => (
            <button
              key={btn.label}
              ref={i === 0 ? firstBtnRef : undefined}
              onClick={btn.action}
              className={cn(
                "px-4 py-2 text-[13px] rounded transition-colors duration-150",
                VARIANT_CLASSES[btn.variant ?? "default"],
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
