/**
 * ArchivesView — 工作区归档列表视图
 *
 * 功能：
 * - Tab 式筛选：全部 / 各文件夹 / 未分类
 * - 列表视图 / 卡片网格视图切换
 * - 拖拽归档到文件夹 tab 添加分类
 * - 拖拽归档到聊天区域插入引用
 * - 文件夹 CRUD：创建、重命名、删除
 * - 归档分类：拖拽或右键菜单将归档加入/移出文件夹
 * - 一个归档可属于多个文件夹（多对多）
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  List,
  LayoutGrid,
  GripVertical,
  Inbox,
  Layers,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
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

type ViewMode = "list" | "grid";
type TabId = "all" | "uncategorized" | string; // string = folder id

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString();
}

// ─── 可编辑区域的保存/取消按钮 ───────────────────────────────────

function EditActions({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 justify-end">
      <button
        onClick={onCancel}
        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-t-muted hover:bg-white/6"
      >
        <X size={12} />
        取消
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-neon/20 text-neon hover:bg-neon/30 disabled:opacity-50"
      >
        <Check size={12} />
        {saving ? "保存中..." : "保存"}
      </button>
    </div>
  );
}

// ─── Tab 项（可作为 drop target） ─────────────────────────────────

interface TabItemProps {
  id: TabId;
  label: string;
  count: number;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  acceptDrop?: boolean;
}

function TabItem({
  id,
  label,
  count,
  icon,
  active,
  onClick,
  onContextMenu,
  acceptDrop = false,
}: TabItemProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `tab-${id}`,
    data: { type: "folder-tab", folderId: id },
    disabled: !acceptDrop,
  });

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`
        shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-all
        ${active ? "bg-white/10 text-t-primary" : "text-t-muted hover:text-t-primary hover:bg-white/5"}
        ${isOver ? "ring-2 ring-neon/50 bg-neon/10" : ""}
      `}
    >
      {icon}
      <span className="truncate max-w-20">{label}</span>
      <span className="text-[10px] text-t-ghost">({count})</span>
    </button>
  );
}

// ─── 聊天区域 drop target（检测拖到右边） ─────────────────────────

function ChatDropZone({ isActive }: { isActive: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: "chat-input-zone",
    data: { type: "chat-input" },
  });

  if (!isActive) return null;

  return (
    <div
      ref={setNodeRef}
      className={`
        fixed right-0 top-0 bottom-0 w-[45%] z-40 pointer-events-auto
        flex items-center justify-center
        transition-all duration-200
        ${isOver ? "bg-violet-500/10 backdrop-blur-sm" : "bg-transparent"}
      `}
    >
      {isOver && (
        <div className="flex flex-col items-center gap-2 text-violet-400">
          <Plus size={32} strokeWidth={1.5} />
          <span className="text-[13px] font-medium">松开引用到输入框</span>
        </div>
      )}
    </div>
  );
}

// ─── 归档项（列表模式） ─────────────────────────────────────────

interface ArchiveItemProps {
  archive: ArchiveEntry;
  folders: ArchiveFolder[];
  currentFolderId?: string;
  onUpdate: (updated: ArchiveEntry) => void;
  onDelete: (id: string) => void;
  onAddToFolder: (archiveId: string, folderId: string) => void;
  onRemoveFromFolder: (archiveId: string, folderId: string) => void;
  onInsertRef: (archive: ArchiveEntry) => void;
}

function ArchiveListItem({
  archive,
  folders,
  currentFolderId,
  onUpdate,
  onDelete,
  onAddToFolder,
  onRemoveFromFolder,
  onInsertRef,
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

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `archive-${archive.id}`,
      data: { type: "archive", archiveId: archive.id, archive },
      disabled: !!editing,
    });

  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

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
          action: () => onInsertRef(archive),
        },
        { id: "sep-actions", label: "", separator: true, action: () => {} },
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
        { id: "sep-edit", label: "", separator: true, action: () => {} },
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
        { id: "sep-delete", label: "", separator: true, action: () => {} },
        {
          id: "delete",
          label: "删除归档",
          icon: Trash2,
          action: () => onDelete(archive.id),
        },
      );

      setContextMenu({ position: { x: e.clientX, y: e.clientY }, items });
    },
    [
      archive,
      folders,
      currentFolderId,
      onDelete,
      onAddToFolder,
      onRemoveFromFolder,
      onInsertRef,
    ],
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

  // 归档所属的文件夹标签（在"全部"视图下显示）
  const folderTags = useMemo(() => {
    if (!archive.folder_ids || archive.folder_ids.length === 0) return null;
    return archive.folder_ids
      .map((fid) => folders.find((f) => f.id === fid))
      .filter(Boolean) as ArchiveFolder[];
  }, [archive.folder_ids, folders]);

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      className={`border-b border-border last:border-b-0 ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      {/* Header */}
      <div
        onClick={() => !editing && setExpanded(!expanded)}
        onContextMenu={handleContextMenu}
        className="flex items-start gap-1.5 px-3 py-2.5 cursor-pointer hover:bg-white/2 transition-colors group relative"
      >
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="shrink-0 mt-0.5 text-t-ghost/40 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={12} />
        </span>
        <span className="shrink-0 mt-0.5 text-t-muted">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-t-primary leading-relaxed line-clamp-2">
            {archive.summary || "无摘要"}
          </div>
          {/* 标签和文件夹 */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {archive.meta.label && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-neon/10 text-neon">
                <Tag size={9} />
                {archive.meta.label}
              </span>
            )}
            {folderTags &&
              !currentFolderId &&
              folderTags.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400/80"
                >
                  <Folder size={8} />
                  {f.name}
                </span>
              ))}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-t-ghost">
            <span className="flex items-center gap-1">
              <MessageSquare size={10} />
              {archive.meta.turn_count} 轮
            </span>
            <span className="flex items-center gap-1">
              <FileText size={10} />
              {archive.meta.total_messages} 条
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
        {/* Hover buttons */}
        <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-surface/90 rounded-md px-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInsertRef(archive);
            }}
            className="p-1 rounded text-t-ghost hover:text-violet-400 hover:bg-violet-500/10 transition-all"
            title="引用到输入框"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleContextMenu(e);
            }}
            className="p-1 rounded text-t-ghost hover:text-t-muted hover:bg-white/6 transition-all"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 pb-3 pl-8">
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
              <EditActions
                saving={saving}
                onSave={handleSave}
                onCancel={handleCancel}
              />
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
              <EditActions
                saving={saving}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            </div>
          ) : editing === "content" ? (
            <div className="space-y-2">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full bg-base rounded-lg p-3 text-[11px] text-t-secondary leading-relaxed resize-none border border-border focus:border-neon/50 outline-none max-h-100"
                rows={10}
                placeholder="输入内容..."
                autoFocus
              />
              <EditActions
                saving={saving}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            </div>
          ) : (
            <div className="bg-base/50 rounded-lg p-3 text-[11px] text-t-secondary leading-relaxed whitespace-pre-wrap max-h-75 overflow-y-auto scrollbar-thin">
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

// ─── 归档卡片（网格模式） ───────────────────────────────────────

function ArchiveCardItem({
  archive,
  folders,
  currentFolderId,
  onDelete,
  onAddToFolder,
  onRemoveFromFolder,
  onInsertRef,
}: ArchiveItemProps) {
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `archive-${archive.id}`,
      data: { type: "archive", archiveId: archive.id, archive },
    });

  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

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
          action: () => onInsertRef(archive),
        },
        { id: "sep-actions", label: "", separator: true, action: () => {} },
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
        { id: "sep-delete", label: "", separator: true, action: () => {} },
        {
          id: "delete",
          label: "删除归档",
          icon: Trash2,
          action: () => onDelete(archive.id),
        },
      );

      setContextMenu({ position: { x: e.clientX, y: e.clientY }, items });
    },
    [
      archive,
      folders,
      currentFolderId,
      onDelete,
      onAddToFolder,
      onRemoveFromFolder,
      onInsertRef,
    ],
  );

  // 归档所属的文件夹标签
  const folderTags = useMemo(() => {
    if (!archive.folder_ids || archive.folder_ids.length === 0) return null;
    return archive.folder_ids
      .map((fid) => folders.find((f) => f.id === fid))
      .filter(Boolean) as ArchiveFolder[];
  }, [archive.folder_ids, folders]);

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      onContextMenu={handleContextMenu}
      className={`
        relative rounded-lg border border-border bg-elevated/50 p-3
        hover:border-border hover:bg-white/3 transition-all cursor-default group
        ${isDragging ? "opacity-30" : ""}
      `}
    >
      {/* Drag handle — top-right */}
      <span
        {...attributes}
        {...listeners}
        className="absolute top-2 right-2 text-t-ghost/30 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={12} />
      </span>

      {/* Summary */}
      <div className="text-[12px] text-t-primary leading-relaxed line-clamp-3 pr-4">
        {archive.summary || "无摘要"}
      </div>

      {/* Label + Folder tags */}
      <div className="flex flex-wrap items-center gap-1 mt-2">
        {archive.meta.label && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-neon/10 text-neon">
            <Tag size={9} />
            {archive.meta.label}
          </span>
        )}
        {folderTags &&
          !currentFolderId &&
          folderTags.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400/80"
            >
              <Folder size={8} />
              {f.name}
            </span>
          ))}
      </div>

      {/* Content preview */}
      {archive.content && (
        <div className="mt-2 text-[10px] text-t-ghost leading-relaxed line-clamp-2">
          {archive.content}
        </div>
      )}

      {/* Meta footer */}
      <div className="flex items-center gap-2.5 mt-2 pt-2 border-t border-border/50 text-[10px] text-t-ghost">
        <span className="flex items-center gap-1">
          <MessageSquare size={9} />
          {archive.meta.turn_count}轮
        </span>
        <span className="flex items-center gap-1">
          <FileText size={9} />
          {archive.meta.total_messages}条
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-1">
          <Clock size={9} />
          {timeAgo(archive.created_at)}
        </span>
      </div>

      {/* Hover actions */}
      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-elevated/90 rounded-md px-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInsertRef(archive);
          }}
          className="p-1 rounded text-t-ghost hover:text-violet-400 hover:bg-violet-500/10 transition-all"
          title="引用到输入框"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleContextMenu(e);
          }}
          className="p-1 rounded text-t-ghost hover:text-t-muted hover:bg-white/6 transition-all"
        >
          <MoreHorizontal size={12} />
        </button>
      </div>

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

