/**
 * ChatInput — 聊天输入框 UI 组件
 *
 * 职责：纯 UI 壳 + 事件绑定
 * - 渲染 Slate 编辑器（通过 ChatInputEditor 实例）
 * - 绑定发送/取消/快捷键
 * - 监听外部事件（ftre:insert-code-ref、ftre:insert-archive-ref）
 * - 不直接操作 Slate API，全部委托给 ChatInputEditor
 * - 发送/取消流全部委托给 streamManager
 */
import { useCallback, useEffect, useMemo } from "react";
import { Slate, Editable } from "slate-react";
import { ArrowUp, Eye, EyeOff } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useLayout } from "@/stores/layout";
import { useWorkspace } from "@/stores/workspace";
import { streamManager } from "@/services/stream-manager";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { TokenRing } from "./TokenRing";
import { ChatInputEditor, renderElement } from "./slate";
import type { CodeRef, ArchiveRef } from "./slate";

export function ChatInput() {
  const inputEditor = useMemo(() => new ChatInputEditor(), []);

  // 细粒度选择器：仅订阅各自需要的字段，避免无关状态变化触发重渲染
  const isStreaming = useChat((s) => s.isStreaming);
  const workspace = useWorkspace((s) => s.rootPath);
  const autoFollow = useLayout((s) => s.autoFollowFiles);
  const toggleAutoFollow = useLayout((s) => s.toggleAutoFollowFiles);

  // ── 发送 ──
  const handleSend = useCallback(async () => {
    const state = useChat.getState();
    if (state.isStreaming) return;
    const { text, codeRefs, archiveRefs, parts } = inputEditor.serialize();
    if (!text && codeRefs.length === 0 && archiveRefs.length === 0) return;

    inputEditor.clear();

    await streamManager.sendMessage({
      message: parts,
      text,
      codeRefs: codeRefs.length > 0 ? codeRefs : undefined,
      parts,
      model: state.model,
      workspace,
      agentId: state.agentId,
    });
  }, [workspace, inputEditor]);

  // ── 取消 ──
  const handleCancel = useCallback(async () => {
    await streamManager.cancelStream();
  }, []);

  // ── 键盘 ──
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSend, handleCancel],
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
      const parts = [{ type: "text" as const, data: confirmText }];
      const state = useChat.getState();

      streamManager.sendMessage({
        message: parts,
        text: confirmText,
        parts,
        model: state.model,
        workspace,
        agentId: state.agentId,
      });
    };
    window.addEventListener("ftre:plan-next-step", handler);
    return () => window.removeEventListener("ftre:plan-next-step", handler);
  }, [workspace]);

  return (
    <div className="px-4 pb-3 pt-2">
      <div className="relative bg-panel rounded-2xl border border-border-subtle focus-within:border-neon/30 transition-colors shadow-sm">
        {/* 编辑区 */}
        <Slate
          editor={inputEditor.editor}
          initialValue={inputEditor.initialValue}
          onChange={inputEditor.onChange}
        >
          <Editable
            renderElement={renderElement}
            onKeyDown={onKeyDown}
            placeholder="描述你想要做什么..."
            className="w-full bg-transparent text-[14px] text-t-primary outline-none resize-none px-4 py-3 font-sans overflow-y-auto overflow-x-hidden"
            style={{
              minHeight: 42,
              maxHeight: 120,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          />
        </Slate>

        {/* 工具栏 */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.04]">
          {/* 左侧：Agent & 模型选择 */}
          <div className="flex items-center gap-1">
            <AgentSelector />
            <div className="w-px h-3.5 bg-white/[0.08] mx-0.5" />
            <ModelSelector />
          </div>

          {/* 右侧：工具按钮 & 发送 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleAutoFollow}
              title={
                autoFollow ? "自动跟踪文件变更: 开" : "自动跟踪文件变更: 关"
              }
              className={`flex items-center h-7 w-7 justify-center rounded-lg transition-colors ${
                autoFollow
                  ? "text-neon/70 hover:text-neon hover:bg-neon-ghost"
                  : "text-t-ghost hover:text-t-muted hover:bg-white/[0.06]"
              }`}
            >
              {autoFollow ? (
                <Eye size={14} strokeWidth={1.5} />
              ) : (
                <EyeOff size={14} strokeWidth={1.5} />
              )}
            </button>
            <TokenRing />
            <div className="w-px h-3.5 bg-white/[0.08] mx-0.5" />
            {isStreaming ? (
              <button
                onClick={handleCancel}
                className="h-7 w-7 flex items-center justify-center rounded-lg bg-danger/15 text-danger hover:bg-danger/25 transition-colors"
              >
                <div className="w-2.5 h-2.5 bg-current rounded-sm" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                className={`h-7 w-7 flex items-center justify-center rounded-lg transition-all ${
                  !inputEditor.isEmpty
                    ? "bg-neon text-base hover:bg-neon/80 shadow-[0_0_8px_rgba(var(--neon-rgb,56,189,248),0.25)]"
                    : "bg-white/[0.06] text-t-ghost"
                }`}
              >
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
