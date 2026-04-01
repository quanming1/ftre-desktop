import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";

export interface DialogButton {
  label: string;
  variant?: "default" | "danger" | "primary";
  action: () => void;
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** 传统二按钮模式 */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 自定义多按钮模式（优先级高于 confirmLabel/cancelLabel） */
  buttons?: DialogButton[];
}

const VARIANT_CLASSES: Record<string, string> = {
  default: "text-t-secondary hover:text-t-primary bg-transparent hover:bg-white/[0.06] border border-border",
  danger: "text-white bg-red-600 hover:bg-red-500",
  primary: "text-white bg-neon hover:bg-neon/80",
};

export function ConfirmDialog({ title, message, confirmLabel = "删除", cancelLabel = "取消", onConfirm, onCancel, buttons }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);

  // 解析按钮列表
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

  // Focus first button on mount, restore on unmount
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
        className="bg-elevated border border-border-subtle rounded-xl shadow-2xl p-6 min-w-[340px] max-w-[440px] outline-none"
      >
        <h3 className="text-[14px] font-semibold text-t-primary font-mono mb-2.5">{title}</h3>
        <p className="text-[13px] text-t-secondary font-mono mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2.5">
          {resolvedButtons.map((btn, i) => (
            <button
              key={btn.label}
              ref={i === 0 ? firstBtnRef : undefined}
              onClick={btn.action}
              className={`px-4 py-2 text-[13px] font-mono rounded-lg transition-colors duration-150 ${VARIANT_CLASSES[btn.variant ?? "default"]}`}
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
