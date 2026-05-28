import { memo, useCallback, useState, useRef, useLayoutEffect } from "react";
import type { MessagePart, ArchiveRefData, SkillRefData } from "@/types/chat";
import type { ChatMessage as WsChatMessage } from "@/stores/chat";

/** Extended message type for UserMessage — supports both WS messages and legacy rich messages */
interface ChatMessage extends Omit<WsChatMessage, "parts"> {
  parts?: MessagePart[];
  codeRefs?: any[];
  diffMeta?: { base_hash: string; final_hash: string; workspace: string };
  metadata?: Record<string, unknown>;
}
import { handleOpenFileAtLine } from "./toolActions";
import { EmailCard } from "./EmailCard";
import {
  Archive,
  RotateCcw,
  Loader2,
  Copy,
  Check,
  GitFork,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useChat } from "@/stores/chat";
import { useEditor } from "@/stores/editor";
import { useNotification } from "@/stores/notification";
import { useSession } from "@/stores/session";
import { previewRollback, executeRollback } from "@/services/api";
import { fetchSessionMessages, fetchArchiveDetail } from "@/services/api";
import { RollbackConfirmDialog } from "./RollbackConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tooltip, TooltipProvider, ImageViewer } from "@ftre/ui";

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
 * 渲染 skill 引用 chip
 * 显示琥珀色背景 + ⚡ 图标 + skill 名称
 */
function SkillChip({ data }: { data: SkillRefData }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono bg-amber-500/10 text-amber-300/80 border border-amber-500/20 align-baseline"
      title={`Skill: ${data.name}`}
    >
      <Zap size={10} className="shrink-0 opacity-70" />
      <span className="truncate max-w-[180px]">{data.name}</span>
    </span>
  );
}

/**
 * 渲染单个 code ref chip（和编辑器中的 CodeChipView 样式一致）
 * 点击跳转到对应文件的指定行
 */
function CodeChip({
  data,
}: {
  data: { path: string; name: string; lines: [number, number]; raw: string };
}) {
  const label = `${data.name}:L${data.lines[0]}-L${data.lines[1]}`;

  const handleClick = useCallback(() => {
    handleOpenFileAtLine(data.path, data.lines[0]);
  }, [data.path, data.lines]);

  return (
    <span
      onClick={handleClick}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono bg-surface text-t-secondary border border-border-subtle align-baseline cursor-pointer hover:bg-hover hover:text-t-primary transition-colors"
      title={`${data.path} L${data.lines[0]}-L${data.lines[1]} — 点击打开`}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="shrink-0 opacity-60"
      >
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
        if (part.type === "skill_ref") {
          return <SkillChip key={i} data={part.data} />;
        }
        return null;
      })}
    </>
  );
}

/** 提取消息的纯文本内容（用于复制） */
function getMessageText(message: ChatMessage): string {
  if (message.parts && message.parts.length > 0) {
    return message.parts
      .map((part) => {
        if (part.type === "text") return part.data;
        if (part.type === "code_ref") {
          const d = part.data;
          return `[${d.name}:L${d.lines[0]}-L${d.lines[1]}]`;
        }
        if (part.type === "archive_ref") return `[归档: ${part.data.display}]`;
        if (part.type === "skill_ref") return `[Skill: ${part.data.name}]`;
        return "";
      })
      .join("");
  }
  return message.content ?? "";
}

/**
 * 渲染附件区（仅图片）
 * 和输入框的附件栏样式一致：小缩略图 + 文件名，放在消息下方。
 * 点击弹出全屏预览，Ctrl/Cmd + 点击在浏览器打开原图。
 */
function AttachmentStrip({
  attachments,
}: {
  attachments: NonNullable<WsChatMessage["attachments"]>;
}) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const images = attachments.filter((a) => a.type === "image");
  if (images.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-1 justify-end">
        {images.map((att, i) => (
          <div
            key={i}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const api = (window as any).desktop;
                if (api?.openExternal) {
                  api.openExternal(att.url);
                } else {
                  window.open(att.url, "_blank");
                }
                return;
              }
              setPreviewSrc(att.url);
            }}
            title={att.name || "image — 点击预览"}
            className="group inline-flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-md border border-border-subtle bg-panel text-t-primary text-[12px] max-w-[220px] cursor-pointer hover:border-neon/40 transition-colors"
          >
            {/* 缩略图 */}
            <img
              src={att.url}
              alt={att.name || "image"}
              className="block w-7 h-7 rounded object-cover bg-elevated shrink-0"
              draggable={false}
            />
            {/* 文件名 */}
            <span className="truncate text-t-secondary">{att.name || "image"}</span>
          </div>
        ))}
      </div>
      {previewSrc && (
        <ImageViewer
          src={previewSrc}
          alt={images.find((a) => a.url === previewSrc)?.name}
          onClose={() => setPreviewSrc(null)}
        />
      )}
    </>
  );
}

interface RollbackPreviewData {
  rolledBackCount: number;
  hasCodeChanges: boolean;
  filesAffected: Array<{ file: string; additions: number; deletions: number }>;
  refillMessage: { parts: Array<{ type: string; data: unknown }> };
}

