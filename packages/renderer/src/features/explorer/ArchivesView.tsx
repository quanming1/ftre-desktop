/**
 * ArchivesView — 工作区归档列表视图
 *
 * 显示当前工作区所有会话的最新归档，每个会话只显示最新一份。
 * 支持：展开查看详情、编辑摘要/内容/标签、删除归档、引用到输入框。
 */

import { useState, useEffect, useCallback } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  MessageSquare,
  Clock,
  FileText,
  MoreHorizontal,
  Pencil,
  Trash2,
  Tag,
  X,
  Check,
  Plus,
} from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { useNotification } from "@/stores/notification";
import {
  fetchWorkspaceArchives,
  updateArchive,
  deleteArchive,
  type ArchiveEntry,
} from "@/services/api";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString();
}

interface ArchiveItemProps {
  archive: ArchiveEntry;
  onUpdate: (updated: ArchiveEntry) => void;
  onDelete: (id: string) => void;
}

function ArchiveItem({ archive, onUpdate, onDelete }: ArchiveItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<
    "summary" | "content" | "label" | null
  >(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          {
            id: "insert-ref",
            label: "引用到输入框",
            icon: Plus,
            action: () => handleInsertRef(),
          },
          {
            id: "sep-actions",
            label: "",
            separator: true,
            action: () => {},
          },
          {
            id: "edit-summary",
            label: "编辑摘要",
            icon: Pencil,
            action: () => {
              setEditValue(archive.summary || "");
              setEditing("summary");
              setExpanded(true);
            },
          },
          {
            id: "edit-content",
            label: "编辑内容",
            icon: FileText,
            action: () => {
              setEditValue(archive.content || "");
              setEditing("content");
              setExpanded(true);
            },
          },
          {
            id: "edit-label",
            label: "编辑标签",
            icon: Tag,
            action: () => {
              setEditValue(archive.meta.label || "");
              setEditing("label");
              setExpanded(true);
            },
          },
          {
            id: "sep",
            label: "",
            separator: true,
            action: () => {},
          },
          {
            id: "delete",
            label: "删除归档",
            icon: Trash2,
            action: () => onDelete(archive.id),
          },
        ],
      });
    },
    [archive, onDelete],
  );

  /** 将归档引用插入到聊天输入框 */
  const handleInsertRef = useCallback(() => {
    const archiveRef = {
      id: archive.id,
      summary: archive.summary,
      turnCount: archive.meta.turn_count,
      totalMessages: archive.meta.total_messages,
      label: archive.meta.label,
      createdAt: archive.created_at,
    };
    window.dispatchEvent(
      new CustomEvent("ftre:insert-archive-ref", { detail: archiveRef }),
    );
    useNotification.getState().addNotification({
      level: "info",
      message: "归档已添加到输入框",
    });
  }, [archive]);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    setSaving(true);

    const data: { summary?: string; content?: string; label?: string } = {};
    if (editing === "summary") data.summary = editValue;
    if (editing === "content") data.content = editValue;
    if (editing === "label") data.label = editValue;

    const result = await updateArchive(archive.id, data);
    if (result) {
      onUpdate(result);
    }

    setSaving(false);
    setEditing(null);
  }, [archive.id, editing, editValue, onUpdate]);

  const handleCancel = useCallback(() => {
    setEditing(null);
    setEditValue("");
  }, []);

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Header */}
      <div
        onClick={() => !editing && setExpanded(!expanded)}
        onContextMenu={handleContextMenu}
        className="flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-white/[0.02] transition-colors group"
      >
        <span className="shrink-0 mt-0.5 text-t-muted">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="flex-1 min-w-0">
          {/* Summary with optional label */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-t-primary leading-relaxed line-clamp-2">
                {archive.summary || "无摘要"}
              </div>
              {archive.meta.label && (
                <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] bg-neon/10 text-neon">
                  <Tag size={9} />
                  {archive.meta.label}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-t-ghost">
            <span className="flex items-center gap-1">
              <MessageSquare size={10} />
              {archive.meta.turn_count} 轮对话
            </span>
            <span className="flex items-center gap-1">
              <FileText size={10} />
              {archive.meta.total_messages} 条消息
            </span>
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {timeAgo(archive.created_at)}
            </span>
            {archive.meta.updated_at && (
              <span className="text-t-ghost/60">（已编辑）</span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleInsertRef();
          }}
          className="shrink-0 p-1 rounded text-t-ghost opacity-0 group-hover:opacity-100 hover:text-violet-400 hover:bg-violet-500/10 transition-all"
          title="引用到输入框"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleContextMenu(e);
          }}
          className="shrink-0 p-1 rounded text-t-ghost opacity-0 group-hover:opacity-100 hover:text-t-muted hover:bg-white/[0.06] transition-all"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 pb-3 pl-7">
          {editing === "summary" ? (
            <div className="space-y-2">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full bg-base rounded-lg p-3 text-[12px] text-t-primary leading-relaxed resize-none border border-border focus:border-neon/50 outline-none"
                rows={3}
                placeholder="输入摘要..."
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-t-muted hover:bg-white/[0.06]"
                >
                  <X size={12} />
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-neon/20 text-neon hover:bg-neon/30 disabled:opacity-50"
                >
                  <Check size={12} />
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          ) : editing === "label" ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full bg-base rounded-lg px-3 py-2 text-[12px] text-t-primary border border-border focus:border-neon/50 outline-none"
                placeholder="输入标签..."
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-t-muted hover:bg-white/[0.06]"
                >
                  <X size={12} />
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-neon/20 text-neon hover:bg-neon/30 disabled:opacity-50"
                >
                  <Check size={12} />
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          ) : editing === "content" ? (
            <div className="space-y-2">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full bg-base rounded-lg p-3 text-[11px] text-t-secondary leading-relaxed resize-none border border-border focus:border-neon/50 outline-none max-h-[400px]"
                rows={10}
                placeholder="输入内容..."
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-t-muted hover:bg-white/[0.06]"
                >
                  <X size={12} />
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-neon/20 text-neon hover:bg-neon/30 disabled:opacity-50"
                >
                  <Check size={12} />
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-base/50 rounded-lg p-3 text-[11px] text-t-secondary leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto scrollbar-thin">
              {archive.content || "无详细内容"}
            </div>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export function ArchivesView({ visible }: { visible: boolean }) {
  const rootPath = useWorkspace((s) => s.rootPath);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadArchives = useCallback(async () => {
    if (!rootPath) {
      setArchives([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await fetchWorkspaceArchives(rootPath);
      setArchives(result.archives);
    } catch {
      setError("加载归档失败");
      setArchives([]);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  // 初次加载和切换工作区时刷新
  useEffect(() => {
    if (visible) {
      loadArchives();
    }
  }, [visible, rootPath, loadArchives]);

  const handleUpdate = useCallback((updated: ArchiveEntry) => {
    setArchives((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    useNotification.getState().addNotification({
      level: "info",
      message: "归档已更新",
    });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const result = await deleteArchive(id);
    if (result) {
      setArchives((prev) => prev.filter((a) => a.id !== id));
      useNotification.getState().addNotification({
        level: "info",
        message: "归档已删除",
      });
    } else {
      useNotification.getState().addNotification({
        level: "error",
        message: "删除失败",
      });
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-3 h-[38px] border-b border-border shrink-0">
        <span className="text-[12px] text-t-muted font-medium">归档列表</span>
        <span className="ml-2 text-[10px] text-t-ghost">
          {archives.length > 0 && `(${archives.length})`}
        </span>
        <div className="flex-1" />
        <button
          onClick={loadArchives}
          disabled={loading}
          className="flex items-center justify-center w-6 h-6 rounded text-t-ghost hover:text-t-muted hover:bg-white/[0.04] transition-colors disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && archives.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <RefreshCw size={20} className="text-t-ghost animate-spin" />
            <span className="text-[12px] text-t-ghost">加载中...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="text-[12px] text-danger">{error}</span>
            <button
              onClick={loadArchives}
              className="text-[11px] text-neon hover:underline"
            >
              重试
            </button>
          </div>
        ) : archives.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Archive size={20} className="text-t-ghost/60" />
            <span className="text-[12px] text-t-ghost">暂无归档</span>
          </div>
        ) : (
          <div>
            {archives.map((archive) => (
              <ArchiveItem
                key={archive.id}
                archive={archive}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
