/**
 * ChatInput — 聊天输入框 UI 组件
 *
 * 职责：纯 UI 壳 + 事件绑定
 * - 渲染 Slate 编辑器（通过 ChatInputEditor 实例）
 * - 绑定发送/取消/快捷键
 * - 监听外部事件（ftre:insert-code-ref、ftre:insert-archive-ref）
 * - 不直接操作 Slate API，全部委托给 ChatInputEditor
 * - 发送消息通过 useChat store（会自动带上 model/provider）
 * - 支持 / 触发 skill 选择弹窗
 */
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Slate, Editable } from "slate-react";
import { Range } from "slate";
import { ArrowUp, Eye, EyeOff, Zap } from "lucide-react";
import { useChat, type RetryState } from "@/stores/chat";
import { useLayout } from "@/stores/layout";
import { useWorkspace } from "@/stores/workspace";
import { fetchSkills, type SkillDef } from "@/services/api";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { TokenRing } from "./TokenRing";
import { RetryPanel } from "./RetryPanel";
import { ChatInputEditor, renderElement } from "./slate";
import type { CodeRef, ArchiveRef, SkillRef } from "./slate";

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
      className="absolute bottom-full left-0 mb-1.5 min-w-[200px] max-h-[280px] overflow-y-auto bg-elevated/95 backdrop-blur-sm border border-border-subtle rounded-lg shadow-xl py-1 z-50"
    >
      {candidates.map((skill, i) => (
        <button
          key={skill.id}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(skill);
          }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
            i === selectedIndex
              ? "bg-neon/10 text-neon"
              : "text-t-secondary hover:bg-hover"
          }`}
        >
          <Zap size={12} className="shrink-0 opacity-60" />
          <span className="text-[13px] font-mono truncate">{skill.name}</span>
        </button>
      ))}
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────

export function ChatInput() {
  const inputEditor = useMemo(() => new ChatInputEditor(), []);

  // 细粒度选择器：仅订阅各自需要的字段，避免无关状态变化触发重渲染
  const isBusy = useChat((s) => s.isBusy);
  const retryState = useChat((s) => s.retryState);
  const [retryExpanded, setRetryExpanded] = useState(false);
  const workspace = useWorkspace((s) => s.rootPath);
  const autoFollow = useLayout((s) => s.autoFollowFiles);
  const toggleAutoFollow = useLayout((s) => s.toggleAutoFollowFiles);

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
  const handleSend = useCallback(async () => {
    const state = useChat.getState();
    if (state.isBusy) return;
    const { text, codeRefs, archiveRefs, skillRefs, parts } =
      inputEditor.serialize();
    if (
      !text &&
      codeRefs.length === 0 &&
      archiveRefs.length === 0 &&
      skillRefs.length === 0
    )
      return;

    inputEditor.clear();
    setSkillSearch(null);

    // Send via chat store (which passes model/provider to streamManager)
    state.sendMessage(text);
  }, [inputEditor]);

  // ── 取消 ──
  const handleCancel = useCallback(() => {
    useChat.getState().cancelStream();
  }, []);

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

      // Send via chat store (which passes model/provider to streamManager)
      useChat.getState().sendMessage(confirmText);
    };
    window.addEventListener("ftre:plan-next-step", handler);
    return () => window.removeEventListener("ftre:plan-next-step", handler);
  }, []);

  return (
    <div className="px-6 pb-4 pt-3">
      <div className="mx-auto w-full max-w-[960px]">
        {/* RetryPanel - 在输入框上方 */}
        {retryState && (
          <RetryPanel retry={retryState} onExpandChange={setRetryExpanded} />
        )}

        <div
          className={`relative bg-panel border border-border-subtle focus-within:border-neon/30 transition-colors shadow-sm ${
            retryState && retryExpanded
              ? "rounded-b-2xl border-t-0"
              : "rounded-2xl"
          }`}
        >
          {/* Skill 弹窗 */}
          {skillSearch && skillCandidates.length > 0 && (
            <div className="absolute left-4 bottom-full z-50">
              <SkillDropdown
                candidates={skillCandidates}
                selectedIndex={skillIndex}
                onSelect={handleInsertSkill}
              />
            </div>
          )}

          {/* 编辑区 */}
          <Slate
            editor={inputEditor.editor}
            initialValue={inputEditor.initialValue}
            onChange={handleSlateChange}
          >
            <Editable
              renderElement={renderElement}
              onKeyDown={onKeyDown}
              placeholder="描述你想要做什么... 输入 / 选择 Skill"
              className="w-full bg-transparent text-[var(--text-lg)] text-t-primary outline-none resize-none px-5 py-4 font-sans overflow-y-auto overflow-x-hidden"
              style={{
                minHeight: 64,
                maxHeight: 180,
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
            />
          </Slate>

          {/* 工具栏 */}
          <div className="flex items-center justify-between px-4 py-3">
            {/* 左侧：模型选择 */}
            <div className="flex items-center gap-1">
              <ModelSelector />
            </div>

            {/* 右侧：工具按钮 & 发送 */}
            <div className="flex items-center gap-1">
              <TokenRing />
              <div className="w-px h-3.5 bg-border-subtle mx-0.5" />
              {isBusy ? (
                <button
                  onClick={handleCancel}
                  className="h-9 w-9 flex items-center justify-center rounded-lg bg-danger/12 text-danger hover:bg-danger/25 transition-colors"
                >
                  <div className="w-3 h-3 bg-current rounded-sm" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  className={`h-9 w-9 flex items-center justify-center rounded-lg transition-all ${
                    !inputEditor.isEmpty
                      ? "bg-neon text-base hover:bg-neon/80 shadow-[0_0_8px_rgba(var(--neon-rgb,56,189,248),0.22)]"
                      : "bg-surface text-t-ghost"
                  }`}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
