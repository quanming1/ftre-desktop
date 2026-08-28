/**
 * MessageSearch — MessageList 的 Ctrl+F 搜索浮窗（VS Code 风格）。
 *
 * 第一行：搜索图标 + 输入框 + 分隔线 + 关闭按钮；
 * 第二行：↑↓ 导航按钮 + "x / N" 计数（右侧）。
 * 由父级以绝对定位渲染在消息列右缘顶部（不随列表滚动）。
 */
import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";

export interface MessageSearchProps {
  query: string;
  onQueryChange: (value: string) => void;
  current: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function MessageSearch({
  query,
  onQueryChange,
  current,
  total,
  onNext,
  onPrev,
  onClose,
}: MessageSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦（组件随 open 条件渲染，挂载即打开）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onNext();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onPrev();
    }
  };

  const navBtnClass =
    "flex h-6 w-6 items-center justify-center rounded-md text-t-secondary transition-colors hover:bg-hover hover:text-t-primary disabled:cursor-default disabled:opacity-40";

  return (
    <div
      data-testid="message-search"
      className="pointer-events-auto w-[300px] rounded-xl border border-border-subtle bg-surface p-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.18)]"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-1.5 px-1">
        <Search size={14} className="shrink-0 text-t-ghost" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索消息..."
          spellCheck={false}
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-t-primary outline-none placeholder:text-t-ghost"
        />
        <div className="mx-0.5 h-4 w-px shrink-0 bg-border-subtle" />
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭搜索"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-t-secondary transition-colors hover:bg-hover hover:text-t-primary"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border-subtle/60 px-1 pt-1">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={total === 0}
            aria-label="上一个匹配"
            className={navBtnClass}
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={total === 0}
            aria-label="下一个匹配"
            className={navBtnClass}
          >
            <ArrowDown size={14} />
          </button>
        </div>
        <span className="text-[12px] tabular-nums text-t-ghost">
          {total > 0 ? `${current + 1} / ${total} results` : "0 results"}
        </span>
      </div>
    </div>
  );
}
