import { useEffect } from 'react';
import { useLayout } from '@/stores/layout';
import { useWorkspace } from '@/stores/workspace';
import { FloatingWindow } from '@/components/FloatingWindow';
import { AgentChatWindow } from './AgentChatWindow';
import { useAgentChat } from '@/stores/agent-chat';

/**
 * Agent 群聊浮动窗口。
 *
 * - 每次打开时从后端加载数据
 * - 打开时启动消息轮询，关闭时停止
 */
export function AgentChatDropdown() {
  const isOpen = useLayout((s) => s.agentChatOpen);
  const toggle = useLayout((s) => s.toggleAgentChat);
  const rootPath = useWorkspace((s) => s.rootPath);
  const init = useAgentChat((s) => s.init);
  const startPolling = useAgentChat((s) => s.startPolling);
  const stopPolling = useAgentChat((s) => s.stopPolling);
  const activeRoomId = useAgentChat((s) => s.activeRoomId);

  // 每次打开时重新拉取数据
  useEffect(() => {
    if (isOpen && rootPath) {
      init(rootPath);
    }
  }, [isOpen, rootPath, init]);

  // 打开/关闭时管理轮询
  useEffect(() => {
    if (isOpen && activeRoomId) {
      startPolling();
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [isOpen, activeRoomId, startPolling, stopPolling]);

  return (
    <FloatingWindow
      title="Agent 群聊"
      visible={isOpen}
      onClose={toggle}
      defaultRect={{ x: 100, y: 60, width: 900, height: 520 }}
      minWidth={600}
      minHeight={350}
      zIndex={46}
    >
      <AgentChatWindow />
    </FloatingWindow>
  );
}
