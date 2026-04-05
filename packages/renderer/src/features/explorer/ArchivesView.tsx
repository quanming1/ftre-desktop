/**
 * ArchivesView — 工作区归档列表视图（支持文件夹分组）
 *
 * 功能：
 * - 按文件夹分组展示归档，未分类的归档单独显示
 * - 文件夹 CRUD：创建、重命名、删除、调整排序
 * - 归档分类：拖拽或右键菜单将归档加入/移出文件夹
 * - 一个归档可属于多个文件夹（多对多）
 */

import { useState, useEffect, useCallback, useMemo } from "react";
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
  Folder,
  FolderPlus,
  FolderMinus,
} from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { useNotification } from "@/stores/notification";
import {
  fetchWorkspaceArchives,
  fetchArchiveFolders,
  createArchiveFolder,
  updateArchiveFolder,
  deleteArchiveFolder,
  linkArchiveToFolder,
  unlinkArchiveFromFolder,
  updateArchive,
  deleteArchive,
  type ArchiveEntry,
  type ArchiveFolder,
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
  folders: ArchiveFolder[];
  currentFolderId?: string;
  onUpdate: (updated: ArchiveEntry) => void;
  onDelete: (id: string) => void;
  onAddToFolder: (archiveId: string, folderId: string) => void;
  onRemoveFromFolder: (archiveId: string, folderId: string) => void;
}

function ArchiveItem({
  archive,
  folders,
  currentFolderId,
  onUpdate,
  onDelete,
  onAddToFolder,
  onRemoveFromFolder,
}: ArchiveItemProps) {
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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const folderIds = archive.folder_ids || [];
      const availableFolders = folders.filter((f) => !folderIds.includes(f.id));
      const currentFolders = folders.filter((f) => folderIds.includes(f.id));

      const items: ContextMenuItem[] = [
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
      ];

      if (availableFolders.length > 0) {
        availableFolders.forEach((f) => {
          items.push({
            id: `add-to-${f.id}`,
            label: `添加到「${f.name}」`,
            icon: FolderPlus,
            action: () => onAddToFolder(archive.id, f.id),
          });
        });
      }

      if (currentFolderId) {
        items.push({
          id: "remove-from-current",
          label: "从当前文件夹移出",
          icon: FolderMinus,
          action: () => onRemoveFromFolder(archive.id, currentFolderId),
        });
      } else if (currentFolders.length > 0) {
        currentFolders.forEach((f) => {
          items.push({
            id: `remove-from-${f.id}`,
            label: `从「${f.name}」移出`,
            icon: FolderMinus,
            action: () => onRemoveFromFolder(archive.id, f.id),
          });
        });
      }

      items.push(
        {
          id: "sep-edit",
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
          id: "sep-delete",
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
      );

      setContextMenu({ position: { x: e.clientX, y: e.clientY }, items });
    },
    [archive, folders, currentFolderId, onDelete, onAddToFolder, onRemoveFromFolder, handleInsertRef],
  );

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

// ─── 文件夹组件 ───────────────────────────────────────────────────

interface FolderSectionProps {
  folder: ArchiveFolder;
  archives: ArchiveEntry[];
  allFolders: ArchiveFolder[];
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (updated: ArchiveEntry) => void;
  onDelete: (id: string) => void;
  onAddToFolder: (archiveId: string, folderId: string) => void;
  onRemoveFromFolder: (archiveId: string, folderId: string) => void;
  onEditFolder: (folder: ArchiveFolder) => void;
  onDeleteFolder: (folderId: string) => void;
}

