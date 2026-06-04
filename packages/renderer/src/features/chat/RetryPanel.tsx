/**
 * RetryPanel — LLM 重试指示面板
 *
 * 显示在 ChatInput 上方，与 ChatInput 连为一体。常驻展示，不可收起。
 */
import type { RetryState } from "@/stores/chat";

interface RetryPanelProps {
  retry: RetryState;
}

export function RetryPanel({ retry }: RetryPanelProps) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 bg-panel border border-b-0 border-border-subtle rounded-t-2xl">
      <div className="w-3.5 h-3.5 border-2 border-[#d2992266] border-t-[#d29922] rounded-full animate-spin" />
      <span className="flex-1 text-[13px] text-[#d29922]">
        正在重试 ({retry.attempt}/{retry.maxAttempts}): {retry.message}
      </span>
    </div>
  );
}
