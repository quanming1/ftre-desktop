/**
 * AgentSelector — Agent 选择器
 *
 * agent 列表存在 chat store 中全局共享，组件只读 store，不维护 local state。
 */
import { useState, useEffect, useRef } from "react";
import { Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";

export function AgentSelector() {
  const agentId = useChat((s) => s.agentId);
  const agents = useChat((s) => s.agents);
  const setAgentId = useChat((s) => s.setAgentId);
  const fetchAgents = useChat((s) => s.fetchAgents);
  const sessionId = useChat((s) => s.sessionId);
  const sessions = useSession((s) => s.sessions);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find((s) => s.session_id === sessionId);
  const isScheduled = currentSession?.source === "scheduled";

  // 首次挂载时拉取一次
  useEffect(() => {
    if (agents.length === 0) {
      fetchAgents();
    }
  }, []);

  // 每次展开时刷新
  useEffect(() => {
    if (open) {
      fetchAgents();
    }
  }, [open]);

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

  const current = agents.find((a) => a.id === agentId) || agents[0];
  const builtinAgents = agents.filter((a) => a.is_builtin);
  const customAgents = agents.filter((a) => !a.is_builtin);

  const handleSelect = (id: string) => {
    setAgentId(id);
    setOpen(false);
  };

  if (isScheduled) {
    return (
      <div className="flex items-center gap-1.5 text-[13px] h-8 px-3 rounded-full font-mono text-t-dim cursor-default opacity-60">
        {current?.name || agentId}
      </div>
    );
  }

  const itemClass = (isActive: boolean) =>
    `w-full px-3 py-1.5 text-left text-[13px] font-mono flex items-center justify-between rounded-lg transition-all duration-150 ${
      isActive
        ? "text-[#1a1a1a] bg-[#e2e2e3]"
        : "text-t-secondary hover:text-t-primary hover:bg-hover"
    }`;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[13px] h-8 px-3 rounded-full font-mono transition-colors duration-150 text-t-secondary hover:text-t-primary hover:bg-[#e7e7e8]"
      >
        <span className="truncate max-w-[120px]">{current?.name || agentId}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="absolute bottom-full left-0 mb-1.5 w-[200px] bg-elevated border border-border-subtle rounded-xl overflow-hidden shadow-2xl z-[100] p-1.5"
          >
            <div className="max-h-[320px] overflow-y-auto">
              {builtinAgents.map((agent) => {
                const isActive = agentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => handleSelect(agent.id)}
                    className={itemClass(isActive)}
                  >
                    <span className="truncate">{agent.name}</span>
                    {isActive && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}

              {customAgents.length > 0 && (
                <>
                  {builtinAgents.length > 0 && (
                    <div className="mx-1.5 my-1 border-t border-border-subtle" />
                  )}
                  <div className="px-2 pt-1.5 pb-1 text-[11px] text-t-ghost uppercase tracking-wider font-medium">
                    自定义
                  </div>
                  {customAgents.map((agent) => {
                    const isActive = agentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        onClick={() => handleSelect(agent.id)}
                        className={itemClass(isActive)}
                      >
                        <span className="truncate">{agent.name}</span>
                        {isActive && <Check size={14} className="shrink-0" />}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
