/**
 * AgentBar — 输入框底部的 Agent 与 LLM 快捷切换入口。
 *
 * Agent 和 LLM 分开呈现，避免把模型、推理强度和 Agent 详情塞进同一个大面板；
 * 选择动作仍复用 chat store 的现有更新路径，保证只改变输入区的交互外观。
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { fetchAppConfig, fetchModelCatalog } from "@/services/api";
import { ModelPicker, type ProviderInfo } from "./ModelPicker";
import { buildProviderInfos, resolveEffortOnModelSwitch } from "./providerInfo";
import { useLayout } from "@/stores/layout";
import { FloatingMenu } from "@ftre/ui";

const EFFORT_LABELS: Record<string, string> = {
  "": "默认",
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中等",
  high: "高级",
  very_high: "极高",
  veryhigh: "极高",
  xhigh: "极高",
  max: "最大",
};

const HOVER_MENU_EVENT = "ftre:chat-hover-menu";
const HOVER_CLOSE_DELAY_MS = 80;

function getEffortLabel(value: string): string {
  return EFFORT_LABELS[value] ?? (value || "默认");
}

function normalizeEffortValues(values: string[]): string[] {
  return values.includes("") ? values : ["", ...values];
}

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

  const [agentOpen, setAgentOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const llmAnchorRef = useRef<HTMLButtonElement>(null);
  const agentAnchorRef = useRef<HTMLDivElement>(null);
  const effortAnchorRef = useRef<HTMLDivElement>(null);
  const agentHoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effortHoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentSession = sessions.find((s) => s.session_id === sessionId);
  const isScheduled = currentSession?.source === "scheduled";

  const current = agents.find((a) => a.id === agentId) || agents[0];
  const builtinAgents = agents.filter((a) => a.is_builtin);
  const customAgents = agents.filter((a) => !a.is_builtin);

  useEffect(() => {
    if (agents.length === 0) {
      fetchAgents().then(async () => {
        const state = useChat.getState();
        if (!state.model) {
          const cur = state.agents.find((a) => a.id === state.agentId) || state.agents[0];
          if (cur?.model) {
            state.setModel(cur.model);
            state.setProvider(cur.provider || "");
            // 确保 providers 已加载，再查 contextWindow。
            const config = await fetchAppConfig();
            if (config && Object.keys(config).length > 0) {
              const provs = buildProviderInfos(config.providers);
              setProviders(provs);
              const p = provs.find((x) => x.name === (cur.provider || ""));
              const m = p?.models.find((mm) => mm.id === cur.model);
              state.setContextWindow(typeof m?.context_window === "number" ? m.context_window : null);
            }
          }
        }
      });
    }
  }, []);

  const loadProviders = useCallback(async () => {
    const catalog = await fetchModelCatalog();
    if (catalog) {
      const providerMap = Object.fromEntries(
        catalog.providers.map((item) => [item.name, item]),
      );
      setProviders(buildProviderInfos(providerMap));
      return;
    }
    const config = await fetchAppConfig();
    if (config && Object.keys(config).length > 0) {
      setProviders(buildProviderInfos(config.providers));
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (llmOpen) void loadProviders();
  }, [llmOpen, loadProviders]);

  // 每次打开 Agent 菜单都刷新列表，保留原有自定义 Agent 的即时发现行为。
  useEffect(() => {
    if (agentOpen) void fetchAgents();
  }, [agentOpen, fetchAgents]);

  // providers 异步加载后，补齐当前模型的上下文窗口，供 TokenRing 使用。
  useEffect(() => {
    if (providers.length === 0) return;
    const state = useChat.getState();
    if (state.contextWindow === null && state.model && state.provider) {
      const p = providers.find((x) => x.name === state.provider);
      const m = p?.models.find((mm) => mm.id === state.model);
      if (typeof m?.context_window === "number") {
        state.setContextWindow(m.context_window);
      }
    }
  }, [providers]);

  useEffect(() => {
    if (!agentOpen && !llmOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      const targetElement = event.target instanceof Element ? event.target : null;
      if (
        targetElement?.closest("[data-ftre-floating-menu]") ||
        rootRef.current?.contains(target) ||
        llmAnchorRef.current?.contains(target)
      ) {
        return;
      }
      setAgentOpen(false);
      setLlmOpen(false);
      setEffortOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [agentOpen, effortOpen, llmOpen]);

  const modelDisplayName = (() => {
    if (!model) return "选择模型";
    for (const p of providers) {
      const m = p.models.find((mm) => mm.id === model);
      if (m) return m.name || m.id;
    }
    return model.length > 20 ? model.slice(0, 18) + "…" : model;
  })();

  const currentModelEffortValues = (() => {
    if (!model || !provider) return [];
    const p = providers.find((x) => x.name === provider);
    const m = p?.models.find((mm) => mm.id === model);
    return m?.reasoning_effort_values ?? [];
  })();

  const currentEffort = current?.reasoning_effort || "";
  const currentEffortLabel = getEffortLabel(currentEffort);
  const effortValues = currentModelEffortValues.length > 0
    ? normalizeEffortValues(currentModelEffortValues)
    : [];

  const resolveModelName = (providerName: string | undefined, modelId: string | undefined): string => {
    if (!modelId) return "";
    const p = providers.find((x) => x.name === (providerName || ""));
    const m = p?.models.find((mm) => mm.id === modelId);
    return m?.name || (modelId.length > 20 ? modelId.slice(0, 18) + "…" : modelId);
  };

  const findContextWindow = (providerName: string, modelId: string): number | null => {
    const p = providers.find((x) => x.name === providerName);
    const m = p?.models.find((mm) => mm.id === modelId);
    return typeof m?.context_window === "number" ? m.context_window : null;
  };

  const handleSelectModel = async (providerName: string, modelId: string) => {
    setModel(modelId);
    setProvider(providerName);
    setContextWindow(findContextWindow(providerName, modelId));

    // 新模型不支持当前推理强度时清空，避免旧值导致请求参数非法。
    const p = providers.find((x) => x.name === providerName);
    const m = p?.models.find((mm) => mm.id === modelId);
    const nextEffort = resolveEffortOnModelSwitch(currentEffort, m?.reasoning_effort_values);
    await updateAgentLlm(providerName, modelId, nextEffort);
    setLlmOpen(false);
    setEffortOpen(false);
  };

  const handleSelectEffort = async (effort: string) => {
    if (!model || !provider) return;
    setEffortOpen(false);
    await updateAgentLlm(provider, model, effort);
  };

  const handleSelectAgent = (id: string) => {
    setAgentId(id);
    setAgentOpen(false);
    const selected = agents.find((a) => a.id === id);
    if (selected?.model) {
      setModel(selected.model);
      setProvider(selected.provider || "");
      setContextWindow(findContextWindow(selected.provider || "", selected.model));
    }
  };

  const toggleLlm = () => {
    window.dispatchEvent(new CustomEvent(HOVER_MENU_EVENT, { detail: "close-all" }));
    clearAgentHoverClose();
    setAgentOpen(false);
    setEffortOpen(false);
    setLlmOpen((open) => !open);
  };

  const clearAgentHoverClose = useCallback(() => {
    if (agentHoverCloseTimerRef.current) {
      clearTimeout(agentHoverCloseTimerRef.current);
      agentHoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleAgentHoverClose = useCallback(() => {
    clearAgentHoverClose();
    agentHoverCloseTimerRef.current = setTimeout(() => {
      setAgentOpen(false);
      agentHoverCloseTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearAgentHoverClose]);

  useEffect(() => () => clearAgentHoverClose(), [clearAgentHoverClose]);

  const clearEffortHoverClose = useCallback(() => {
    if (effortHoverCloseTimerRef.current) {
      clearTimeout(effortHoverCloseTimerRef.current);
      effortHoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleEffortHoverClose = useCallback(() => {
    clearEffortHoverClose();
    effortHoverCloseTimerRef.current = setTimeout(() => {
      setEffortOpen(false);
      effortHoverCloseTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearEffortHoverClose]);

  // Agent、模型和推理强度共用一组 hover 菜单，进入新的菜单时立即关闭其他浮层。
  useEffect(() => {
    const handleOtherHoverMenu = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      if (key !== "agent") {
        clearAgentHoverClose();
        setAgentOpen(false);
      }
      if (key !== "effort") {
        clearEffortHoverClose();
        setEffortOpen(false);
      }
    };
    window.addEventListener(HOVER_MENU_EVENT, handleOtherHoverMenu);
    return () => window.removeEventListener(HOVER_MENU_EVENT, handleOtherHoverMenu);
  }, [clearAgentHoverClose, clearEffortHoverClose]);

  useEffect(() => () => clearEffortHoverClose(), [clearEffortHoverClose]);

  if (isScheduled) {
    return (
      <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2 text-[12px] text-t-dim opacity-60">
        <span className="shrink-0 text-[11px] text-t-ghost">Agent</span>
        <span className="truncate font-medium">{current?.name || agentId}</span>
      </div>
    );
  }

  const agentItemClass = (isActive: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors duration-150 ${
      isActive
        ? "bg-active text-t-primary"
        : "text-t-secondary hover:bg-hover hover:text-t-primary"
    }`;

  const renderAgent = (agent: (typeof agents)[number]) => {
    const isActive = agentId === agent.id;
    return (
      <button
        key={agent.id}
        type="button"
        onClick={() => handleSelectAgent(agent.id)}
        className={agentItemClass(isActive)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate">{agent.name}</span>
          {agent.model && (
            <span className="max-w-[120px] shrink-0 truncate text-[11px] text-t-ghost">
              {resolveModelName(agent.provider, agent.model)}
            </span>
          )}
        </span>
        {isActive && <Check size={13} className="shrink-0" />}
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      className="relative ml-auto flex w-fit min-w-0 max-w-full items-center justify-end gap-1"
    >
      {/* LLM 紧凑切换入口 */}
      <button
        type="button"
        ref={llmAnchorRef}
        aria-label={`切换模型和推理强度：${modelDisplayName}，${currentEffortLabel}`}
        aria-expanded={llmOpen}
        aria-haspopup="menu"
        onClick={toggleLlm}
        className={`flex h-8 min-w-0 flex-none items-center justify-center gap-1.5 rounded-full px-2 font-sans text-[12px] leading-none tracking-[-0.01em] transition-[background-color,color,box-shadow] duration-150 hover:bg-hover hover:text-t-primary ${
          llmOpen
            ? "w-fit max-w-[220px] bg-hover/70 text-t-secondary shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
            : "w-fit max-w-[220px] text-t-muted"
        }`}
        title={`${modelDisplayName} / ${currentEffortLabel}`}
      >
        <span className="min-w-0 max-w-[150px] truncate font-medium text-t-secondary">{modelDisplayName}</span>
        <span className="shrink-0 text-[11px] font-normal text-t-ghost">{currentEffortLabel}</span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-t-ghost transition-transform duration-200 ease-out ${llmOpen ? "rotate-180" : ""}`}
        />
      </button>

      <FloatingMenu
        open={llmOpen}
        anchorRef={llmAnchorRef}
        placement="top"
        align="end"
        gap={8}
        viewportPadding={8}
        menuId="llm-menu"
        role="menu"
        aria-label="模型和推理强度"
        className="z-[110] w-[248px] rounded-[14px] border border-border-subtle bg-surface p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.14)]"
      >
        <div
          ref={agentAnchorRef}
          className="relative"
          onMouseEnter={() => {
            window.dispatchEvent(new CustomEvent(HOVER_MENU_EVENT, { detail: "agent" }));
            clearAgentHoverClose();
            setAgentOpen(true);
          }}
          onMouseLeave={scheduleAgentHoverClose}
        >
          <button
            type="button"
            role="menuitem"
            aria-label={`Agent：${current?.name || agentId}`}
            aria-haspopup="menu"
            aria-expanded={agentOpen}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-t-secondary transition-colors hover:bg-hover hover:text-t-primary"
          >
            <span className="shrink-0 text-t-muted">Agent</span>
            <span className="min-w-0 flex-1 truncate text-right text-t-primary">{current?.name || agentId}</span>
            <ChevronRight size={14} className={`shrink-0 text-t-ghost transition-transform ${agentOpen ? "rotate-90" : ""}`} />
          </button>
        </div>

        <ModelPicker
          providers={providers}
          selected={model && provider ? { provider, modelId: model } : null}
          onSelect={handleSelectModel}
          onOpenSettings={() => {
            setLlmOpen(false);
            useLayout.getState().setActiveLeftPanel("settings");
          }}
          placement="right"
          openOnHover
          hoverMenuKey="model"
          pinnedOnlyByDefault
          panelWidthClass="w-[300px]"
          renderTrigger={({ open }) => (
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={(event) => event.stopPropagation()}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-t-secondary transition-colors hover:bg-hover hover:text-t-primary"
            >
              <span className="shrink-0 text-t-muted">模型</span>
              <span className="min-w-0 flex-1 truncate text-right text-t-primary">{modelDisplayName}</span>
              <ChevronRight size={14} className={`shrink-0 text-t-ghost transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
          )}
        />

        <div
          ref={effortAnchorRef}
          className="relative"
          onMouseEnter={() => {
            if (effortValues.length > 0) {
              window.dispatchEvent(new CustomEvent(HOVER_MENU_EVENT, { detail: "effort" }));
              clearEffortHoverClose();
              setEffortOpen(true);
            }
          }}
          onMouseLeave={scheduleEffortHoverClose}
        >
          <button
            type="button"
            role="menuitem"
            aria-haspopup={effortValues.length > 0 ? "menu" : undefined}
            aria-expanded={effortOpen}
            disabled={effortValues.length === 0}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${
              effortValues.length > 0
                ? "text-t-secondary hover:bg-hover hover:text-t-primary"
                : "cursor-default text-t-ghost/70"
            }`}
          >
            <span
              className={`shrink-0 ${effortValues.length > 0 ? "text-t-muted" : "text-t-ghost/70"}`}
            >
              推理强度
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-right ${
                effortValues.length > 0 ? "text-t-primary" : "text-t-ghost/70"
              }`}
            >
              {currentEffortLabel}
            </span>
            <ChevronRight size={14} className={`shrink-0 text-t-ghost transition-transform ${effortOpen ? "rotate-90" : ""}`} />
          </button>
        </div>
        <FloatingMenu
          open={agentOpen}
          anchorRef={agentAnchorRef}
          placement="right"
          align="start"
          gap={4}
          viewportPadding={8}
          menuId="agent-picker"
          role="menu"
          aria-label="Agent"
          onMouseEnter={clearAgentHoverClose}
          className="w-[260px] rounded-[14px] border border-border-subtle bg-surface p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.14)]"
        >
          <div className="max-h-[240px] overflow-y-auto">
            {builtinAgents.map(renderAgent)}
            {customAgents.length > 0 && (
              <>
                {builtinAgents.length > 0 && <div className="mx-2 my-1 border-t border-border-subtle" />}
                <div className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-t-ghost">
                  自定义
                </div>
                {customAgents.map(renderAgent)}
              </>
            )}
          </div>
        </FloatingMenu>

        <FloatingMenu
          open={effortOpen}
          anchorRef={effortAnchorRef}
          placement="right"
          align="start"
          gap={4}
          viewportPadding={8}
          menuId="reasoning-effort"
          role="menu"
          aria-label="推理强度选项"
          onMouseEnter={clearEffortHoverClose}
          className="w-[180px] rounded-[14px] border border-border-subtle bg-surface p-1.5 shadow-[0_12px_30px_rgba(15,23,42,0.14)]"
        >
          {effortValues.map((effort) => {
            const isActive = effort === currentEffort;
            return (
              <button
                key={effort || "default"}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => void handleSelectEffort(effort)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors ${
                  isActive
                    ? "bg-active text-t-primary"
                    : "text-t-secondary hover:bg-hover hover:text-t-primary"
                }`}
              >
                <span>{getEffortLabel(effort)}</span>
                {isActive && <Check size={13} className="shrink-0" />}
              </button>
            );
          })}
        </FloatingMenu>
      </FloatingMenu>
    </div>
  );
}
