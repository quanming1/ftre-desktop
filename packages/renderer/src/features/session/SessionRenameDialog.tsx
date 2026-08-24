import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface SessionRenameDialogProps {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

/** 全屏 Portal 重命名弹窗，避免被侧栏的 overflow/transform 限制定位。 */
export function SessionRenameDialog({
  value,
  onChange,
  onCancel,
  onSave,
}: SessionRenameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid="session-rename-overlay"
      className="fixed inset-0 z-[9999] flex min-h-screen items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-rename-title"
        className="w-full max-w-[420px] overflow-hidden rounded-[18px] bg-surface/95 shadow-[0_24px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl backdrop-saturate-150"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="px-5 pb-2 pt-5">
          <div className="flex items-start justify-between gap-4">
            <h2 id="session-rename-title" className="text-[20px] font-semibold leading-7 text-t-primary">
              重命名聊天
            </h2>
            <button
              type="button"
              aria-label="关闭重命名弹窗"
              title="关闭"
              onClick={onCancel}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-t-ghost transition-colors hover:bg-hover hover:text-t-primary"
            >
              <X size={16} />
            </button>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-t-muted">保持简短且易于识别</p>
        </div>

        <div className="px-5 py-3">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSave();
              if (event.key === "Escape") onCancel();
            }}
            className="h-9 w-full rounded-lg border border-border-subtle bg-base/70 px-3 text-[14px] text-t-primary outline-none transition-colors placeholder:text-t-ghost focus:border-accent/60 focus:ring-2 focus:ring-accent/10"
            placeholder="输入聊天名称"
          />
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg px-4 text-[13px] text-t-secondary transition-colors hover:bg-hover hover:text-t-primary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={onSave}
            className="h-9 rounded-lg bg-t-primary px-4 text-[13px] text-base transition-colors hover:bg-t-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
