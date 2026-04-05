import { memo, useCallback } from "react";
import type { ChatMessage, MessagePart, ArchiveRefData } from "@/types/chat";
import { handleOpenFileAtLine } from "./toolActions";
import { EmailCard } from "./EmailCard";
import { Archive } from "lucide-react";

/**
 * 渲染归档引用 chip
 * 显示紫色背景 + 📦 图标 + 显示文本
 */
function ArchiveChip({ data }: { data: ArchiveRefData }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-sans bg-violet-500/10 text-violet-300/80 border border-violet-500/20 align-baseline"
      title={`归档引用: ${data.display}`}
    >
      <Archive size={10} className="shrink-0 opacity-70" />
      <span className="truncate max-w-[200px]">{data.display}</span>
    </span>
  );
}

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
 * 渲染 parts 数组为 inline 内容
 *
 * parts 类型：
 * - text:        渲染为 <span>
 * - code_ref:    渲染为 <CodeChip>（可点击跳转）
 * - email:       渲染为 <EmailCard>（邮件卡片）
 * - archive_ref: 渲染为 <ArchiveChip>（归档引用）
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
        if (part.type === "archive_ref") {
          return <ArchiveChip key={i} data={part.data} />;
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
