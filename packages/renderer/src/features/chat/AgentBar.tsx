/**
 * AgentBar — 合并 Agent + Model 选择的单个胶囊按钮
 *
 * 点击展开面板：
 * - Header: Agent 名称（点击展开 Agent 列表切换）
 * - 当前模型 + [切换] 按钮（点击展开 ModelPicker）
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { fetchAppConfig } from "@/services/api";
import { ModelPicker, type ProviderInfo } from "./ModelPicker";
import { buildProviderInfos } from "./providerInfo";
import { OPEN_SETTINGS_EVENT } from "@/app/settings-events";

export function AgentBar() {
  const agentId = useChat((s) => s.agentId);
  const agents = useChat((s) => s.agents);
  const model = useChat((s) => s.model);
  const provider = useChat((s) => s.provider);
  const setAgentId = useChat((s) => s.setAgentId);
  const setModel = useChat((s) => s.setModel);
  const setProvider = useChat((s) => s.setProvider);
  const setContextWindow = useChat((s) => s.setContextWindow);
  const fetchAgents = useChat((s) => s.fetchAgents);
  const updateAgentLlm = useChat((s) => s.updateAgentLlm);

  const sessionId = useChat((s) => s.sessionId);
  const sessions = useSession((s) => s.sessions);

  const [panelOpen, setPanelOpen] = useState(false);
  const [agentListOpen, setAgentListOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find((s) => s.session_id === sessionId);
  const isScheduled = currentSession?.source === "scheduled";

  const current = agents.find((a) => a.id === agentId) || agents[0];
  const builtinAgents = agents.filter((a) => a.is_builtin);
  const customAgents = agents.filter((a) => !a.is_builtin);

  // 首次挂载拉取 agents + 初始化 model/provider
  useEffect(() => {
    if (agents.length === 0) {
      fetchAgents().then(() => {
        // fetchAgents 完成后，如果 model 还是 null，从当前 agent 读
        const state = useChat.getState();
        if (!state.model) {
          const current = state.agents.find((a) => a.id === state.agentId) || state.agents[0];
          if (current?.model) {
            state.setModel(current.model);
            state.setProvider(current.provider || "");
          }
        }
      });
    }
  }, []);

  // 拉取 providers（用于 ModelPicker）
  const loadProviders = useCallback(async () => {
    const config = await fetchAppConfig();
    if (config && Object.keys(config).length > 0) {
      setProviders(buildProviderInfos(config.providers));
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // 面板展开时刷新 agents
  useEffect(() => {
    if (panelOpen) {
      fetchAgents();
    }
  }, [panelOpen]);

  // 点击外部关闭
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
        setAgentListOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelOpen]);

  // 模型显示名
  const modelDisplayName = (() => {
    if (!model) return "选择模型";
    for (const p of providers) {
      const m = p.models.find((mm) => mm.id === model);
      if (m) return m.name || m.id;
    }
    return model.length > 20 ? model.slice(0, 18) + "…" : model;
  })();

  const findContextWindow = (providerName: string, modelId: string): number | null => {
    const p = providers.find((x) => x.name === providerName);
    const m = p?.models.find((mm) => mm.id === modelId);
    return typeof m?.context_window === "number" ? m.context_window : null;
  };

  const handleSelectModel = async (providerName: string, modelId: string) => {
    setModel(modelId);
    setProvider(providerName);
    setContextWindow(findContextWindow(providerName, modelId));
    await updateAgentLlm(providerName, modelId);
  };

  const handleSelectAgent = (id: string) => {
    setAgentId(id);
    setAgentListOpen(false);
    const selected = agents.find((a) => a.id === id);
    if (selected?.model) {
      setModel(selected.model);
      setProvider(selected.provider || "");
      setContextWindow(findContextWindow(selected.provider || "", selected.model));
    }
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
        ? "text-t-primary font-medium"
        : "text-t-secondary hover:text-t-primary hover:bg-hover"
    }`;

  return (
    <div className="relative" ref={panelRef}>
      {/* 胶囊按钮 */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className="flex items-center gap-1.5 text-[13px] h-8 px-3 rounded-full font-mono transition-colors duration-150 text-t-secondary hover:text-t-primary hover:bg-[#e7e7e8]"
      >
        <span className="truncate max-w-[100px]">{current?.name || agentId}</span>
        <span className="text-t-ghost">/</span>
        <span className="truncate max-w-[100px]">{modelDisplayName}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </button>

      <AnimatePresence>
        {panelOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-full right-0 mb-1.5 w-[280px] bg-elevated border border-border-subtle rounded-2xl shadow-2xl z-[100]"
          >
            {/* Header: Agent 名称（点击展开 Agent 列表） */}
            <div className="px-2 pt-2">
              <button
                onClick={() => setAgentListOpen(!agentListOpen)}
                className="w-full px-3 py-2.5 flex items-center justify-between rounded-xl hover:bg-hover transition-colors duration-150 group"
              >
                <span className="text-[14px] font-semibold text-t-primary truncate">{current?.name || agentId}</span>
                <ChevronDown
                  size={14}
                  className={`shrink-0 text-t-ghost group-hover:text-t-secondary transition-all duration-150 ${agentListOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            <AnimatePresence>
              {agentListOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-1.5 pb-2 max-h-[200px] overflow-y-auto">
                    {builtinAgents.map((agent) => {
                      const isActive = agentId === agent.id;
                      return (
                        <button
                          key={agent.id}
                          onClick={() => handleSelectAgent(agent.id)}
                          className={itemClass(isActive)}
                        >
                          <span className="truncate">{agent.name}</span>
                          {isActive && <Check size={14} className="shrink-0 text-[var(--ftre-accent-default)]" />}
                        </button>
                      );
                    })}
                    {customAgents.length > 0 && (
                      <>
                        {builtinAgents.length > 0 && (
                          <div className="mx-2.5 my-1.5 border-t border-border-subtle/60" />
                        )}
                        <div className="px-3 pt-2 pb-1 text-[11px] text-t-ghost uppercase tracking-wider font-medium">
                          自定义
                        </div>
                        {customAgents.map((agent) => {
                          const isActive = agentId === agent.id;
                          return (
                            <button
                              key={agent.id}
                              onClick={() => handleSelectAgent(agent.id)}
                              className={itemClass(isActive)}
                            >
                              <span className="truncate">{agent.name}</span>
                              {isActive && <Check size={14} className="shrink-0 text-[var(--ftre-accent-default)]" />}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 模型行 — 卡片式底栏 */}
            <div className="mx-2 mb-2 mt-0.5 rounded-xl bg-hover/60 border border-border-subtle/40">
              <div className="px-3.5 py-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-t-ghost font-medium tracking-wide">模型</div>
                  <div className="text-[13px] text-t-primary font-mono truncate mt-0.5">
                    {modelDisplayName}
                  </div>
                </div>
                <ModelPicker
                  providers={providers}
                  selected={
                    model && provider
                      ? { provider, modelId: model }
                      : null
                  }
                  onSelect={handleSelectModel}
                  onOpenSettings={() => {
                    window.dispatchEvent(
                      new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: "models" } }),
                    );
                  }}
                  placement="top"
                  panelWidthClass="w-[280px]"
                  renderTrigger={({ toggle }) => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                      }}
                      className="shrink-0 ml-3 text-[12px] px-3 py-1.5 rounded-lg font-medium text-t-secondary hover:text-t-primary bg-elevated hover:bg-active border border-border-subtle/60 hover:border-border-subtle transition-all duration-150"
                    >
                      切换
                    </button>
                  )}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
