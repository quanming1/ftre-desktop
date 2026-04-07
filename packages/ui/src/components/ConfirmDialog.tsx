import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { cn } from "../utils/cn";

type DialogButtonVariant = "default" | "danger" | "primary";

export interface DialogButton {
  label: string;
  variant?: DialogButtonVariant;
  action: () => void;
}

export interface ConfirmDialogProps {
  title: string;
  message: string;
  /** 传统双按钮模式 */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 自定义多按钮模式（优先于 confirmLabel/cancelLabel） */
  buttons?: DialogButton[];
  className?: string;
}

const BUTTON_BASE_CLASS =
  "px-4 py-2 text-[13px] rounded-[4px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ftre-accent,#00ff88)]";

const VARIANT_CLASSES: Record<DialogButtonVariant, string> = {
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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55"
      onClick={onCancel}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ftre-confirm-dialog-title"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "rounded-[6px] border p-6 shadow-2xl min-w-[340px] max-w-[440px] outline-none",
          "bg-[var(--ftre-elevated,#2d2d2d)] border-[var(--ftre-border,#3c3c3c)]",
          className,
        )}
      >
        <h3
          id="ftre-confirm-dialog-title"
          className="text-[14px] font-medium text-[var(--ftre-text-primary,#e8e8e8)] mb-2"
        >
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
              className={cn(BUTTON_BASE_CLASS, VARIANT_CLASSES[btn.variant ?? "default"])}
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
