/**
 * EmailCard — 邮件消息卡片组件
 *
 * 在聊天消息流中渲染 Agent 之间的邮件通信。
 * 替代纯文本展示，提供结构化的邮件信息展示。
 *
 * 视觉设计：
 * ┌─ ✉ 来自 Web前端负责人 ─────── 18:19 ─┐
 * │ 主题: 画布导出逻辑确认                  │
 * │                                        │
 * │ 你好，想了解一下你们画布导出的...       │
 * └────────────────────────────────────────┘
 */
import { Mail } from 'lucide-react';
import type { EmailPartData } from '@/types/chat';

interface EmailCardProps {
  data: EmailPartData;
}

export function EmailCard({ data }: EmailCardProps) {
  const time = data.timestamp
    ? new Date(data.timestamp * 1000).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <div className="my-1.5 rounded-lg border border-border-subtle bg-elevated overflow-hidden">
      {/* 头部：邮件图标 + 发件人 + 时间 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-white/[0.02]">
        <Mail size={13} strokeWidth={1.5} className="text-neon shrink-0" />
        <span className="text-[12px] font-mono font-medium text-t-primary">
          来自 {data.from_name}
        </span>
        {time && (
          <span className="text-[10px] font-mono text-t-ghost ml-auto shrink-0">
            {time}
          </span>
        )}
      </div>

      {/* 主题 */}
      {data.subject && (
        <div className="px-3 pt-2">
          <span className="text-[11px] font-mono text-t-dim">主题: </span>
          <span className="text-[12px] font-mono font-medium text-t-secondary">
            {data.subject}
          </span>
        </div>
      )}

      {/* 正文 */}
      <div className="px-3 py-2">
        <p className="text-[12px] font-mono text-t-primary leading-relaxed whitespace-pre-wrap break-words">
          {data.content}
        </p>
      </div>

      {/* 底部：线程 ID（调试用，可选显示） */}
      {data.room_id && (
        <div className="px-3 py-1.5 border-t border-border-subtle">
          <span className="text-[9px] font-mono text-t-ghost">
            线程 {data.room_id.slice(0, 8)}...
          </span>
        </div>
      )}
    </div>
  );
}
