/**
 * AgentBar — Agent 信息看板 + 模型/Agent 切换
 *
 * 胶囊按钮: AgentName / ModelName ▾
 * 展开面板: 名称、ID、模型、工具权限、MCP连接、工作区
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

  useEffect(() => {
    if (agents.length === 0) {
      fetchAgents().then(() => {
        const state = useChat.getState();
        if (!state.model) {
          const cur = state.agents.find((a) => a.id === state.agentId) || state.agents[0];
          if (cur?.model) {
            state.setModel(cur.model);
            state.setProvider(cur.provider || "");
          }
        }
      });
    }
  }, []);

  const loadProviders = useCallback(async () => {
    const config = await fetchAppConfig();
    if (config && Object.keys(config).length > 0) {
      setProviders(buildProviderInfos(config.providers));
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (panelOpen) fetchAgents();
  }, [panelOpen]);

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

  const agentItemClass = (isActive: boolean) =>
    `w-full px-3 py-1.5 text-left text-[13px] font-mono flex items-center justify-between rounded-lg transition-all duration-150 ${
      isActive
        ? "text-[#1a1a1a] bg-[#e2e2e3]"
        : "text-t-secondary hover:text-t-primary hover:bg-hover"
    }`;

  const sectionLabel = "text-[11px] text-t-ghost uppercase tracking-wider font-medium";
  const sectionValue = "text-[12.5px] text-t-secondary font-mono mt-1 leading-relaxed";

  return (
    <div className="relative" ref={panelRef}>
      {/* 胶囊按钮 */}
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        className="flex items-center gap-1.5 text-[13px] h-8 px-3 rounded-full font-mono transition-colors duration-150 text-t-secondary hover:text-t-primary hover:bg-[#e7e7e8]"
      >
        <span className="truncate max-w-[100px]">{current?.name || agentId}</span>
        <span className="text-t-ghost">/</span>
        <span className="truncate max-w-[100px] text-[12px] text-t-ghost">{modelDisplayName}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </button>

      <AnimatePresence>
        {panelOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="absolute bottom-full right-0 mb-1.5 w-[300px] bg-elevated border border-border-subtle rounded-xl shadow-2xl z-[100]"
          >
            {/* ── 身份区 ── */}
            <button
              onClick={() => setAgentListOpen(!agentListOpen)}
              className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-hover transition-colors duration-150"
            >
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[14px] font-semibold text-t-primary truncate">
                  {current?.name || agentId}
                </div>
                <div className="text-[11px] text-t-ghost font-mono truncate">{current?.id || agentId}</div>
              </div>
              <ChevronDown
                size={14}
                className={`shrink-0 opacity-60 transition-transform duration-150 ${agentListOpen ? "rotate-180" : ""}`}
              />
            </button>

            <AnimatePresence>
              {agentListOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-1.5 pb-1.5 max-h-[200px] overflow-y-auto">
                    {builtinAgents.map((agent) => {
                      const isActive = agentId === agent.id;
                      return (
                        <button
                          key={agent.id}
                          onClick={() => handleSelectAgent(agent.id)}
                          className={agentItemClass(isActive)}
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
                              onClick={() => handleSelectAgent(agent.id)}
                              className={agentItemClass(isActive)}
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

            {/* ── 信息区 ── */}
            <div className="px-4 py-3 space-y-3 border-t border-border-subtle">
              {/* 模型 */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className={sectionLabel}>模型</div>
                  <div className={sectionValue}>{modelDisplayName}</div>
                  {provider && (
                    <div className="text-[11px] text-t-ghost mt-0.5">{provider}</div>
                  )}
                </div>
                <ModelPicker
                  providers={providers}
                  selected={model && provider ? { provider, modelId: model } : null}
                  onSelect={handleSelectModel}
                  onOpenSettings={() => {
                    window.dispatchEvent(
                      new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: "models" } }),
                    );
                  }}
                  placement="top"
                  panelWidthClass="w-[300px]"
                  renderTrigger={({ toggle }) => (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                      }}
                      className="shrink-0 text-[12px] px-2.5 py-1 rounded-md text-t-secondary hover:text-t-primary hover:bg-hover transition-colors duration-150"
                    >
                      切换
                    </button>
                  )}
                />
              </div>

              {/* 工具权限 */}
              <div>
                <div className={sectionLabel}>工具权限</div>
                <div className={sectionValue}>
                  {current?.tools_allow && current.tools_allow.length > 0 ? (
                    <span className="text-t-primary">{current.tools_allow.join(", ")}</span>
                  ) : (
                    <span>全部可用</span>
                  )}
                  {current?.tools_deny && current.tools_deny.length > 0 && (
                    <div className="text-[11px] text-t-ghost mt-0.5">
                      禁用: {current.tools_deny.join(", ")}
                    </div>
                  )}
                </div>
              </div>

              {/* MCP 连接 */}
              {current?.mcp_servers && current.mcp_servers.length > 0 && (
                <div>
                  <div className={sectionLabel}>MCP 连接</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {current.mcp_servers.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#e8e8ea] text-t-secondary"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 工作区 */}
              {current?.workspace && (
                <div>
                  <div className={sectionLabel}>工作区</div>
                  <div className={`${sectionValue} truncate`} title={current.workspace}>
                    {current.workspace}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
