/**
 * ModelSelector — Quick model switcher below the chat input.
 *
 * Reads current model from ~/.ai-base/config.json via fetchLLMProviders.
 * Shows current model name; click to open a panel to switch.
 */

import { useState, useEffect, useRef, memo, useCallback } from "react";
import { useChat } from "@/stores/chat";

const AI_BASE_CONFIG_PATH = "~/.ai-base/config.json";

interface ConfigSnapshot {
  model: string;
  provider: string;
  providerNames: string[];
}

async function readConfigSnapshot(): Promise<ConfigSnapshot> {
  try {
    const result = await window.desktop.fs.readFile(AI_BASE_CONFIG_PATH);
    const raw = typeof result === "string" ? result : result?.content || "";
    if (!raw) return { model: "", provider: "auto", providerNames: [] };
    const config = JSON.parse(raw);
    return {
      model: config.agents?.defaults?.model || "",
      provider: config.agents?.defaults?.provider || "auto",
      providerNames: Object.keys(config.providers || {}),
    };
  } catch {
    return { model: "", provider: "auto", providerNames: [] };
  }
}

async function writeModelToConfig(model: string, provider?: string): Promise<void> {
  try {
    const result = await window.desktop.fs.readFile(AI_BASE_CONFIG_PATH);
    const raw = typeof result === "string" ? result : result?.content || "";
    const config = raw ? JSON.parse(raw) : {};
    if (!config.agents) config.agents = { defaults: {} };
    if (!config.agents.defaults) config.agents.defaults = {};
    config.agents.defaults.model = model;
    if (provider) config.agents.defaults.provider = provider;
    await window.desktop.fs.writeFile(AI_BASE_CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("[ModelSelector] Failed to write config:", e);
  }
}

export const ModelSelector = memo(function ModelSelector() {
  const [open, setOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [providerNames, setProviderNames] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // Load config on mount and when panel opens
  const loadConfig = useCallback(async () => {
    const snap = await readConfigSnapshot();
    setCurrentModel(snap.model);
    setCurrentProvider(snap.provider);
    setProviderNames(snap.providerNames);
    setInputValue(snap.model);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  useEffect(() => {
    if (open) loadConfig();
  }, [open, loadConfig]);

  // Click outside to close
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

  const handleSave = async () => {
    const newModel = inputValue.trim();
    if (!newModel) return;
    await writeModelToConfig(newModel);
    setCurrentModel(newModel);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const displayName = currentModel || "默认模型";

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[13px] h-9 px-3 rounded-md font-mono transition-colors duration-150 text-t-muted hover:text-t-primary hover:bg-white/[0.05]"
      >
        <span className="truncate max-w-[200px]">{displayName}</span>
        <svg width="6" height="4" viewBox="0 0 6 4" className="shrink-0">
          <path d="M0.5 0.5L3 3.5L5.5 0.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 w-[320px] bg-elevated border border-border-subtle rounded-xl overflow-hidden flex flex-col shadow-2xl z-[100]"
          style={{ animation: "fadeIn 0.1s ease-out" }}
        >
          {/* Model input */}
          <div className="p-3 border-b border-border">
            <label className="block text-[11px] text-t-ghost uppercase tracking-wider mb-1.5">
              模型名称
            </label>
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. gpt-4o, claude-opus-4-5"
              autoFocus
              className="w-full px-2.5 py-1.5 text-[13px] bg-base rounded-md text-t-primary placeholder-t-dim outline-none font-mono border border-border focus:border-neon transition-colors"
            />
          </div>

          {/* Provider info */}
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[11px] text-t-ghost">
              Provider: <span className="text-t-secondary font-mono">{currentProvider}</span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="py-1 max-h-[200px] overflow-y-auto">
            {providerNames.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-[10px] text-t-ghost uppercase tracking-wider">
                已配置的 Providers
              </div>
            )}
            {providerNames.map((name) => (
              <div
                key={name}
                className={`px-4 py-1.5 text-[12px] font-mono text-t-secondary ${
                  name === currentProvider ? "text-neon" : ""
                }`}
              >
                {name} {name === currentProvider && "✓"}
              </div>
            ))}
          </div>

          {/* Save button */}
          <div className="p-3 border-t border-border">
            <button
              onClick={handleSave}
              disabled={!inputValue.trim() || inputValue.trim() === currentModel}
              className="w-full py-2 text-[13px] font-medium bg-neon hover:bg-neon-hover text-base rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              切换模型
            </button>
            <p className="text-[11px] text-t-ghost text-center mt-1.5">
              下次对话生效
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
