import { memo, useCallback, useState, useEffect, useRef } from "react";
import { DiffSummaryCard as UiDiffSummaryCard } from "@ftre/ui";
import {
  fetchSnapshotFileDiff,
  fetchSnapshotFileContent,
  fetchDiffStat,
} from "@/services/api";
import { useEditor } from "@/stores/editor";
import { useChat } from "@/stores/chat";
import { useNotification } from "@/stores/notification";
import { Copy, Check, GitCompare, Loader2, ChevronUp } from "lucide-react";
import { Tooltip, TooltipProvider } from "@ftre/ui";

interface DiffFileSummary {
  file: string;
  additions: number;
  deletions: number;
}

interface DiffSummaryCardProps {
  messageId: string;
  baseHash: string;
  finalHash: string;
  workspace: string;
  /** 是否自动加载（用于刚结束的轮次），静默模式不弹窗 */
  autoLoad?: boolean;
}

/**
 * 获取本轮对话的所有 assistant 消息内容（用于复制）
 */
function getTurnContent(messageId: string): string {
  const messages = useChat.getState().messages;

  // 找到对应的 user 消息索引
  const userIdx = messages.findIndex((m) => m.id === messageId);
  if (userIdx === -1) return "";

  // 收集从 user 消息之后到下一个 user 消息之前的所有 assistant 内容
  const contents: string[] = [];
  for (let i = userIdx + 1; i < messages.length; i++) {
    const msg = messages[i];
    if ("role" in msg) {
      if (msg.role === "user") break; // 遇到下一个 user 消息，结束
      if (msg.role === "assistant" && "content" in msg && msg.content) {
        contents.push(msg.content);
      }
    }
  }

  return contents.join("\n\n");
}

export const DiffSummaryCard = memo(function DiffSummaryCard({
  messageId,
  baseHash,
  finalHash,
  workspace,
  autoLoad = false,
}: DiffSummaryCardProps) {
  const [copied, setCopied] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<DiffFileSummary[]>([]);
  const [totalAdditions, setTotalAdditions] = useState(0);
  const [totalDeletions, setTotalDeletions] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const autoLoadedRef = useRef(false);

  // 复制本轮对话内容
  const handleCopy = useCallback(async () => {
    const content = getTurnContent(messageId);
    if (!content) {
      useNotification.getState().addNotification({
        level: "warning",
        message: "没有可复制的内容",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      useNotification.getState().addNotification({
        level: "error",
        message: "复制失败",
      });
    }
  }, [messageId]);

  // 加载 diff 数据的核心逻辑，silent=true 时不弹窗
  const loadDiffData = useCallback(
    async (silent: boolean) => {
      setLoading(true);
      setError(null);

      try {
        const result = await fetchDiffStat(messageId);
        if (result) {
          setFiles(result.files ?? []);
          setTotalAdditions(result.total_additions ?? 0);
          setTotalDeletions(result.total_deletions ?? 0);
          setTotalFiles(result.total_files ?? result.files?.length ?? 0);

          if (result.files && result.files.length > 0) {
            setShowDiff(true);
          } else if (!silent) {
            useNotification.getState().addNotification({
              level: "info",
              message: "本轮没有文件变更",
            });
          }
        } else if (!silent) {
          setError("无法加载变更统计");
        }
      } catch (err) {
        console.warn("[DiffSummaryCard] 加载 Diff 统计失败", err);
        if (!silent) {
          setError("加载变更统计时出错");
        }
      } finally {
        setLoading(false);
      }
    },
    [messageId],
  );

  // 自动加载（仅最后一轮，静默模式）
  useEffect(() => {
    if (autoLoad && !autoLoadedRef.current) {
      autoLoadedRef.current = true;
      loadDiffData(true);
    }
  }, [autoLoad, loadDiffData]);

  // 手动点击加载/切换
  const handleToggleDiff = useCallback(async () => {
    if (showDiff) {
      setShowDiff(false);
      return;
    }

    if (files.length > 0) {
      setShowDiff(true);
      return;
    }

    await loadDiffData(false);
  }, [showDiff, files.length, loadDiffData]);

  const handleLoadFileDiff = useCallback(
    async (filePath: string) => {
      // 参数不完整时直接返回 null，避免无效请求
      if (!workspace || !baseHash || !finalHash) {
        console.warn("[DiffSummaryCard] 缺少必要参数，跳过加载", { workspace, baseHash, finalHash });
        return null;
      }
      try {
        const result = await fetchSnapshotFileDiff(
          workspace,
          baseHash,
          finalHash,
          filePath,
        );
        return result?.diff ?? null;
      } catch (error) {
        console.warn("[DiffSummaryCard] 加载文件 Diff 失败", error);
        return null;
      }
    },
    [workspace, baseHash, finalHash],
  );

  const handleOpenFileDiff = useCallback(
    async (filePath: string) => {
      // 参数不完整时直接返回，避免无效请求
      if (!workspace || !baseHash || !finalHash) {
        console.warn("[DiffSummaryCard] 缺少必要参数，跳过打开", { workspace, baseHash, finalHash });
        return;
      }
      try {
        const result = await fetchSnapshotFileContent(
          workspace,
          baseHash,
          finalHash,
          filePath,
        );
        if (!result) return;
        useEditor.getState().addDiff({
          id: `snapshot-${baseHash.slice(0, 8)}-${filePath}`,
          filePath,
          tabPath: `diff:${filePath}`,
          originalContent: result.before_content,
          newContent: result.after_content,
          toolName: "snapshot",
          isApproximate: false,
        });
      } catch (error) {
        console.warn("[DiffSummaryCard] 打开 Diff 标签失败", error);
      }
    },
    [workspace, baseHash, finalHash],
  );

  return (
    <div className="mt-2 mb-1">
      {/* 操作按钮栏 */}
      <TooltipProvider>
        <div className="flex items-center gap-1">
          {/* 复制按钮 */}
          <Tooltip content="复制本轮回复" side="top">
            <button
              onClick={handleCopy}
              className="flex items-center justify-center w-7 h-7 text-t-ghost hover:text-t-secondary rounded-md hover:bg-white/[0.06] transition-colors"
            >
              {copied ? (
                <Check size={15} className="text-green-500" />
              ) : (
                <Copy size={15} />
              )}
            </button>
          </Tooltip>

          {/* 查看变更按钮 - 仅当 hash 齐全且不同时显示 */}
          {baseHash && finalHash && baseHash !== finalHash && (
            <Tooltip content={showDiff ? "收起变更" : "查看变更"} side="top">
              <button
                onClick={handleToggleDiff}
                disabled={loading}
                className="flex items-center justify-center w-7 h-7 text-t-ghost hover:text-t-secondary rounded-md hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : showDiff ? (
                  <ChevronUp size={15} />
                ) : (
                  <GitCompare size={15} />
                )}
              </button>
            </Tooltip>
          )}

          {/* 加载错误提示 */}
          {error && (
            <span className="text-xs text-amber-500 ml-2">{error}</span>
          )}
        </div>
      </TooltipProvider>

      {/* 变更列表（展开时显示） */}
      {showDiff && files.length > 0 && (
        <div className="mt-2">
          <UiDiffSummaryCard
            diffMeta={{
              files,
              total_additions: totalAdditions,
              total_deletions: totalDeletions,
              total_files: totalFiles,
            }}
            onLoadFileDiff={handleLoadFileDiff}
            onOpenFileDiff={handleOpenFileDiff}
          />
        </div>
      )}
    </div>
  );
});
