/**
 * ChatInput — 聊天输入框 UI 组件
 *
 * 职责：纯 UI 壳 + 事件绑定
 * - 渲染 Slate 编辑器（通过 ChatInputEditor 实例）
 * - 在编辑器之上独立维护一栏附件区（不进 Slate 富文本树）
 * - 绑定发送/取消/快捷键、粘贴/拖拽图片
 * - 监听外部事件（ftre:insert-code-ref、ftre:insert-archive-ref）
 */
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Slate, Editable } from "slate-react";
import { Range } from "slate";
import { ArrowUp, Box, ChevronRight, Paperclip, Plus, Puzzle, Search, X } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useLayout } from "@/stores/layout";
import { useWorkspace } from "@/stores/workspace";
import { useNotification } from "@/stores/notification";
import { fetchSkills, type SkillDef } from "@/services/api";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { TokenRing } from "./TokenRing";
import { WorkspaceBadge } from "./WorkspaceBadge";
import {
  ChatInputEditor,
  renderElement,
  IMAGE_MAX_PER_MESSAGE,
  type ImageRef,
  type ImageAttachmentDTO,
} from "./slate";
import type { CodeRef, ArchiveRef, SkillRef } from "./slate";
import {
  fileToImageRef,
  extractImageFiles,
  ImageValidationError,
} from "./slate/imageUtils";

// ─── Skill 候选列表组件 ────────────────────────────────────────────

