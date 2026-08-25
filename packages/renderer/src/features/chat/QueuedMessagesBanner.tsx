import { memo, useCallback, useState } from "react";
import { CornerDownRight, ImageIcon, ListOrdered, Loader2, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { cancelQueuedMessage } from "@/services/api";
import { wsClient, type QueueItemView } from "@/services/websocket-client";
import { useChat } from "@/stores/chat";
import { useNotification } from "@/stores/notification";

/**
 * 输入框上方的待执行消息横幅。
 *
 * 数据来自 pendingMessages 投影：点击发送后先放入本地 optimistic 队列项，
 * session/queue 操作响应再用同一个 request_id 覆盖为服务端事实。
 * Inbox 领取后由权威 session/queue 快照立即移除；持久化 UserMsg 通过实时事件
 * 进入聊天 messages。两份投影各自只消费自己的事实，不把已消费项留在队列中。
 */
export const QueuedMessagesBanner = memo(function QueuedMessagesBanner({
  items,
}: {
  items: QueueItemView[];
}) {
  const sessionId = useChat((state) => state.sessionId);
  const addNotification = useNotification((state) => state.addNotification);
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const [steering, setSteering] = useState<Set<string>>(() => new Set());
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const removeFromQueue = useCallback(async (requestId: string): Promise<boolean> => {
    if (!sessionId || removing.has(requestId)) return false;
    setRemoving((current) => new Set(current).add(requestId));
    try {
      await cancelQueuedMessage(sessionId, requestId);
      // 不做乐观删除：下一帧 session/queue 才是队列的最终事实。
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

  const promoteToSteer = useCallback(async (item: QueueItemView): Promise<void> => {
    if (!sessionId || item.placement !== "queued" || steering.has(item.request_id)) return;
    setSteering((current) => new Set(current).add(item.request_id));
    try {
      await wsClient.promoteQueueItemToSteer(sessionId, item.request_id);
    } catch (error) {
      addNotification({
        level: "error",
        message: error instanceof Error ? error.message : "无法提升为下一轮消息",
      });
    } finally {
      setSteering((current) => {
        const next = new Set(current);
        next.delete(item.request_id);
        return next;
      });
    }
  }, [addNotification, sessionId, steering]);

  const editMessage = useCallback(async (item: QueueItemView) => {
    const request = { accepted: false, attachments: item.attachments || [] };
    window.dispatchEvent(new CustomEvent("ftre:queued-edit-request", { detail: request }));
    if (!request.accepted || !await removeFromQueue(item.request_id)) return;
    setOpenMenu(null);
    window.dispatchEvent(new CustomEvent("ftre:queued-edit-refill", {
      detail: { content: item.content || "", attachments: item.attachments || [] },
    }));
  }, [removeFromQueue]);

  if (items.length === 0) return null;
  return (
    <section
      className="mt-0 mb-0"
      aria-label="消息队列"
      data-queued-messages=""
      data-activity-section="queue"
      role="region"
    >
      <div className="flex flex-col gap-1.5" role="list">
        {items.map((item) => {
          const isRemoving = removing.has(item.request_id);
          const isOptimistic = item.optimistic === true;
          const isSteering = item.placement === "steering";
          const isPromoting = steering.has(item.request_id);
          const isLocked = isOptimistic || isSteering || isPromoting;
          const label = itemLabel(item);
          const imageCount = item.attachments?.length ?? 0;
          return (
              <article
                key={item.request_id}
                role="listitem"
                className="relative overflow-visible rounded-t-2xl border border-b-0 border-black/10 bg-composer shadow-none"
              >
                <div className="flex min-w-0 items-center gap-2 bg-transparent px-3 py-1.5">
                  <ListOrdered size={14} className="shrink-0 text-t-muted" strokeWidth={1.7} />
                  {imageCount > 0 && <ImageIcon size={14} className="shrink-0 text-t-muted" strokeWidth={1.7} />}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-t-secondary" title={label}>{label}</span>
                  {isLocked ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-t-faint">
                      {isOptimistic && <Loader2 size={11} className="animate-spin" />}
                      {isOptimistic ? "发送中" : isPromoting ? "调整中" : "等待下一次推理"}
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`插入当前运行：${label}`}
                      disabled={isRemoving || isPromoting}
                      onClick={() => void promoteToSteer(item)}
                      className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-t-muted transition-colors hover:bg-black/[0.05] hover:text-t-primary disabled:opacity-60"
                    ><CornerDownRight size={13} />调整方向</button>
                    <button
                      type="button"
                      aria-label={`从队列移除：${label}`}
                      disabled={isRemoving}
                      onClick={() => {
                        setOpenMenu(null);
                        void removeFromQueue(item.request_id);
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-t-ghost hover:bg-black/[0.05] hover:text-t-primary disabled:opacity-60"
                    >{isRemoving ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
                    <button
                      type="button"
                      aria-label={`更多队列操作：${label}`}
                      aria-expanded={openMenu === item.request_id}
                      disabled={isRemoving}
                      onClick={() => setOpenMenu((current) => current === item.request_id ? null : item.request_id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-t-ghost hover:bg-black/[0.05] hover:text-t-primary disabled:opacity-60"
                    ><MoreHorizontal size={15} /></button>
                    </div>
                  )}
                </div>
                {imageCount > 0 && (
                  <div className="flex gap-1.5 px-3 pb-2">
                    {item.attachments?.slice(0, 4).map((attachment, index) => {
                      const url = typeof attachment.url === "string" ? attachment.url : "";
                      if (!url) return null;
                      const name = typeof attachment.name === "string" ? attachment.name : "消息附件";
                      return (
                        <img
                          key={`${item.request_id}-attachment-${index}`}
                          src={url}
                          alt={name}
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      );
                    })}
                    {imageCount > 4 && <span className="self-center text-[11px] text-t-faint">+{imageCount - 4}</span>}
                  </div>
                )}
                {openMenu === item.request_id && !isLocked && (
                  <div className="absolute right-2 top-8 z-50 w-44 rounded-xl bg-elevated/95 p-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.14)] backdrop-blur-md">
                    <button
                      type="button"
                      aria-label={`编辑队列消息：${label}`}
                      disabled={isRemoving}
                      onClick={() => void editMessage(item)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-t-secondary hover:bg-black/[0.05] hover:text-t-primary disabled:opacity-60"
                    ><PencilLine size={13} />编辑消息</button>
                  </div>
                )}
          </article>
          );
        })}
      </div>
    </section>
  );
});

function itemLabel(item: QueueItemView): string {
  const content = item.content?.trim();
  return content || (item.attachments?.length ? `${item.attachments.length} 张图片` : "未命名消息");
}
