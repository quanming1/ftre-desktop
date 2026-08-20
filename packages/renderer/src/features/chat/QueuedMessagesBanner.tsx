import { memo, useCallback, useState } from "react";
import { CornerDownRight, ImageIcon, ListOrdered, Loader2, PencilLine, Trash2 } from "lucide-react";
import { cancelQueuedMessage } from "@/services/api";
import type { MailboxItemPayload } from "@/services/websocket-client";
import { useChat } from "@/stores/chat";
import { useNotification } from "@/stores/notification";

/**
 * 输入框上方的待执行消息横幅。
 *
 * 数据来自 pendingMessages 投影：点击发送后先放入本地 optimistic 队列项，
 * durable ACK / mailbox_snapshot 再用同一个 request_id 覆盖为服务端事实。
 * SessionLane 领取、写入 UserMsg 并回显后，才从横幅移除并进入聊天 messages。
 * 因而“待执行”和“聊天历史”始终是两份职责明确的数据，不会来回搬运同一气泡。
 */
export const QueuedMessagesBanner = memo(function QueuedMessagesBanner({
  items,
}: {
  items: MailboxItemPayload[];
}) {
  const sessionId = useChat((state) => state.sessionId);
  const addNotification = useNotification((state) => state.addNotification);
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  // 队列默认折叠为一行；需要查看或编辑具体消息时再展开。
  const [expanded, setExpanded] = useState(false);

  const removeFromQueue = useCallback(async (requestId: string): Promise<boolean> => {
    if (!sessionId || removing.has(requestId)) return false;
    setRemoving((current) => new Set(current).add(requestId));
    try {
      await cancelQueuedMessage(sessionId, requestId);
      // 不做乐观删除：下一帧 mailbox_snapshot 才是队列的最终事实。
      return true;
    } catch (error) {
      addNotification({
        level: "error",
        message: error instanceof Error ? error.message : "无法移除队列消息",
      });
      return false;
    } finally {
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
    }
  }, [addNotification, removing, sessionId]);

  const editMessage = useCallback(async (item: MailboxItemPayload) => {
    const request = { accepted: false, attachments: item.attachments || [] };
    window.dispatchEvent(new CustomEvent("ftre:queued-edit-request", { detail: request }));
    if (!request.accepted || !await removeFromQueue(item.request_id)) return;
    window.dispatchEvent(new CustomEvent("ftre:queued-edit-refill", {
      detail: { content: item.content || "", attachments: item.attachments || [] },
    }));
  }, [removeFromQueue]);

  if (items.length === 0) return null;
  // 折叠态仍需展示队首摘要；展开态则显示完整队列行。
  const next = items[0];
  return (
    <section
      className="mx-3 mb-1 mt-0.5"
      aria-label="消息队列"
      data-queued-messages=""
      data-activity-section="queue"
      role="region"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-1.5 px-0 py-1 text-left transition-colors hover:text-t-primary"
      >
        <ListOrdered size={13} className="shrink-0 text-t-muted" />
        <span className="shrink-0 text-[11px] font-medium text-t-muted">消息队列</span>
        <span className="rounded-full bg-black/[0.05] px-1.5 py-px font-mono text-[10px] tabular-nums text-t-faint">{items.length}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-t-faint" title={itemLabel(next)}>
          下一条 · {itemLabel(next)}
        </span>
      </button>
      {expanded && (
        <div className="py-0.5" role="list">
          {items.map((item) => {
            const isRemoving = removing.has(item.request_id);
            const isOptimistic = item.optimistic === true;
            const label = itemLabel(item);
            const imageCount = item.attachments?.length ?? 0;
            return (
              <div
                key={item.request_id}
                role="listitem"
                className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 transition-colors hover:bg-black/[0.03]"
              >
                <CornerDownRight size={13} className="shrink-0 text-t-faint" strokeWidth={1.7} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-t-secondary" title={label}>{label}</span>
                {imageCount > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-t-faint">
                    <ImageIcon size={10} />{imageCount}
                  </span>
                )}
                {isOptimistic ? (
                  <span className="shrink-0 text-[10px] text-t-faint">发送中</span>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={`编辑队列消息：${label}`}
                      disabled={isRemoving}
                      onClick={() => void editMessage(item)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-t-ghost hover:bg-black/[0.05] hover:text-t-primary disabled:opacity-60"
                    ><PencilLine size={13} /></button>
                    <button
                      type="button"
                      aria-label={`从队列移除：${label}`}
                      disabled={isRemoving}
                      onClick={() => void removeFromQueue(item.request_id)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-t-ghost hover:bg-black/[0.05] hover:text-t-primary disabled:opacity-60"
                    >{isRemoving ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});

function itemLabel(item: MailboxItemPayload): string {
  const content = item.content?.trim();
  return content || (item.attachments?.length ? `${item.attachments.length} 张图片` : "未命名消息");
}
