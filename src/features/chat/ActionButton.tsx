/**
 * ActionButton — Plan 模式下的"下一步"按钮
 *
 * 由 Plan Agent 调用 show_next_button 工具触发渲染。
 * 点击后通过 ftre:plan-next-step 事件通知 ChatInput 发送确认消息。
 */
import { memo, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { ActionButtonMessage } from "@/types/chat";

export const ActionButton = memo(
  function ActionButton({ message }: { message: ActionButtonMessage }) {
    const [clicked, setClicked] = useState(false);

    const handleClick = () => {
      if (clicked) return;
      setClicked(true);
      window.dispatchEvent(
        new CustomEvent("ftre:plan-next-step", {
          detail: { step: message.step, label: message.label },
        }),
      );
    };

    return (
      <div className="flex flex-col gap-1.5 py-2">
        {message.summary && <div className="text-[11px] text-t-secondary font-mono px-1">{message.summary}</div>}
        <button
          onClick={handleClick}
          disabled={clicked}
          className={`
          inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium
          transition-all duration-200 self-start
          ${
            clicked
              ? "bg-neon/10 text-neon/60 cursor-default border border-neon/20"
              : "bg-neon/15 text-neon hover:bg-neon/25 border border-neon/30 hover:border-neon/50 cursor-pointer"
          }
        `}
        >
          {clicked ? (
            <>
              <Check size={14} />
              已确认
            </>
          ) : (
            <>
              <ArrowRight size={14} />
              {message.label}
            </>
          )}
        </button>
      </div>
    );
  },
  (prev, next) => {
    return prev.message.step === next.message.step && prev.message.label === next.message.label && prev.message.summary === next.message.summary;
  },
);
