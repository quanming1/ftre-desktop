/**
 * ThinkingIndicator —— SSE 流式输出中的"思考中"占位。
 *
 * 使用约束：
 *   - 仅在 streaming 且没有 tool 在 pending/running 时展示。
 *   - 颜色绑定主题 CSS 变量 (--ftre-accent-default / --ftre-accent-hover)，
 *     自动跟随暗/亮主题。
 *   - 不自带外边距，定位/间距交给调用方，方便复用。
 *
 * 设计：
 *   - 一颗圆润小方块，主题色对角渐变；不带高光、不带发光阴影，避免抢戏
 *   - 双层动画：外层呼吸 (scale 0.9 ↔ 1.1)，内层匀速自转 (4s)
 *     两套 transform 拆到不同元素，避免相互覆盖
 *   - 关键帧通过模块级 `injectStyleOnce()` 注入，多个实例只插一份
 */

const STYLE_ID = "ftre-thinking-indicator-style";

const STYLES = `
@keyframes ftre-thinking-breath {
  0%, 100% { transform: scale(0.9); opacity: 0.55; }
  50%      { transform: scale(1.1); opacity: 0.85; }
}
@keyframes ftre-thinking-spin {
  to { transform: rotate(360deg); }
}
.ftre-thinking-square {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(
    135deg,
    var(--ftre-accent-default) 0%,
    var(--ftre-accent-hover) 100%
  );
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

// 模块加载即注入；SSR 场景被 `typeof document` 保护。
injectStyleOnce();

export interface ThinkingIndicatorProps {
  /** 文案，默认"思考中" */
  label?: string;
  /** 额外类名（建议用来加 margin 等定位属性） */
  className?: string;
}

export function ThinkingIndicator({
  label = "",
  className = "",
}: ThinkingIndicatorProps) {
  return (
    <div
      className={`inline-flex items-center select-none ${className}`}
      role="status"
      aria-label={label || "思考中"}
    >
      {/* 外层承载呼吸：scale 0.9 ↔ 1.1 + opacity 0.55 ↔ 0.85，节奏 2s */}
      <span
        className="relative inline-flex"
        style={{ animation: "ftre-thinking-breath 2s ease-in-out infinite" }}
        aria-hidden="true"
      >
        {/* 内层承载自转：4s 匀速一圈，主题色渐变小方块 */}
        <span
          className="ftre-thinking-square"
          style={{ animation: "ftre-thinking-spin 4s linear infinite" }}
        />
      </span>
      {label && <span className="ml-2 text-[12px] text-t-dim leading-none">{label}</span>}
    </div>
  );
}
