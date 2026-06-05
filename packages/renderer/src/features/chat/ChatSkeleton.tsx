/**
 * ChatSkeleton — 会话切换时的骨架屏
 *
 * 设计原则：
 * 1. 使用 shimmer 动画而非 pulse，感觉"正在加载中"而非"等待中"
 * 2. 每层 staggered 延迟，营造流水线般的自然节奏
 * 3. 精准匹配真实消息的间距/对齐，切回时不跳变
 * 4. 只模拟 2 轮对话，过多会增加"等很久"的心理暗示
 */

import { memo } from "react";

const shimmerKeyframes = `
@keyframes ftre-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

const shimmerBase = {
  backgroundImage: `linear-gradient(
    90deg,
    var(--ftre-bg-skeleton) 0%,
    var(--ftre-bg-skeleton) 40%,
    rgba(255,255,255,0.06) 50%,
    var(--ftre-bg-skeleton) 60%,
    var(--ftre-bg-skeleton) 100%
  )`,
  backgroundSize: "200% 100%",
  animation: "ftre-shimmer 1.8s ease-in-out infinite",
  animationFillMode: "both" as const,
};

// ─── helpers ───────────────────────────────────────────────────────

const SkeletonBlock = ({
  width,
  height,
  rounded,
  delay = 0,
}: {
  width: string;
  height: string;
  rounded: string;
  delay?: number;
}) => (
  <div
    className="shrink-0"
    style={{
      width,
      height,
      borderRadius: rounded,
      ...shimmerBase,
      animationDelay: `${delay}s`,
    }}
  />
);

const SkeletonUserBubble = memo(({ delay }: { delay: number }) => (
  <div className="flex justify-end py-1.5" style={{ animationDelay: `${delay}s` }}>
    <div className="max-w-[66%] flex flex-col items-end gap-2">
      <SkeletonBlock width="72%" height="14px" rounded="14px" delay={delay} />
      <SkeletonBlock width="44%" height="14px" rounded="14px" delay={delay + 0.12} />
    </div>
  </div>
));
SkeletonUserBubble.displayName = "SkeletonUserBubble";

const SkeletonAssistantBubble = memo(({ delay }: { delay: number }) => (
  <div className="flex justify-start py-2" style={{ animationDelay: `${delay}s` }}>
    <div className="max-w-[82%] w-full space-y-2.5">
      {/* thinking */}
      <div className="flex items-center gap-2">
        <SkeletonBlock width="12px" height="12px" rounded="50%" delay={delay} />
        <SkeletonBlock width="96px" height="12px" rounded="4px" delay={delay + 0.06} />
      </div>
      {/* body */}
      <div className="space-y-2">
        <SkeletonBlock width="92%" height="14px" rounded="4px" delay={delay + 0.1} />
        <SkeletonBlock width="78%" height="14px" rounded="4px" delay={delay + 0.16} />
        <SkeletonBlock width="60%" height="14px" rounded="4px" delay={delay + 0.22} />
      </div>
      {/* tool call trace */}
      <div className="flex items-center gap-2 pt-0.5">
        <SkeletonBlock width="12px" height="12px" rounded="4px" delay={delay + 0.26} />
        <SkeletonBlock width="148px" height="12px" rounded="4px" delay={delay + 0.3} />
      </div>
    </div>
  </div>
));
SkeletonAssistantBubble.displayName = "SkeletonAssistantBubble";

// ─── main ──────────────────────────────────────────────────────────

export function ChatSkeleton() {
  return (
    <div className="flex-1 overflow-hidden px-6 py-4" aria-label="加载中">
      {/* inject shimmer keyframes once */}
      <style>{shimmerKeyframes}</style>

      <div className="max-w-[960px] mx-auto">
        {/* 第 1 轮 */}
        <SkeletonUserBubble delay={0.05} />
        <SkeletonAssistantBubble delay={0.15} />

        {/* 第 2 轮 */}
        <SkeletonUserBubble delay={0.4} />
        <SkeletonAssistantBubble delay={0.5} />
      </div>
    </div>
  );
}