function SkillDropdown({
  candidates,
  selectedIndex,
  onSelect,
}: {
  candidates: SkillDef[];
  selectedIndex: number;
  onSelect: (skill: SkillDef) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (candidates.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1.5 max-h-[320px] overflow-y-auto bg-surface border border-border rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.14)] py-1.5 z-50"
    >
      <div className="px-3 pb-1 text-[12px] leading-5 text-t-muted">
        技能
      </div>
      {candidates.map((skill, i) => (
        <button
          key={skill.id}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(skill);
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
            i === selectedIndex
              ? "bg-active text-t-primary"
              : "text-t-primary hover:bg-hover"
          }`}
        >
          <Box size={14} strokeWidth={1.9} className="shrink-0 text-t-secondary" />
          <span className="shrink-0 text-[13px] leading-5 font-medium text-t-primary truncate max-w-[240px]">
            {skill.name}
          </span>
          {skill.description && (
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-t-muted">
              {skill.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── 附件栏 ────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function AttachmentBar({
  attachments,
  onRemove,
}: {
  attachments: ImageRef[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-4 pt-3">
      {attachments.map((att) => {
        const url = `data:${att.mimeType};base64,${att.base64}`;
        return (
          <div
            key={att.id}
            className="group relative inline-flex items-center gap-2.5 pl-1.5 pr-2.5 py-1.5 rounded-xl border border-border bg-hover text-t-primary text-[13px] max-w-[280px]"
          >
            {/* 缩略图 */}
            <img
              src={url}
              alt={att.name || "image"}
              className="block w-9 h-9 rounded-lg object-cover bg-elevated shrink-0"
              draggable={false}
            />
            {/* 文件名 + 大小 */}
            <div className="flex flex-col min-w-0 leading-tight">
              <span className="truncate">{att.name || "image"}</span>
              <span className="text-t-muted text-[11px]">
                {formatBytes(att.bytes)}
              </span>
            </div>
            {/* 删除 */}
            <button
              type="button"
              onClick={() => onRemove(att.id)}
              title="移除"
              className="ml-1 inline-flex items-center justify-center w-6 h-6 rounded-full text-t-muted hover:text-t-primary hover:bg-active transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── 「+」附件/技能菜单 ────────────────────────────────────────────

function AddMenu({
  skills,
  onPickLocal,
  onPickSkill,
  onClose,
}: {
  skills: SkillDef[];
  onPickLocal: () => void;
  onPickSkill: (skill: SkillDef) => void;
  onClose: () => void;
}) {
  const [skillOpen, setSkillOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, search]);

  return (
    <div ref={rootRef} className="absolute bottom-full left-0 mb-2 z-50 flex items-start gap-2">
      {/* 主菜单 */}
      <div className="w-[230px] bg-surface border border-border-subtle rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.16)] py-1.5">
        <MenuItem
          icon={<Paperclip size={16} strokeWidth={1.8} />}
          label="从本地文件添加"
          onClick={() => { onPickLocal(); onClose(); }}
        />
        <MenuItem
          icon={<Puzzle size={16} strokeWidth={1.8} />}
          label="使用技能"
          chevron
          active={skillOpen}
          onMouseEnter={() => setSkillOpen(true)}
          onClick={() => setSkillOpen((v) => !v)}
        />
      </div>

      {/* 技能二级面板 */}
      {skillOpen && (
        <div className="w-[300px] bg-surface border border-border-subtle rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.16)] overflow-hidden">
          {/* 搜索 */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-subtle">
            <Search size={15} className="shrink-0 text-t-ghost" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索技能"
              className="flex-1 bg-transparent text-[13px] text-t-primary placeholder:text-t-ghost outline-none"
            />
          </div>
          {/* 列表 */}
          <div className="max-h-[260px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-t-ghost">
                没有匹配的技能
              </div>
            ) : (
              filtered.map((skill) => (
                <button
                  key={skill.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPickSkill(skill);
                    onClose();
                  }}
                  className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-hover transition-colors"
                >
                  <Box size={15} strokeWidth={1.8} className="shrink-0 mt-0.5 text-[#1a7f37]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-t-primary truncate">
                      {skill.name}
                    </div>
                    {skill.description && (
                      <div className="text-[12px] text-t-muted truncate mt-0.5">
                        {skill.description}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  chevron,
  active,
  onClick,
  onMouseEnter,
}: {
  icon: React.ReactNode;
  label: string;
  chevron?: boolean;
  active?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
        active ? "bg-hover" : "hover:bg-hover"
      }`}
    >
      <span className="shrink-0 text-t-secondary">{icon}</span>
      <span className="flex-1 text-[13px] text-t-primary">{label}</span>
      {chevron && <ChevronRight size={14} className="shrink-0 text-t-ghost" />}
    </button>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────

export function ChatInput() {
  const inputEditor = useMemo(() => new ChatInputEditor(), []);

  // 细粒度选择器：仅订阅各自需要的字段，避免无关状态变化触发重渲染
  const isBusy = useChat((s) => s.isBusy);
  const workspace = useWorkspace((s) => s.rootPath);
  const autoFollow = useLayout((s) => s.autoFollowFiles);
  const toggleAutoFollow = useLayout((s) => s.toggleAutoFollowFiles);

  // ── 附件栏状态 ──
  const [attachments, setAttachments] = useState<ImageRef[]>([]);

  // ── 「+」菜单状态 ──
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // ── Skill 弹窗状态 ──
  const [skillSearch, setSkillSearch] = useState<{
    search: string;
    range: Range;
  } | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const [skillList, setSkillList] = useState<SkillDef[]>([]);

  // 加载 skill 列表
  useEffect(() => {
    if (!workspace) {
      setSkillList([]);
      return;
    }
    fetchSkills(workspace).then(setSkillList);
  }, [workspace]);

  // 过滤候选 skill
  const skillCandidates = useMemo(() => {
    if (!skillSearch) return [];
    const q = skillSearch.search.toLowerCase();
    return skillList.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skillSearch, skillList]);

  // 重置选中索引
  useEffect(() => {
    setSkillIndex(0);
  }, [skillCandidates.length]);

  // 插入 skill chip
  const handleInsertSkill = useCallback(
    (skill: SkillDef) => {
      if (!skillSearch) return;
      const ref: SkillRef = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
      };
      inputEditor.insertSkillChip(ref, skillSearch.range);
      setSkillSearch(null);
      setSkillIndex(0);
    },
    [inputEditor, skillSearch],
  );

  // ── Slate onChange ──
  const handleSlateChange = useCallback(
    (value: import("slate").Descendant[]) => {
      inputEditor.onChange(value);
      setSkillSearch(inputEditor.getSkillSearch());
    },
    [inputEditor],
  );

  // ── 发送 ──
  const handleSend = useCallback(() => {
    const state = useChat.getState();
    if (state.isBusy) return;

    const { text, parts } = inputEditor.serialize();
    const hasAttachments = attachments.length > 0;
    const hasContent = parts.length > 0;
    if (!hasContent && !hasAttachments) return;

    const dto: ImageAttachmentDTO[] = attachments.map((a) => ({
      type: "image",
      mime_type: a.mimeType,
      data: a.base64,
      ...(a.name ? { name: a.name } : {}),
    }));

    inputEditor.clear();
    setSkillSearch(null);
    setAttachments([]);

    state.sendMessage(
      parts.length > 0 ? parts : [{ type: "text", data: text }],
      dto.length > 0 ? dto : undefined,
    );
  }, [inputEditor, attachments]);

  // ── 取消 ──
  const handleCancel = useCallback(() => {
    useChat.getState().cancelStream();
  }, []);

  // ── 图片附件：上传 / 粘贴 / 拖拽 共用入口 ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleAddImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // 用函数式 setState 拿到最新长度，避免闭包陈旧值
      let overflow = 0;
      let accepted: File[] = [];
      setAttachments((prev) => {
        const remaining = IMAGE_MAX_PER_MESSAGE - prev.length;
        if (remaining <= 0) {
          overflow = files.length;
          accepted = [];
          return prev;
        }
        accepted = files.slice(0, remaining);
        overflow = files.length - accepted.length;
        return prev;
      });

      if (accepted.length === 0) {
        useNotification.getState().addNotification({
          level: "warning",
          message: `最多附加 ${IMAGE_MAX_PER_MESSAGE} 张图片`,
        });
        return;
      }
      if (overflow > 0) {
        useNotification.getState().addNotification({
          level: "warning",
          message: `已忽略 ${overflow} 张：单条消息最多 ${IMAGE_MAX_PER_MESSAGE} 张`,
        });
      }

      for (const file of accepted) {
        try {
          const ref = await fileToImageRef(file);
          setAttachments((prev) => [...prev, ref]);
        } catch (err) {
          const msg =
            err instanceof ImageValidationError
              ? err.message
              : `图片处理失败: ${(err as Error).message || err}`;
          useNotification.getState().addNotification({
            level: "error",
            message: msg,
          });
        }
      }
    },
    [],
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handlePickImages = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = ""; // 允许重复选择同一文件
      handleAddImages(files);
    },
    [handleAddImages],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = extractImageFiles(e.clipboardData);
      if (files.length > 0) {
        e.preventDefault();
        handleAddImages(files);
      }
    },
    [handleAddImages],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const files = extractImageFiles(e.dataTransfer);
      setIsDragging(false);
      if (files.length === 0) return;
      e.preventDefault();
      handleAddImages(files);
    },
    [handleAddImages],
  );

  // ── 键盘 ──
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Skill 弹窗激活时的键盘导航
      if (skillSearch && skillCandidates.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSkillIndex((p) => (p + 1) % skillCandidates.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSkillIndex(
            (p) => (p - 1 + skillCandidates.length) % skillCandidates.length,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handleInsertSkill(skillCandidates[skillIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSkillSearch(null);
          return;
        }
      }

      // 正常的发送/取消
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        handleCancel();
      }
    },
    [
      skillSearch,
      skillCandidates,
      skillIndex,
      handleInsertSkill,
      handleSend,
      handleCancel,
    ],
  );

  // ── 外部事件：插入代码引用 ──
  useEffect(() => {
    const handler = (e: Event) => {
      const ref = (e as CustomEvent).detail as CodeRef;
      if (!ref) return;
      inputEditor.insertCodeChip(ref);
      inputEditor.focus();
    };
    window.addEventListener("ftre:insert-code-ref", handler);
    return () => window.removeEventListener("ftre:insert-code-ref", handler);
  }, [inputEditor]);

  // ── 外部事件：插入归档引用 ──
  useEffect(() => {
    const handler = (e: Event) => {
      const ref = (e as CustomEvent).detail as ArchiveRef;
      if (!ref) return;
      inputEditor.insertArchiveChip(ref);
      inputEditor.focus();
    };
    window.addEventListener("ftre:insert-archive-ref", handler);
    return () => window.removeEventListener("ftre:insert-archive-ref", handler);
  }, [inputEditor]);

  // ── 外部事件：回滚后回填输入框 ──
  useEffect(() => {
    const handler = (e: Event) => {
      const { parts } = (e as CustomEvent).detail as {
        parts: Array<{ type: string; data: unknown }>;
      };
      if (!parts || parts.length === 0) return;
      inputEditor.setContent(parts);
    };
    window.addEventListener("ftre:rollback-refill", handler);
    return () => window.removeEventListener("ftre:rollback-refill", handler);
  }, [inputEditor]);

  // ── 外部事件：Plan 模式下一步按钮 ──
  useEffect(() => {
    const handler = (e: Event) => {
      const { step } = (e as CustomEvent).detail as {
        step: string;
        label: string;
      };
      if (!step) return;
      const confirmText =
        step === "execute" ? "确认任务，开始执行" : `确认，进入下一步: ${step}`;
      useChat.getState().sendMessage(confirmText);
    };
    window.addEventListener("ftre:plan-next-step", handler);
    return () => window.removeEventListener("ftre:plan-next-step", handler);
  }, []);

  const canSend = !inputEditor.isEmpty || attachments.length > 0;

  return (
    <div className="px-6 pb-4 pt-3">
      <div className="mx-auto w-full max-w-[960px]">

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative bg-panel border border-border-subtle focus-within:border-neon/30 transition-colors shadow-sm rounded-3xl ${
            isDragging ? "border-neon/50 ring-1 ring-neon/30" : ""
          }`}
        >
          {/* Skill 弹窗 */}
          {skillSearch && skillCandidates.length > 0 && (
            <SkillDropdown
              candidates={skillCandidates}
              selectedIndex={skillIndex}
              onSelect={handleInsertSkill}
            />
          )}

          {/* 附件栏（位于编辑器上方，独立于 Slate） */}
          <AttachmentBar
            attachments={attachments}
            onRemove={handleRemoveAttachment}
          />

          {/* 编辑区 */}
          <Slate
            editor={inputEditor.editor}
            initialValue={inputEditor.initialValue}
            onChange={handleSlateChange}
          >
            <Editable
              renderElement={renderElement}
              onKeyDown={onKeyDown}
              onPaste={handlePaste}
              placeholder="描述你想要做什么... 输入 / 选择 Skill"
              className="w-full bg-transparent text-[var(--text-md)] text-t-primary outline-none resize-none px-5 py-4 font-sans overflow-y-auto overflow-x-hidden"
              style={{
                minHeight: 64,
                maxHeight: 180,
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
            />
          </Slate>

          {/* 隐藏的图片选择器 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />

          {/* 拖拽到输入框时的视觉提示 */}
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl bg-hover border-2 border-dashed border-neon/50 text-t-primary text-sm">
              松开以添加图片
            </div>
          )}

          {/* 工具栏 */}
          <div className="flex items-center justify-between px-4 py-3">
            {/* 左侧：附件菜单 + 当前工作区（只读） */}
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAddMenuOpen((v) => !v)}
                  title="添加文件 / 技能"
                  className={`h-8 w-8 flex items-center justify-center rounded-full transition-colors ${
                    addMenuOpen
                      ? "bg-[#e7e7e8] text-t-primary"
                      : "text-t-secondary hover:text-t-primary hover:bg-[#e7e7e8]"
                  }`}
                >
                  <Plus size={17} strokeWidth={2} />
                </button>
                {addMenuOpen && (
                  <AddMenu
                    skills={skillList}
                    onPickLocal={handlePickImages}
                    onPickSkill={(skill) =>
                      inputEditor.insertSkillChipAtEnd({
                        id: skill.id,
                        name: skill.name,
                        description: skill.description,
                      })
                    }
                    onClose={() => setAddMenuOpen(false)}
                  />
                )}
              </div>
              <WorkspaceBadge />
            </div>

            {/* 右侧：模型选择 + 上下文用量 + 发送 */}
            <div className="flex items-center gap-1.5">
              <ModelSelector />
              <div className="w-px h-3.5 bg-border-subtle mx-1" />
              <TokenRing />
              {isBusy ? (
                <button
                  onClick={handleCancel}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-t-primary/10 text-t-primary hover:bg-t-primary/20 transition-colors"
                >
                  <div className="w-3 h-3 bg-current rounded-sm" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  className={`h-8 w-8 flex items-center justify-center rounded-full transition-all ${
                    canSend
                      ? "bg-neon text-base hover:bg-neon/80 shadow-[0_0_8px_rgba(var(--neon-rgb,56,189,248),0.22)]"
                      : "bg-surface text-t-ghost"
                  }`}
                >
                  <ArrowUp size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
