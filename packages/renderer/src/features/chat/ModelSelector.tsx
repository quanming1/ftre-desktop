import { useState, useEffect, useRef, memo } from "react";
import { useChat } from "@/stores/chat";

interface ProviderGroup {
  vendor: string;
  models: Array<{ alias: string; key: string }>;
}

export const ModelSelector = memo(function ModelSelector() {
  const model = useChat((s) => s.model);
  const setModel = useChat((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || providers.length > 0) return;
    setLoading(true);
    fetch("http://localhost:9988/llm/providers")
      .then((r) => r.json())
      .then((data) => {
        // 转换 models 从 { alias: model_name } 对象到 [{ alias, key }] 数组
        const transformed = (data.providers || []).map((p: { vendor: string; models: Record<string, string> }) => ({
          vendor: p.vendor,
          models: Object.keys(p.models).map((alias) => ({
            alias,
            key: `${p.vendor}.${alias}`,
          })),
        }));
        setProviders(transformed);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, providers.length]);

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

  const displayName = model || "默认模型";

  const filtered = providers
    .map((p) => ({
      ...p,
      models: p.models.filter(
        (m) => !search || m.alias.toLowerCase().includes(search.toLowerCase()) || p.vendor.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((p) => p.models.length > 0);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[13px] h-9 px-3 rounded-md font-mono transition-colors duration-150 text-t-muted hover:text-t-primary hover:bg-white/[0.05]"
      >
        {displayName}
        <svg width="6" height="4" viewBox="0 0 6 4" className="shrink-0">
          <path d="M0.5 0.5L3 3.5L5.5 0.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 w-[280px] max-h-[360px] bg-elevated border border-border-subtle rounded-xl overflow-hidden flex flex-col shadow-2xl z-[100]"
          style={{ animation: "fadeIn 0.1s ease-out" }}
        >
          <div className="p-2 border-b border-border">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索模型..."
              autoFocus
              className="w-full px-2.5 py-1.5 text-[13px] bg-base rounded-md text-t-primary placeholder-t-dim outline-none font-mono"
            />
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {loading && <div className="p-3 text-t-dim text-[13px] text-center font-mono">加载中...</div>}

            <button
              onClick={() => {
                setModel(null);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2 text-[13px] font-mono transition-colors duration-150 ${
                !model ? "text-neon bg-neon-ghost" : "text-t-primary hover:bg-white/[0.04]"
              }`}
            >
              默认模型
            </button>

            {filtered.map((provider) => (
              <div key={provider.vendor}>
                <div className="px-4 pt-2.5 pb-1 text-[11px] text-t-dim uppercase tracking-wider font-mono">{provider.vendor}</div>
                {provider.models.map((m) => {
                  const isActive = model === m.key;
                  return (
                    <button
                      key={m.key}
                      onClick={() => {
                        setModel(m.key);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-4 pl-6 py-2 text-[13px] font-mono transition-colors duration-150 ${
                        isActive ? "text-neon bg-neon-ghost" : "text-t-primary hover:bg-white/[0.04]"
                      }`}
                    >
                      {m.alias}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
