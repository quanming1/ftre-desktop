/**
 * Modal — 通用弹窗组件
 *
 * 提供统一的遮罩动画、弹窗容器、关闭按钮和标题。
 * 设置弹窗、Cron 弹窗等均复用此组件。
 */
import { type ReactNode } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface ModalProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 弹窗标题（显示在右上角关闭按钮左侧） */
  title?: string;
  /** 弹窗内容 */
  children: ReactNode;
  /** 弹窗宽度，默认 640px */
  width?: number | string;
  /** 覆盖弹窗容器的 className */
  className?: string;
}

/** 遮罩 + 弹窗动画参数 */
const OVERLAY = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
};

const PANEL = {
  initial: { opacity: 0, scale: 0.92, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.92, y: 16 },
  transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as any },
};

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 640,
  className = "",
}: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...OVERLAY}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
          onClick={onClose}
        >
          <motion.div
            {...PANEL}
            onClick={(e) => e.stopPropagation()}
            className={`relative rounded-2xl border border-border bg-elevated shadow-2xl overflow-hidden flex flex-col ${className}`}
            style={{ width, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)" }}
          >
            {/* 顶部栏：关闭按钮（有 title 时同时显示标题） */}
            <div className="shrink-0 flex items-center justify-between px-6 py-5 border-b border-border/60">
              {title ? (
                <h2 className="text-[18px] font-semibold text-t-primary">
                  {title}
                </h2>
              ) : (
                <span />
              )}
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-full flex items-center justify-center text-t-ghost hover:text-t-primary hover:bg-hover transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-6">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
