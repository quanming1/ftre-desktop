/**
 * ChatSkeleton — 会话切换时的骨架屏
 *
 * 设计：模拟真实消息列表的布局节奏
 * - 左侧：用户消息（右对齐、短）
 * - 右侧：AI 消息（左对齐、长、带工具调用痕迹）
 * - 交替出现 2-3 轮
 */

const skeletonStyle = { backgroundColor: "var(--ftre-bg-skeleton)" };

function UserBubbleSkeleton() {
  return (
    <div className="flex justify-end py-1.5">
      <div className="max-w-[70%] space-y-2">
        <div className="h-4 w-48 rounded-2xl animate-pulse" style={skeletonStyle} />
        <div className="h-4 w-32 rounded-2xl animate-pulse ml-auto" style={skeletonStyle} />
      </div>
    </div>
  );
}

function AssistantBubbleSkeleton() {
  return (
    <div className="flex justify-start py-2">
      <div className="max-w-[85%] space-y-3">
        {/* 思考痕迹 */}
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full animate-pulse" style={skeletonStyle} />
          <div className="h-3 w-24 rounded animate-pulse" style={skeletonStyle} />
        </div>
        {/* 正文 */}
        <div className="space-y-2">
          <div className="h-4 w-64 rounded animate-pulse" style={skeletonStyle} />
          <div className="h-4 w-80 rounded animate-pulse" style={skeletonStyle} />
          <div className="h-4 w-56 rounded animate-pulse" style={skeletonStyle} />
        </div>
        {/* 工具调用痕迹 */}
        <div className="flex items-center gap-2 py-1">
          <div className="h-3 w-3 rounded animate-pulse" style={skeletonStyle} />
          <div className="h-3 w-32 rounded animate-pulse" style={skeletonStyle} />
        </div>
      </div>
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="flex-1 overflow-hidden px-6 py-4">
      <div className="max-w-[960px] mx-auto space-y-4">
        {/* 第一轮 */}
        <UserBubbleSkeleton />
        <AssistantBubbleSkeleton />

        {/* 第二轮 */}
        <UserBubbleSkeleton />
        <AssistantBubbleSkeleton />

        {/* 第三轮（部分，暗示更多） */}
        <UserBubbleSkeleton />
      </div>
    </div>
  );
}