function FolderSection({
  folder,
  archives,
  allFolders,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
  onAddToFolder,
  onRemoveFromFolder,
  onEditFolder,
  onDeleteFolder,
}: FolderSectionProps) {
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
            id: "edit-folder",
            label: "编辑文件夹",
            icon: Pencil,
            action: () => onEditFolder(folder),
          },
          {
            id: "sep",
            label: "",
            separator: true,
            action: () => {},
          },
          {
            id: "delete-folder",
            label: "删除文件夹",
            icon: Trash2,
            action: () => onDeleteFolder(folder.id),
          },
        ],
      });
    },
    [folder, onEditFolder, onDeleteFolder],
  );

  return (
    <div className="border-b border-border">
      <div
        onClick={onToggle}
        onContextMenu={handleContextMenu}
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors group"
      >
        <span className="shrink-0 text-t-muted">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <Folder size={14} className="shrink-0 text-amber-500/80" />
        <span className="flex-1 text-[12px] text-t-primary truncate">
          {folder.name}
        </span>
        <span className="text-[10px] text-t-ghost">
          {archives.length}
        </span>
      </div>
      {expanded && (
        <div className="pl-4 border-l border-border/50 ml-5">
          {archives.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-t-ghost text-center">
              文件夹为空
            </div>
          ) : (
            archives.map((archive) => (
              <ArchiveItem
                key={archive.id}
                archive={archive}
                folders={allFolders}
                currentFolderId={folder.id}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onAddToFolder={onAddToFolder}
                onRemoveFromFolder={onRemoveFromFolder}
              />
            ))
          )}
        </div>
      )}
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

// ─── 创建/编辑文件夹对话框 ─────────────────────────────────────────

interface FolderDialogProps {
  folder?: ArchiveFolder | null;
  onSave: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}

