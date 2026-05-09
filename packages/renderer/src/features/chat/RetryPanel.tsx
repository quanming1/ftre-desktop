/**
 * RetryPanel — LLM 重试指示面板
 *
 * 显示在 ChatInput 上方，与 ChatInput 连为一体。
 * 支持展开/收起两种状态。
 */
import { useState, useEffect } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { RetryState } from "@/stores/chat";

interface RetryPanelProps {
  retry: RetryState;
  onExpandChange?: (expanded: boolean) => void;
}

export function RetryPanel({ retry, onExpandChange }: RetryPanelProps) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    onExpandChange?.(expanded);
  }, [expanded, onExpandChange]);

  const toggle = () => setExpanded((v) => !v);

  if (expanded) {
    return (
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 bg-panel border border-b-0 border-border-subtle rounded-t-2xl cursor-pointer hover:bg-elevated/50 transition-colors"
        onClick={toggle}
      >
        <div className="w-3.5 h-3.5 border-2 border-[#d2992266] border-t-[#d29922] rounded-full animate-spin" />
        <span className="flex-1 text-[13px] text-[#d29922]">
          正在重试 ({retry.attempt}/{retry.maxAttempts}): {retry.message}
        </span>
        <button
          className="p-1 text-t-ghost hover:text-t-secondary transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-panel border border-b-0 border-border-subtle rounded-t-xl cursor-pointer hover:bg-elevated/50 transition-colors"
      onClick={toggle}
    >
      <div className="w-3 h-3 border-2 border-[#d2992266] border-t-[#d29922] rounded-full animate-spin" />
      <span className="text-xs text-[#d29922]">
        {retry.attempt}/{retry.maxAttempts}
      </span>
      <button
        className="p-0.5 text-t-ghost hover:text-t-secondary transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <ChevronUp size={12} />
      </button>
    </div>
  );
}
