import { ChatRoomList } from './ChatRoomList';
import { AgentChatArea } from './AgentChatArea';
import { AgentMemberList } from './AgentMemberList';

/**
 * Agent 群聊主窗口 — 三栏布局
 *
 * ┌──────────┬──────────────────────┬──────────┐
 * │  频道列表  │     聊天区域          │  成员列表  │
 * │  200px   │     flex-1           │  180px   │
 * └──────────┴──────────────────────┴──────────┘
 *
 * 类似微信/Slack 的经典布局。
 * 作为 FloatingWindow 的 children 使用，自身不管理窗口行为。
 */
export function AgentChatWindow() {
  return (
    <div className="h-full flex overflow-hidden">
      {/* 左侧：房间列表 */}
      <div className="w-[200px] shrink-0 h-full">
        <ChatRoomList />
      </div>

      {/* 中间：聊天区域 */}
      <div className="flex-1 h-full min-w-0">
        <AgentChatArea />
      </div>

      {/* 右侧：成员列表 */}
      <div className="w-[180px] shrink-0 h-full">
        <AgentMemberList />
      </div>
    </div>
  );
}