function FolderDialog({ folder, onSave, onClose }: FolderDialogProps) {
  const [name, setName] = useState(folder?.name || "");
  const [description, setDescription] = useState(folder?.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("请输入文件夹名称");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), description.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface rounded-lg border border-border shadow-xl w-[320px]">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-[13px] text-t-primary font-medium">
            {folder ? "编辑文件夹" : "新建文件夹"}
          </span>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[11px] text-t-muted mb-1">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-8 px-3 rounded bg-base border border-border focus:border-neon/50 text-[12px] text-t-primary outline-none"
              placeholder="输入文件夹名称"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[11px] text-t-muted mb-1">
              描述（可选）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded bg-base border border-border focus:border-neon/50 text-[12px] text-t-primary outline-none resize-none"
              placeholder="输入描述"
              rows={2}
            />
          </div>
          {error && (
            <div className="text-[11px] text-danger">{error}</div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[12px] text-t-muted hover:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded text-[12px] bg-neon/20 text-neon hover:bg-neon/30 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────

export function ArchivesView({ visible }: { visible: boolean }) {
  const rootPath = useWorkspace((s) => s.rootPath);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderDialog, setFolderDialog] = useState<{
    open: boolean;
    folder?: ArchiveFolder | null;
  }>({ open: false });

  const loadData = useCallback(async () => {
    if (!rootPath) {
      setArchives([]);
      setFolders([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [archivesResult, foldersResult] = await Promise.all([
        fetchWorkspaceArchives(rootPath),
        fetchArchiveFolders(rootPath),
      ]);
      setArchives(archivesResult.archives);
      setFolders(foldersResult.folders.sort((a, b) => a.sort_order - b.sort_order));
    } catch {
      setError("加载失败");
      setArchives([]);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible, rootPath, loadData]);

  const uncategorizedArchives = useMemo(() => {
    return archives.filter((a) => !a.folder_ids || a.folder_ids.length === 0);
  }, [archives]);

  const getArchivesInFolder = useCallback(
    (folderId: string) => {
      return archives.filter((a) => a.folder_ids?.includes(folderId));
    },
    [archives],
  );

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

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

  const handleAddToFolder = useCallback(
    async (archiveId: string, folderId: string) => {
      const result = await linkArchiveToFolder(folderId, archiveId);
      if (result && "status" in result && result.status === "linked") {
        setArchives((prev) =>
          prev.map((a) =>
            a.id === archiveId
              ? { ...a, folder_ids: [...(a.folder_ids || []), folderId] }
              : a,
          ),
        );
        useNotification.getState().addNotification({
          level: "info",
          message: "已添加到文件夹",
        });
      } else {
        useNotification.getState().addNotification({
          level: "error",
          message: "操作失败",
        });
      }
    },
    [],
  );

  const handleRemoveFromFolder = useCallback(
    async (archiveId: string, folderId: string) => {
      const result = await unlinkArchiveFromFolder(folderId, archiveId);
      if (result && "status" in result && result.status === "unlinked") {
        setArchives((prev) =>
          prev.map((a) =>
            a.id === archiveId
              ? { ...a, folder_ids: (a.folder_ids || []).filter((id) => id !== folderId) }
              : a,
          ),
        );
        useNotification.getState().addNotification({
          level: "info",
          message: "已从文件夹移出",
        });
      } else {
        useNotification.getState().addNotification({
          level: "error",
          message: "操作失败",
        });
      }
    },
    [],
  );

  const handleSaveFolder = useCallback(
    async (name: string, description: string) => {
      if (!rootPath) return;
      const editingFolder = folderDialog.folder;

      if (editingFolder) {
        const result = await updateArchiveFolder(editingFolder.id, { name, description });
        if (result && "id" in result) {
          setFolders((prev) =>
            prev.map((f) => (f.id === editingFolder.id ? result : f)),
          );
          useNotification.getState().addNotification({
            level: "info",
            message: "文件夹已更新",
          });
        } else if (result && "error" in result) {
          throw new Error(
            result.error === "folder_name_conflict" ? "名称已存在" : "更新失败",
          );
        }
      } else {
        const result = await createArchiveFolder({
          workspace: rootPath,
          name,
          description,
        });
        if (result && "id" in result) {
          setFolders((prev) => [...prev, result].sort((a, b) => a.sort_order - b.sort_order));
          useNotification.getState().addNotification({
            level: "info",
            message: "文件夹已创建",
          });
        } else if (result && "error" in result) {
          throw new Error(
            result.error === "folder_name_conflict" ? "名称已存在" : "创建失败",
          );
        }
      }
    },
    [rootPath, folderDialog.folder],
  );

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    const result = await deleteArchiveFolder(folderId);
    if (result && "status" in result && result.status === "deleted") {
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      setArchives((prev) =>
        prev.map((a) => ({
          ...a,
          folder_ids: (a.folder_ids || []).filter((id) => id !== folderId),
        })),
      );
      useNotification.getState().addNotification({
        level: "info",
        message: "文件夹已删除",
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
          onClick={() => setFolderDialog({ open: true })}
          className="flex items-center justify-center w-6 h-6 rounded text-t-ghost hover:text-t-muted hover:bg-white/[0.04] transition-colors"
          title="新建文件夹"
        >
          <FolderPlus size={14} />
        </button>
        <button
          onClick={loadData}
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
              onClick={loadData}
              className="text-[11px] text-neon hover:underline"
            >
              重试
            </button>
          </div>
        ) : archives.length === 0 && folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Archive size={20} className="text-t-ghost/60" />
            <span className="text-[12px] text-t-ghost">暂无归档</span>
          </div>
        ) : (
          <div>
            {/* 文件夹列表 */}
            {folders.map((folder) => (
              <FolderSection
                key={folder.id}
                folder={folder}
                archives={getArchivesInFolder(folder.id)}
                allFolders={folders}
                expanded={expandedFolders.has(folder.id)}
                onToggle={() => toggleFolder(folder.id)}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onAddToFolder={handleAddToFolder}
                onRemoveFromFolder={handleRemoveFromFolder}
                onEditFolder={(f) => setFolderDialog({ open: true, folder: f })}
                onDeleteFolder={handleDeleteFolder}
              />
            ))}

            {/* 未分类归档 */}
            {uncategorizedArchives.length > 0 && (
              <div className="border-t border-border">
                <div className="px-3 py-2 text-[11px] text-t-ghost bg-white/[0.01]">
                  未分类 ({uncategorizedArchives.length})
                </div>
                {uncategorizedArchives.map((archive) => (
                  <ArchiveItem
                    key={archive.id}
                    archive={archive}
                    folders={folders}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onAddToFolder={handleAddToFolder}
                    onRemoveFromFolder={handleRemoveFromFolder}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Folder Dialog */}
      {folderDialog.open && (
        <FolderDialog
          folder={folderDialog.folder}
          onSave={handleSaveFolder}
          onClose={() => setFolderDialog({ open: false })}
        />
      )}
    </div>
  );
}