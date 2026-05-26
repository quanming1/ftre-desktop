/**
 * ModelPicker — 通用模型选择下拉
 *
 * 从 ModelSelector 抽出来的下拉面板组件。供 ModelSelector（聊天输入栏切换主模型）
 * 和 ModelSettings 里的"标题生成模型"选择器复用，保持视觉/交互一致。
 *
 * 由调用方提供：
 * - providers          已经从 config 解析好的可用模型分组
 * - selected           当前选中的 provider + modelId（可空）
 * - onSelect           用户挑选某个模型时回调
 * - renderTrigger      触发按钮渲染（通常是 ModelSelector 的胶囊或表单中的 select 风格按钮）
 * - extraTopOption     可选的特殊项，渲染在搜索框下、模型列表上方（如"沿用主对话模型"）
 * - onOpenSettings     "打开设置"按钮点击；不传则不渲染底栏快捷入口
 * - placement          下拉浮层方向，默认向下展开（top 时向上展开）
 * - panelWidthClass    覆盖下拉面板宽度（默认 w-[280px]）
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { Check, Search, Settings2 } from "lucide-react";
import { ModelBadges } from "./ModelBadges";
import type { ModelItem } from "@/services/api";

export interface ProviderInfo {
  name: string;
  label: string;
  models: ModelItem[];
}

export interface ModelPickerSelection {
  provider: string;
  modelId: string;
}

export interface ModelPickerExtraOption {
  /** 唯一 key */
  key: string;
  /** 显示文案 */
  label: string;
  /** 是否选中（高亮 + Check） */
  selected: boolean;
  /** 点击回调 */
  onSelect: () => void | Promise<void>;
}

export interface ModelPickerProps {
  providers: ProviderInfo[];
  selected: ModelPickerSelection | null;
  onSelect: (provider: string, modelId: string) => void | Promise<void>;
  renderTrigger: (props: {
    open: boolean;
    toggle: () => void;
  }) => ReactNode;
  extraTopOption?: ModelPickerExtraOption;
  onOpenSettings?: () => void;
  placement?: "top" | "bottom";
  panelWidthClass?: string;
}

export function ModelPicker({
  providers,
  selected,
  onSelect,
  renderTrigger,
  extraTopOption,
  onOpenSettings,
  placement = "top",
  panelWidthClass = "w-[280px]",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) {
      setSearch("");
      // 等 DOM 出来再聚焦
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  const handleSelect = async (providerName: string, modelId: string) => {
    close();
    await onSelect(providerName, modelId);
  };

  const handleExtraSelect = async () => {
    if (!extraTopOption) return;
    close();
    await extraTopOption.onSelect();
  };

  const placementClass =
    placement === "top"
      ? "bottom-full mb-1"
      : "top-full mt-1";

  return (
    <div className="relative" ref={panelRef}>
      {renderTrigger({ open, toggle })}

      {open && (
        <div
          className={`absolute ${placementClass} left-0 ${panelWidthClass} bg-elevated border border-border-subtle rounded-xl overflow-hidden flex flex-col shadow-2xl z-[100]`}
          style={{ animation: "fadeIn 0.1s ease-out" }}
        >
          {/* 搜索框 */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t-ghost"
              />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模型..."
                className="w-full h-8 pl-8 pr-3 text-[13px] bg-base border border-border rounded-md text-t-primary placeholder:text-t-ghost outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          {providers.length === 0 ? (
            <div className="px-4 py-6 flex flex-col items-center gap-2">
              <div className="text-center text-[13px] text-t-muted">
                未找到已配置的模型
              </div>
              {onOpenSettings && (
                <button
                  onClick={() => {
                    close();
                    onOpenSettings();
                  }}
                  className="mt-1 inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-accent/10 text-accent text-[12px] hover:bg-accent/15 transition-colors"
                >
                  <Settings2 size={13} />
                  打开设置配置模型
                </button>
              )}
            </div>
          ) : (
            <div className="max-h-[340px] overflow-y-auto py-1">
              {/* 顶部特殊项（如"沿用主对话模型"），不参与搜索过滤 */}
              {extraTopOption && (
                <button
                  onClick={() => void handleExtraSelect()}
                  className={`w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2 transition-colors ${
                    extraTopOption.selected
                      ? "text-accent bg-accent/10"
                      : "text-t-secondary hover:text-t-primary hover:bg-hover"
                  }`}
                >
                  <span className="truncate flex-1 min-w-0">
                    {extraTopOption.label}
                  </span>
                  {extraTopOption.selected && (
                    <Check size={14} className="shrink-0" />
                  )}
                </button>
              )}

              {providers
                .map((provider) => {
                  const filteredModels = provider.models.filter((model) => {
                    if (!search.trim()) return true;
                    const q = search.toLowerCase();
                    return (
                      model.name.toLowerCase().includes(q) ||
                      model.id.toLowerCase().includes(q)
                    );
                  });
                  if (filteredModels.length === 0) return null;
                  return (
                    <div key={provider.name}>
                      <div className="px-3 pt-3 pb-1 text-[11px] text-t-ghost uppercase tracking-wider font-medium">
                        {provider.label}
                      </div>
                      {filteredModels.map((model) => {
                        const isSelected =
                          model.id === selected?.modelId &&
                          provider.name === selected?.provider;
                        return (
                          <button
                            key={`${provider.name}-${model.id}`}
                            onClick={() =>
                              void handleSelect(provider.name, model.id)
                            }
                            className={`w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2 transition-colors ${
                              isSelected
                                ? "text-accent bg-accent/10"
                                : "text-t-secondary hover:text-t-primary hover:bg-hover"
                            }`}
                          >
                            <span className="truncate flex-1 min-w-0">
                              {model.name || model.id}
                            </span>
                            <ModelBadges
                              contextWindow={model.context_window}
                              vision={model.vision}
                            />
                            {isSelected && (
                              <Check size={14} className="shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
                .filter(Boolean)}
            </div>
          )}

          {onOpenSettings && providers.length > 0 && (
            <div className="border-t border-border-subtle">
              <button
                onClick={() => {
                  close();
                  onOpenSettings();
                }}
                className="w-full flex items-center gap-2 px-3 h-9 text-[12.5px] text-t-muted hover:text-t-primary hover:bg-hover transition-colors"
                title="打开设置 → 模型，编辑供应商与模型列表"
              >
                <Settings2 size={13} className="shrink-0 opacity-70" />
                <span className="truncate">管理模型…</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