// ─── 拖拽覆盖层中的归档预览 ──────────────────────────────────────

function DragOverlayContent({ archive }: { archive: ArchiveEntry }) {
  return (
    <div className="rounded-lg border border-neon/40 bg-elevated shadow-lg shadow-black/30 px-3 py-2 max-w-65 pointer-events-none">
      <div className="text-[11px] text-t-primary leading-relaxed line-clamp-2">
        {archive.summary || "无摘要"}
      </div>
      {archive.meta.label && (
        <span className="inline-flex items-center gap-1 mt-1 px-1 py-0.5 rounded text-[9px] bg-neon/10 text-neon">
          <Tag size={8} />
          {archive.meta.label}
        </span>
      )}
      <div className="text-[9px] text-t-ghost mt-1">
        {archive.meta.turn_count} 轮 · {archive.meta.total_messages} 条消息
      </div>
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
  const backdropRef = useRef<HTMLDivElement>(null);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
    },
    [onClose, name, description],
  );

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
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
          {error && <div className="text-[11px] text-danger">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[12px] text-t-muted hover:bg-white/6"
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
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [folderDialog, setFolderDialog] = useState<{
    open: boolean;
    folder?: ArchiveFolder | null;
  }>({ open: false });
  const [draggingArchive, setDraggingArchive] = useState<ArchiveEntry | null>(
    null,
  );
  const [folderContextMenu, setFolderContextMenu] = useState<{
    position: { x: number; y: number };
    items: ContextMenuItem[];
  } | null>(null);

  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // ─── dnd-kit sensors ──────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  // ─── Data loading ─────────────────────────────────────────────

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
      setFolders(
        foldersResult.folders.sort((a, b) => a.sort_order - b.sort_order),
      );
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

  // ─── Filtered archives based on active tab ────────────────────

  const filteredArchives = useMemo(() => {
    if (activeTab === "all") {
      return archives;
    }
    if (activeTab === "uncategorized") {
      return archives.filter((a) => !a.folder_ids || a.folder_ids.length === 0);
    }
    // Folder tab
    return archives.filter((a) => a.folder_ids?.includes(activeTab));
  }, [archives, activeTab]);

  const uncategorizedCount = useMemo(() => {
    return archives.filter((a) => !a.folder_ids || a.folder_ids.length === 0)
      .length;
  }, [archives]);

  // ─── Archive CRUD ─────────────────────────────────────────────

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
              ? {
                  ...a,
                  folder_ids: (a.folder_ids || []).filter(
                    (id) => id !== folderId,
                  ),
                }
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

  const handleInsertRef = useCallback((archive: ArchiveEntry) => {
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
  }, []);

  // ─── Folder CRUD ──────────────────────────────────────────────

  const handleSaveFolder = useCallback(
    async (name: string, description: string) => {
      if (!rootPath) return;
      const editingFolder = folderDialog.folder;

      if (editingFolder) {
        const result = await updateArchiveFolder(editingFolder.id, {
          name,
          description,
        });
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
          setFolders((prev) =>
            [...prev, result].sort((a, b) => a.sort_order - b.sort_order),
          );
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
      // 如果删除的是当前激活的 tab，切回全部
      setActiveTab((current) => (current === folderId ? "all" : current));
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

  const handleFolderContextMenu = useCallback(
    (e: React.MouseEvent, folder: ArchiveFolder) => {
      e.preventDefault();
      e.stopPropagation();
      setFolderContextMenu({
        position: { x: e.clientX, y: e.clientY },
        items: [
          {
            id: "edit-folder",
            label: "编辑文件夹",
            icon: Pencil,
            action: () => setFolderDialog({ open: true, folder }),
          },
          { id: "sep", label: "", separator: true, action: () => {} },
          {
            id: "delete-folder",
            label: "删除文件夹",
            icon: Trash2,
            action: () => handleDeleteFolder(folder.id),
          },
        ],
      });
    },
    [handleDeleteFolder],
  );

  // ─── Drag & Drop handlers ────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const archive = event.active.data?.current?.archive as
      | ArchiveEntry
      | undefined;
    setDraggingArchive(archive || null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingArchive(null);

      const { active, over } = event;
      if (!over) return;

      const archive = active.data?.current?.archive as ArchiveEntry | undefined;
      if (!archive) return;

      const overType = over.data?.current?.type as string | undefined;

      // 拖到聊天区域 → 插入引用
      if (overType === "chat-input") {
        handleInsertRef(archive);
        return;
      }

      // 拖到文件夹 tab → 添加到文件夹
      if (overType === "folder-tab") {
        const folderId = over.data?.current?.folderId as string | undefined;
        if (!folderId || folderId === "all" || folderId === "uncategorized") {
          return;
        }

        // Check if archive is already in this folder
        if (archive.folder_ids?.includes(folderId)) {
          useNotification.getState().addNotification({
            level: "info",
            message: "该归档已在此文件夹中",
          });
          return;
        }

        handleAddToFolder(archive.id, folderId);
      }
    },
    [handleInsertRef, handleAddToFolder],
  );

  const handleDragCancel = useCallback(() => {
    setDraggingArchive(null);
  }, []);

  // ─── Render ───────────────────────────────────────────────────

  if (!visible) return null;

  const ArchiveComponent =
    viewMode === "grid" ? ArchiveCardItem : ArchiveListItem;

  const currentFolderId =
    activeTab !== "all" && activeTab !== "uncategorized"
      ? activeTab
      : undefined;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center px-3 h-9.5 border-b border-border shrink-0">
          <span className="text-[12px] text-t-muted font-medium">归档</span>
          <span className="ml-1.5 text-[10px] text-t-ghost">
            {archives.length > 0 && `${archives.length}`}
          </span>
          <div className="flex-1" />

          {/* View mode toggle */}
          <div className="flex items-center mr-1 rounded border border-border/50">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center justify-center w-6 h-6 rounded-l transition-colors ${
                viewMode === "list"
                  ? "bg-white/8 text-t-primary"
                  : "text-t-ghost hover:text-t-muted"
              }`}
              title="列表视图"
            >
              <List size={13} />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`flex items-center justify-center w-6 h-6 rounded-r transition-colors ${
                viewMode === "grid"
                  ? "bg-white/8 text-t-primary"
                  : "text-t-ghost hover:text-t-muted"
              }`}
              title="卡片视图"
            >
              <LayoutGrid size={13} />
            </button>
          </div>

          <button
            onClick={() => setFolderDialog({ open: true })}
            className="flex items-center justify-center w-6 h-6 rounded text-t-ghost hover:text-t-muted hover:bg-white/4 transition-colors"
            title="新建文件夹"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center justify-center w-6 h-6 rounded text-t-ghost hover:text-t-muted hover:bg-white/4 transition-colors disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Tab bar */}
        <div
          ref={tabsContainerRef}
          className="flex items-center gap-1 px-2 py-1.5 border-b border-border overflow-x-auto scrollbar-none shrink-0"
        >
          <TabItem
            id="all"
            label="全部"
            count={archives.length}
            icon={<Layers size={12} />}
            active={activeTab === "all"}
            onClick={() => setActiveTab("all")}
          />
          {folders.map((folder) => (
            <TabItem
              key={folder.id}
              id={folder.id}
              label={folder.name}
              count={
                archives.filter((a) => a.folder_ids?.includes(folder.id)).length
              }
              icon={<Folder size={12} />}
              active={activeTab === folder.id}
              onClick={() => setActiveTab(folder.id)}
              onContextMenu={(e) => handleFolderContextMenu(e, folder)}
              acceptDrop
            />
          ))}
          <TabItem
            id="uncategorized"
            label="未分类"
            count={uncategorizedCount}
            icon={<Inbox size={12} />}
            active={activeTab === "uncategorized"}
            onClick={() => setActiveTab("uncategorized")}
          />
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
          ) : filteredArchives.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Archive size={20} className="text-t-ghost/60" />
              <span className="text-[12px] text-t-ghost">
                {activeTab === "all"
                  ? "暂无归档"
                  : activeTab === "uncategorized"
                    ? "没有未分类的归档"
                    : "该文件夹为空"}
              </span>
              {activeTab !== "all" && activeTab !== "uncategorized" && (
                <span
                  className="text-[10
px] text-t-ghost/60"
                >
                  拖拽归档到此文件夹进行分类
                </span>
              )}
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-2 p-3">
              {filteredArchives.map((archive) => (
                <ArchiveCardItem
                  key={archive.id}
                  archive={archive}
                  folders={folders}
                  currentFolderId={currentFolderId}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onAddToFolder={handleAddToFolder}
                  onRemoveFromFolder={handleRemoveFromFolder}
                  onInsertRef={handleInsertRef}
                />
              ))}
            </div>
          ) : (
            <div>
              {filteredArchives.map((archive) => (
                <ArchiveListItem
                  key={archive.id}
                  archive={archive}
                  folders={folders}
                  currentFolderId={currentFolderId}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onAddToFolder={handleAddToFolder}
                  onRemoveFromFolder={handleRemoveFromFolder}
                  onInsertRef={handleInsertRef}
                />
              ))}
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

        {/* Folder Context Menu */}
        {folderContextMenu && (
          <ContextMenu
            position={folderContextMenu.position}
            items={folderContextMenu.items}
            onClose={() => setFolderContextMenu(null)}
          />
        )}
      </div>

      {/* Chat drop zone — only visible while dragging */}
      <ChatDropZone isActive={!!draggingArchive} />

      {/* Drag Overlay */}
      <DragOverlay dropAnimation={null}>
        {draggingArchive ? (
          <DragOverlayContent archive={draggingArchive} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
