import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, AlertTriangle, FileCode } from "lucide-react";

interface FileAffected {
  file: string;
  additions: number;
  deletions: number;
}

interface RollbackConfirmDialogProps {
  rolledBackCount: number;
  hasCodeChanges: boolean;
  filesAffected: FileAffected[];
  onConfirm: (skipCodeRestore: boolean) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function RollbackConfirmDialog({
  rolledBackCount,
  hasCodeChanges,
  filesAffected,
  onConfirm,
  onCancel,
  isLoading = false,
}: RollbackConfirmDialogProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const [skipCodeRestore, setSkipCodeRestore] = useState(false);

  // Handle Escape key
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

  // Focus management
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    cancelBtnRef.current?.focus();
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
      onClick={onCancel}
    >
      <motion.div
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rollback-confirm-title"
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="bg-elevated border border-border rounded-md shadow-2xl p-6 min-w-[400px] max-w-[500px] outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[var(--color-warning,#d29922)]" />
            <h3
              id="rollback-confirm-title"
              className="text-[14px] font-medium text-t-primary"
            >
              确认回滚
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="text-t-dim hover:text-t-primary transition-colors duration-150"
            aria-label="关闭回滚确认弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-[13px] text-t-secondary leading-relaxed">
            将回滚{" "}
            <span className="text-t-primary font-medium">
              {rolledBackCount}
            </span>{" "}
            轮对话
          </p>

          {hasCodeChanges ? (
            <div className="bg-panel/60 border border-border-subtle rounded-md p-3 max-h-[200px] overflow-y-auto">
              <div className="flex items-center gap-2 mb-2">
                <FileCode className="w-4 h-4 text-t-dim" />
                <span className="text-[12px] text-t-secondary">
                  以下文件将被恢复
                </span>
              </div>
              <div className="space-y-1.5">
                {filesAffected.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="text-t-secondary truncate flex-1 mr-3">
                      {file.file}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {file.additions > 0 && (
                        <span className="text-[var(--color-success,#00ff88)]">
                          +{file.additions}
                        </span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-[var(--color-error,#f85149)]">
                          -{file.deletions}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-t-dim">
              （该轮次无代码变更）
            </p>
          )}

          {hasCodeChanges && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skipCodeRestore}
                onChange={(e) => setSkipCodeRestore(e.target.checked)}
                className="w-4 h-4 rounded border-border bg-transparent accent-neon cursor-pointer"
              />
              <span className="text-[12px] text-t-secondary">
                只回滚对话，保留代码修改
              </span>
            </label>
          )}

          <div className="flex items-center gap-2 text-[var(--color-warning,#d29922)]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="text-[12px]">此操作不可撤销</span>
          </div>
        </div>

        <div className="flex justify-end gap-2.5 mt-5">
          <button
            ref={cancelBtnRef}
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-[13px] rounded-sm transition-colors duration-150 text-t-secondary hover:text-t-primary bg-panel hover:bg-border border border-border disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(skipCodeRestore)}
            disabled={isLoading}
            className="px-4 py-2 text-[13px] rounded-sm transition-colors duration-150 text-[var(--color-base,#1a1b1d)] bg-[var(--color-warning,#d29922)] hover:bg-[#e3a533] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
                回滚中...
              </>
            ) : (
              "确认回滚"
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
