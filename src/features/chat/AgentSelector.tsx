/**
 * AgentSelector — Agent 选择器
 *
 * 显示在 ChatInput 工具栏中，允许用户选择使用哪个 Agent。
 * 列表内容：内置 agent（code_agent、plan_agent）+ 当前 workspace 下的自定义 agent。
 *
 * 当 session.source === "scheduled"（定时任务创建的会话）时，
 * 禁用下拉切换，固定展示该任务使用的 agent。
 */
import { useState, useEffect, useRef, memo } from "react";
import { Lock } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { useWorkspace } from "@/stores/workspace";
import { fetchChatAgents } from "@/services/api";
import type { ChatAgent } from "@/services/api";

export const AgentSelector = memo(function AgentSelector() {
  const agentId = useChat((s) => s.agentId);
  const setAgentId = useChat((s) => s.setAgentId);
  const sessionId = useChat((s) => s.sessionId);
  const workspace = useWorkspace((s) => s.rootPath);
  const sessions = useSession((s) => s.sessions);
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // 判断当前 session 是否是定时任务创建的
  const currentSession = sessions.find((s) => s.session_id === sessionId);
  const isScheduled = currentSession?.source === "scheduled";

  // workspace 变化时重新加载 agent 列表并重置选中
  useEffect(() => {
    if (workspace) {
      fetchChatAgents(workspace).then(setAgents);
    } else {
      setAgents([]);
    }
    setAgentId("code_agent");
  }, [workspace, setAgentId]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 从全量 agents 列表中查找当前 agent（不做 send_email 过滤）
  const current = agents.find((a) => a.id === agentId) || agents[0];
  const builtinAgents = agents.filter((a) => a.is_builtin);
  const customAgents = agents.filter(
    (a) => !a.is_builtin && a.tools?.includes("send_email")
  );

  // scheduled session：锁定展示，不可切换
  if (isScheduled) {
    return (
      <div className="flex items-center gap-1 text-[13px] h-7 px-2.5 rounded-md font-mono text-t-dim cursor-default" title="任务会话，不可切换 Agent">
        {current?.name || agentId}
        <Lock size={10} className="shrink-0 text-t-ghost" />
      </div>
    );
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[13px] h-7 px-2.5 rounded-md font-mono transition-colors duration-150 text-t-muted hover:text-t-primary hover:bg-white/[0.05]"
      >
        {current?.name || "Code Agent"}
        <svg width="6" height="4" viewBox="0 0 6 4" className="shrink-0">
          <path d="M0.5 0.5L3 3.5L5.5 0.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 w-[180px] max-h-[320px] bg-elevated border border-border-subtle rounded-xl overflow-hidden flex flex-col shadow-2xl z-[100]"
          style={{ animation: "fadeIn 0.1s ease-out" }}
        >
          <div className="flex-1 overflow-y-auto py-1">
            {/* 内置 Agent */}
            {builtinAgents.map((agent) => {
              const isActive = agentId === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => { setAgentId(agent.id); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-[13px] font-mono transition-colors duration-150 truncate ${
                    isActive ? "text-neon bg-neon-ghost" : "text-t-primary hover:bg-white/[0.04]"
                  }`}
                >
                  {agent.name}
                </button>
              );
            })}

            {/* 分隔线 + 自定义 Agent */}
            {customAgents.length > 0 && (
              <>
                <div className="mx-3 my-1 border-t border-white/[0.06]" />
                {customAgents.map((agent) => {
                  const isActive = agentId === agent.id;
                  return (
                    <button
                      key={agent.id}
                      onClick={() => { setAgentId(agent.id); setOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-[13px] font-mono transition-colors duration-150 truncate ${
                        isActive ? "text-neon bg-neon-ghost" : "text-t-primary hover:bg-white/[0.04]"
                      }`}
                    >
                      {agent.name}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