export const UserMessage = memo(
  function UserMessage({ message }: { message: ChatMessage }) {
    const hasParts = message.parts && message.parts.length > 0;
    const sessionId = useChat((s) => s.sessionId);
    const isBusy = useChat((s) => s.isBusy);

    const [isHovered, setIsHovered] = useState(false);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [previewData, setPreviewData] = useState<RollbackPreviewData | null>(
      null,
    );
    const [copied, setCopied] = useState(false);
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
    } | null>(null);

    const messageRef = useRef<HTMLDivElement>(null);
    const bubbleRef = useRef<HTMLDivElement>(null);

    // 动态圆角：短消息接近胶囊，长消息收敛到固定值
    const [bubbleRadius, setBubbleRadius] = useState<number>(20);
    // 折叠：超长内容默认折叠，提供展开按钮
    const COLLAPSE_HEIGHT_PX = 320; // 超过此高度则启用折叠
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [collapsed, setCollapsed] = useState(true);
    // 内容实际高度，用于展开动画的目标值
    const [contentHeight, setContentHeight] = useState(0);

    // 监测气泡真实高度：动态调整圆角 + 判断是否需要折叠
    useLayoutEffect(() => {
      const el = bubbleRef.current;
      if (!el) return;
      const apply = () => {
        const h = el.scrollHeight;
        // 圆角 = clamp(12, h/2, 20)
        setBubbleRadius(Math.max(12, Math.min(h / 2, 20)));
        setIsOverflowing(h > COLLAPSE_HEIGHT_PX + 8);
        if (h > COLLAPSE_HEIGHT_PX + 8) setContentHeight(h);
      };
      apply();
      const ro = new ResizeObserver(apply);
      ro.observe(el);
      return () => ro.disconnect();
    }, [message.content, message.parts]);

    // 检查是否可以回滚（不在处理中，有 sessionId）
    const canRollback = !isBusy && !!sessionId;

    // 检查是否可以 Fork（消息有 archive_id）
    const archiveId = message.metadata?.archive_id as string | undefined;
    const canFork = !!archiveId;

    // 复制消息内容
    const handleCopy = useCallback(async () => {
      const text = getMessageText(message);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        useNotification.getState().addNotification({
          level: "error",
          message: "复制失败",
        });
      }
    }, [message]);

    // 处理点击回滚按钮
    const handleRollbackClick = useCallback(async () => {
      if (!sessionId || !message.id) return;

      setIsLoadingPreview(true);
      try {
        const result = await previewRollback(sessionId, message.id);

        if ("error" in result) {
          useNotification.getState().addNotification({
            level: "error",
            message: `回滚预览失败: ${result.error}`,
          });
          return;
        }

        setPreviewData({
          rolledBackCount: result.rolled_back_count,
          hasCodeChanges: result.has_code_changes,
          filesAffected: result.files_affected,
          refillMessage: result.refill_message,
        });
        setShowConfirmDialog(true);
      } catch (err) {
        useNotification.getState().addNotification({
          level: "error",
          message: "回滚预览请求失败",
        });
      } finally {
        setIsLoadingPreview(false);
      }
    }, [sessionId, message.id]);

    // 处理确认回滚
    const handleConfirmRollback = useCallback(
      async (skipCodeRestore: boolean) => {
        if (!sessionId || !message.id || !previewData) return;

        setIsExecuting(true);
        try {
          const result = await executeRollback(
            sessionId,
            message.id,
            skipCodeRestore,
          );

          if ("error" in result) {
            useNotification.getState().addNotification({
              level: "error",
              message: `回滚失败: ${result.error}`,
            });
            return;
          }

          // 关闭弹窗
          setShowConfirmDialog(false);
          setPreviewData(null);

          // 清理所有 pendingDiffs（关闭 diff 标签页，防止 Monaco DiffEditor 报错）
          const editorState = useEditor.getState();
          const diffsToReject = [...editorState.pendingDiffs];
          for (const diff of diffsToReject) {
            editorState.rejectDiff(diff.filePath);
          }

          // 刷新消息列表 (TODO: implement via WS)
          await fetchSessionMessages(sessionId);

          // 通过全局事件回填输入框（与 ftre:insert-code-ref 模式一致）
          if (result.refill_message?.parts) {
            window.dispatchEvent(
              new CustomEvent("ftre:rollback-refill", {
                detail: { parts: result.refill_message.parts },
              }),
            );
          }

          // Toast 提示
          useNotification.getState().addNotification({
            level: "info",
            message: `已回滚 ${result.rolled_back_count} 轮对话`,
          });
        } catch (err) {
          useNotification.getState().addNotification({
            level: "error",
            message: "回滚执行失败",
          });
        } finally {
          setIsExecuting(false);
        }
      },
      [sessionId, message.id, previewData],
    );

    // 处理取消
    const handleCancelRollback = useCallback(() => {
      setShowConfirmDialog(false);
      setPreviewData(null);
    }, []);

    // 处理 Fork 会话
    const handleFork = useCallback(async () => {
      if (!archiveId) return;

      // 获取归档详情
      const archive = await fetchArchiveDetail(archiveId);
      if (!archive) {
        useNotification.getState().addNotification({
          level: "error",
          message: "获取归档详情失败",
        });
        return;
      }

      // 跳转到新会话
      useSession.getState().newSession();

      // 构造完整的 ArchiveRef 并插入输入框
      window.dispatchEvent(
        new CustomEvent("ftre:insert-archive-ref", {
          detail: {
            id: archive.id,
            summary: archive.summary,
            turnCount: archive.meta?.turn_count,
            totalMessages: archive.meta?.total_messages,
            label: archive.meta?.label,
            createdAt: archive.created_at,
          },
        }),
      );
    }, [archiveId]);

    // 右键菜单
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }, []);

    const closeContextMenu = useCallback(() => {
      setContextMenu(null);
    }, []);

    const contextMenuItems: ContextMenuItem[] = [
      {
        id: "copy",
        label: "复制",
        icon: Copy,
        action: handleCopy,
      },
      ...(canFork
        ? [
            {
              id: "fork",
              label: "Fork 会话",
              icon: GitFork,
              action: handleFork,
            },
          ]
        : []),
    ];

    return (
      <div id={`msg-${message.id}`} data-msg-id={message.id} data-msg-role="user">
        <TooltipProvider>
          <div
            className="flex items-start justify-end gap-1.5 group"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* 操作按钮 - 在消息左侧，与消息顶部对齐 */}
            <div className="flex items-center gap-1 pt-2">
              {/* 复制按钮 - hover 时显示，在最左边 */}
              <Tooltip content="复制" side="top">
                <button
                  onClick={handleCopy}
                  className={`flex items-center justify-center w-9 h-9 text-t-ghost hover:text-t-secondary rounded-full hover:bg-hover transition-all ${
                    isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
                  }`}
                >
                  {copied ? (
                    <Check size={18} className="text-green-500" />
                  ) : (
                    <Copy size={18} />
                  )}
                </button>
              </Tooltip>

              {/* Fork 按钮 - hover 时显示，仅当有 archive_id 时 */}
              {canFork && (
                <Tooltip content="Fork 会话" side="top">
                  <button
                    onClick={handleFork}
                    className={`flex items-center justify-center w-7 h-7 text-t-ghost hover:text-t-secondary rounded-full hover:bg-hover transition-all ${
                      isHovered
                        ? "opacity-100"
                        : "opacity-0 pointer-events-none"
                    }`}
                  >
                    <GitFork size={15} />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* 消息内容 */}
            <div className="relative max-w-[85%] w-fit">
              <div
                ref={(node) => {
                  messageRef.current = node;
                  bubbleRef.current = node;
                }}
                onContextMenu={handleContextMenu}
                style={{
                  borderRadius: bubbleRadius,
                  maxHeight:
                    !isOverflowing
                      ? undefined
                      : collapsed
                        ? COLLAPSE_HEIGHT_PX
                        : contentHeight,
                  overflow: isOverflowing ? "hidden" : undefined,
                }}
                className="text-[var(--text-lg)] leading-relaxed text-t-primary bg-panel px-4 py-3 whitespace-pre-wrap break-words font-sans cursor-default transition-[max-height] duration-300 ease-out"
              >
                {hasParts ? (
                  <PartsContent parts={message.parts!} />
                ) : (
                  message.content
                )}
              </div>

              {/* 折叠时底部渐隐遮罩（展开时渐隐） */}
              {isOverflowing && (
                <div
                  className={`pointer-events-none absolute left-0 right-0 bottom-0 h-12 bg-gradient-to-t from-panel to-transparent transition-opacity duration-300 ease-out ${
                    collapsed ? "opacity-100" : "opacity-0"
                  }`}
                  style={{
                    borderBottomLeftRadius: bubbleRadius,
                    borderBottomRightRadius: bubbleRadius,
                  }}
                />
              )}

              {/* 展开/收起按钮 */}
              {isOverflowing && (
                <Tooltip
                  content={collapsed ? "展开文字" : "收起"}
                  side="top"
                >
                  <button
                    onClick={() => setCollapsed((v) => !v)}
                    className="absolute right-3 bottom-3 w-9 h-9 flex items-center justify-center rounded-full bg-white text-t-secondary hover:text-t-primary hover:bg-gray-100 shadow-md transition-colors"
                  >
                    {collapsed ? (
                      <ChevronDown size={22} className="relative top-px" />
                    ) : (
                      <ChevronUp size={22} className="relative top-px" />
                    )}
                  </button>
                </Tooltip>
              )}
            </div>
          </div>

          {/* 附件区 - 独立一行，右对齐 */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex justify-end">
              <AttachmentStrip attachments={message.attachments} />
            </div>
          )}
        </TooltipProvider>

        {/* 右键菜单 */}
        {contextMenu && (
          <ContextMenu
            items={contextMenuItems}
            position={contextMenu}
            onClose={closeContextMenu}
          />
        )}

      </div>
    );
  },
  (prev, next) => {
    return (
      prev.message.content === next.message.content &&
      prev.message.parts === next.message.parts &&
      prev.message.attachments === next.message.attachments &&
      prev.message.id === next.message.id
    );
  },
);
