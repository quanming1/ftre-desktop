/**
 * ChatSkeleton — 会话切换时的骨架屏
 *
 * 目标：
 * - 减少用户等待感，而不是强调"正在加载"
 * - 用少量大色块轻铺 messageList 区域，避免细碎闪烁造成视觉噪音
 * - 明度压低，尽量像内容占位，而不是强提示层
 */

import { memo } from "react";

const blockStyle = {
  backgroundColor: "var(--ftre-bg-skeleton)",
  opacity: 0.55,
};

const Row = memo(function Row({
  align = "left",
  width = "70%",
  height = 72,
}: {
  align?: "left" | "right";
  width?: string;
  height?: number;
}) {
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      <div
        className="rounded-[24px]"
        style={{
          ...blockStyle,
          width,
          height,
          borderRadius: 24,
        }}
      />
    </div>
  );
});

export function ChatSkeleton() {
  return (
    <div className="flex-1 overflow-hidden px-6 py-4" aria-label="加载中">
      <div className="max-w-[960px] mx-auto h-full">
        <div className="h-full flex flex-col gap-4">
          {/* 顶部留一点呼吸感，不做满屏小骨架 */}
          <div className="h-2" />

          {/* 少量大色块，模拟消息区节奏 */}
          <Row align="right" width="34%" height={44} />
          <Row align="left" width="72%" height={92} />
          <Row align="right" width="28%" height={40} />
          <Row align="left" width="58%" height={64} />

          {/* 底部自然留白，减少"加载很久"心理暗示 */}
          <div className="flex-1" />
        </div>
      </div>
    </div>
  );
}
