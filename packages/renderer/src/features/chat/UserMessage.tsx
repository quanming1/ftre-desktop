import { memo, useCallback, useState, useRef, useLayoutEffect, useMemo } from "react";
import type { MessagePart } from "@/types/chat";
import type { ChatMessage as WsChatMessage } from "@/stores/chat";

/** Extended message type for UserMessage — supports both WS messages and legacy rich messages */
interface ChatMessage extends WsChatMessage {
  parts?: MessagePart[];
  diffMeta?: { base_hash: string; final_hash: string; workspace: string };
  metadata?: Record<string, unknown>;
}
import { EmailCard } from "./EmailCard";
import {
  RotateCcw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useChat } from "@/stores/chat";
import { useEditor } from "@/stores/editor";
import { useNotification } from "@/stores/notification";
import { previewRollback, executeRollback } from "@/services/api";
import { fetchSessionMessages } from "@/services/api";
import { RollbackConfirmDialog } from "./RollbackConfirmDialog";
import { ContextMenu, type ContextMenuItem, Tooltip, TooltipProvider, ImageViewer } from "@ftre/ui";
import { formatAbsoluteMessageTime, formatMessageTime } from "./messageTime";
import { renderFtreInlineText } from "@/lib/ftre-extensions";

/**
 * 渲染 parts 数组为 inline 内容
 *
 * parts 类型：
 * - text:        渲染为 <span>
 * - email:       渲染为 <EmailCard>（邮件卡片）
 */
function PartsContent({ parts }: { parts: MessagePart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text") {
          return <span key={i}>{renderFtreInlineText(part.text ?? (part as any).data ?? "", { offsetTop: true })}</span>;
        }
        if (part.type === "email") {
          return <EmailCard key={i} data={part.data} />;
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
        if (part.type === "text") return part.text ?? (part as any).data ?? "";
        return "";
      })
      .join("");
  }
  return message.content ?? "";
}

/**
 * 渲染附件区（仅图片）
 * 小缩略图 + 文件名卡片，放在消息下方，与气泡同底色。
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
            className="group inline-flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-lg border border-white/60 bg-user-message text-t-primary text-[13px] max-w-[240px] cursor-pointer transition-colors"
          >
            {/* 缩略图 */}
            <img
              src={att.url}
              alt={att.name || "image"}
              className="block w-9 h-9 rounded-md object-cover bg-elevated shrink-0"
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
  refillMessage: { parts: Array<{ type: string; text?: string; data?: unknown }> };
}

/** Ctrl+F 关键字分段高亮：大小写不敏感，命中片段以 mark 呈现。memo 避免流式重渲染重复分段。 */
const HighlightText = memo(function HighlightText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const segments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const out: { text: string; hit: boolean }[] = [];
    const lower = text.toLowerCase();
    let i = 0;
    while (i <= text.length) {
      const idx = lower.indexOf(q, i);
      if (idx < 0) {
        if (i < text.length) out.push({ text: text.slice(i), hit: false });
        break;
      }
      if (idx > i) out.push({ text: text.slice(i, idx), hit: false });
      out.push({ text: text.slice(idx, idx + q.length), hit: true });
      i = idx + q.length;
    }
    return out;
  }, [text, query]);

  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map((seg, k) =>
        seg.hit ? (
          <mark key={k} className="rounded-[2px] bg-[#ffe58a] text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={k}>{seg.text}</span>
        ),
      )}
    </>
  );
});

export const UserMessage = memo(
  function UserMessage({
    message,
    searchQuery = "",
    isActiveMatch = false,
  }: {
    message: ChatMessage;
    /** Ctrl+F 搜索关键词（用于文本高亮） */
    searchQuery?: string;
    /** 当前定位的匹配消息（容器高亮提示） */
    isActiveMatch?: boolean;
  }) {
    const hasParts = message.parts && message.parts.length > 0;
    const hasContent = hasParts || (message.content && message.content.trim() !== "");
    const hasAttachments = message.attachments && message.attachments.length > 0;
    const sessionId = useChat((s) => s.sessionId);
    const sessionStatus = useChat((s) => s.sessionStatus);
    const queueDepth = useChat((s) => s.queueDepth);
    const pendingMessages = useChat((s) => s.pendingMessages);

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

    // 回滚要求当前会话空闲且 Inbox 没有未交接输入；队列 pending 不等于 Agent 正在流式输出。
    const canRollback = sessionStatus === "idle"
      && queueDepth === 0
      && pendingMessages.length === 0
      && !!sessionId;


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

          // 通过全局事件回填输入框
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
    ];

    return (
      <div
        id={`msg-${message.id}`}
        data-msg-id={message.id}
        data-msg-role="user"
        className={`group flex flex-col items-end transition-[box-shadow,background-color] duration-300 rounded-lg ${isActiveMatch ? "shadow-[0_0_0_2px_#facc15] bg-[#fefce8]/60" : ""}`}
      >
        <TooltipProvider>
          {/* 消息内容气泡（纯附件消息时省略） */}
          {hasContent && (
            <div className="relative max-w-[85%] w-fit">
              <div
                data-testid="user-message-bubble"
                ref={(node) => {
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
                className="text-[var(--text-md)] leading-relaxed text-t-primary bg-user-message px-4 py-3 whitespace-pre-wrap break-words font-sans cursor-default transition-[max-height] duration-300 ease-out"
              >
                {hasParts ? (
                  <PartsContent parts={message.parts!} />
                ) : typeof message.content === "string" && searchQuery.trim() ? (
                  <HighlightText text={message.content} query={searchQuery} />
                ) : (
                  renderFtreInlineText(message.content ?? "", { offsetTop: true })
                )}
              </div>

              {/* 折叠时底部渐隐遮罩（展开时渐隐） */}
              {isOverflowing && (
                <div
                  className={`pointer-events-none absolute left-0 right-0 bottom-0 h-12 bg-gradient-to-t from-user-message to-transparent transition-opacity duration-300 ease-out ${
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
          )}

          {/* 附件区：紧跟气泡（AttachmentStrip 自带右对齐与 mt-1），
              不再被 hover 才显示的元数据行隔开 */}
          {hasAttachments && (
            <AttachmentStrip attachments={message.attachments!} />
          )}

          {/* 元数据行沉底：hover 显示，不占据气泡与附件之间的空间 */}
          {hasContent && (
            <div className="invisible mt-1 flex items-center justify-end gap-1.5 text-[12px] leading-none text-t-faint opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-hover:pointer-events-auto pointer-events-none">
              <span
                className="tabular-nums"
                title={`发送时间：${formatAbsoluteMessageTime(message.timestamp)}`}
              >
                {formatMessageTime(message.timestamp)}
              </span>
              <Tooltip content={copied ? "已复制" : "复制"} side="top">
                <button
                  type="button"
                  aria-label={copied ? "已复制" : "复制消息"}
                  onClick={handleCopy}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-t-faint transition-colors hover:bg-hover hover:text-t-primary"
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </Tooltip>
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
      prev.message.id === next.message.id &&
      prev.searchQuery === next.searchQuery &&
      prev.isActiveMatch === next.isActiveMatch
    );
  },
);
