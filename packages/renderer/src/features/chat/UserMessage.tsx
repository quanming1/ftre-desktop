import { memo, useCallback } from "react";
import type { ChatMessage, MessagePart } from "@/types/chat";
import { handleOpenFileAtLine } from "./toolActions";
import { EmailCard } from "./EmailCard";

/**
 * 渲染单个 code ref chip（和编辑器中的 CodeChipView 样式一致）
 * 点击跳转到对应文件的指定行
 */
function CodeChip({ data }: { data: { path: string; name: string; lines: [number, number]; raw: string } }) {
  const label = `${data.name}:L${data.lines[0]}-L${data.lines[1]}`;

  const handleClick = useCallback(() => {
    handleOpenFileAtLine(data.path, data.lines[0]);
  }, [data.path, data.lines]);

  return (
    <span
      onClick={handleClick}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono bg-white/[0.06] text-t-secondary border border-border-subtle align-baseline cursor-pointer hover:bg-white/[0.1] hover:text-t-primary transition-colors"
      title={`${data.path} L${data.lines[0]}-L${data.lines[1]} — 点击打开`}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-60">
        <path d="M2 1.5A1.5 1.5 0 013.5 0h6.879a1.5 1.5 0 011.06.44l2.122 2.12A1.5 1.5 0 0114 3.622V14.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 14.5v-13z" />
      </svg>
      {label}
    </span>
  );
}

/**
 * 渲染 parts 数组为 inline 内容（text + code chips 混排）
 */
/**
 * 渲染 parts 数组为 inline 内容（text + code chips + email cards 混排）
 *
 * parts 类型：
 * - text:     渲染为 <span>
 * - code_ref: 渲染为 <CodeChip>（可点击跳转）
 * - email:    渲染为 <EmailCard>（邮件卡片）
 */
function PartsContent({ parts }: { parts: MessagePart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text") {
          return <span key={i}>{part.data}</span>;
        }
        if (part.type === "code_ref") {
          return <CodeChip key={i} data={part.data} />;
        }
        if (part.type === "email") {
          return <EmailCard key={i} data={part.data} />;
        }
        return null;
      })}
    </>
  );
}

export const UserMessage = memo(
  function UserMessage({ message }: { message: ChatMessage }) {
    const hasParts = message.parts && message.parts.length > 0;

    return (
      <div className="flex justify-end">
        <div className="max-w-[90%]">
          <div className="text-[12px] mb-1.5 text-right text-t-dim font-mono">你</div>
          <div className="text-[14px] leading-relaxed text-t-primary bg-panel px-4 py-3 rounded-xl rounded-br-sm whitespace-pre-wrap break-words font-sans">
            {hasParts ? <PartsContent parts={message.parts!} /> : message.content}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) => {
    return prev.message.content === next.message.content && prev.message.parts === next.message.parts;
  },
);
