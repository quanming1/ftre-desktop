/**
 * TypingDots —— "正在输入"占位（三跳点）。
 *
 * 使用场景：刚发送消息 → 第一个 SSE event 到达之前，让用户感知"已收到、在路上"。
 * 与 ThinkingIndicator 的区别：
 *   - TypingDots 用于"还没收到任何模型输出"的空档期，由 ChatMessageList 控制
 *   - ThinkingIndicator 用于"流式中、当前没有 tool 跑"，由 AssistantMessage 控制
 *   - 两者互斥（state 决定），从不同时出现
 *
 * 颜色绑定 --ftre-accent-default，自动跟随主题。
 * 关键帧通过模块级 `injectStyleOnce()` 注入，多个实例只插一份。
 */

const STYLE_ID = "ftre-typing-dots-style";

const STYLES = `
@keyframes ftre-typing-bounce {
  0%, 60%, 100% { transform: translateY(0);    opacity: 0.5; }
  30%           { transform: translateY(-9px); opacity: 1;   }
}
.ftre-typing-dot {
  width: 5px;
  height: 5px;
  border-radius: 0;
  background: var(--ftre-accent-default);
  /* 像素硬投影，模拟 8-bit 方块的描边感（暗主题下用半透明黑） */
  box-shadow: 1px 1px 0 0 rgba(0, 0, 0, 0.45);
  animation: ftre-typing-bounce 1.4s steps(6, end) infinite;
}
`;

function injectStyleOnce(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLES;
  document.head.appendChild(el);
}

injectStyleOnce();

export interface TypingDotsProps {
  /** 额外类名（建议用来加 margin/padding 等定位属性） */
  className?: string;
}

export function TypingDots({ className = "" }: TypingDotsProps) {
  return (
    <div
      className={`inline-flex items-end gap-[5px] ${className}`}
      role="status"
      aria-label="正在输入"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="ftre-typing-dot"
          style={{ animationDelay: `${i * 0.22}s` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
