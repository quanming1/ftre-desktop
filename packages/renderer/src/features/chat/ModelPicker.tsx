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
  useMemo,
  type ReactNode,
} from "react";
import { Check, Pin, Search, Settings2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ModelBadges } from "./ModelBadges";
import type { ModelItem } from "@/services/api";

// ─────────────────────────────────────────────────────────────
// Pin 模型存储（纯前端，localStorage）
// ─────────────────────────────────────────────────────────────
const PINNED_MODELS_KEY = "ftre:pinned-models";

interface PinnedModelKey {
  provider: string;
  modelId: string;
}

function getPinnedModels(): PinnedModelKey[] {
  try {
    const raw = localStorage.getItem(PINNED_MODELS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PinnedModelKey[];
  } catch {
    return [];
  }
}

function setPinnedModels(pins: PinnedModelKey[]): void {
  try {
    localStorage.setItem(PINNED_MODELS_KEY, JSON.stringify(pins));
  } catch {
    // ignore
  }
}

function togglePin(provider: string, modelId: string): boolean {
  const pins = getPinnedModels();
  const idx = pins.findIndex(
    (p) => p.provider === provider && p.modelId === modelId,
  );
  const wasPinned = idx !== -1;
  if (wasPinned) {
    pins.splice(idx, 1);
  } else {
    pins.push({ provider, modelId });
  }
  setPinnedModels(pins);
  return !wasPinned; // 返回新的 pinned 状态
}

function isPinned(provider: string, modelId: string): boolean {
  return getPinnedModels().some(
    (p) => p.provider === provider && p.modelId === modelId,
  );
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const itemBaseClass =
  "w-full px-3 py-2 text-left text-[13px] flex items-center gap-2 rounded-lg transition-all duration-150";
const itemNormalClass =
  "text-t-secondary hover:text-t-primary hover:bg-hover active:bg-active active:text-t-primary";
const itemSelectedClass =
  "text-[#1a1a1a] bg-[#e2e2e3]";

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export function ModelPicker({
  providers,
  selected,
  onSelect,
  renderTrigger,
  extraTopOption,
  onOpenSettings,
  placement = "top",
  panelWidthClass = "w-[320px]",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  // Pin 模型列表（响应 localStorage 变化需要强制刷新）
  const [, forceUpdate] = useState(0);
  const pinnedModels = useMemo(() => {
    if (providers.length === 0) return [];
    const pins = getPinnedModels();
    const result: { provider: ProviderInfo; model: ModelItem }[] = [];

    for (const pin of pins) {
      const p = providers.find((pr) => pr.name === pin.provider);
      if (!p) continue;
      const m = p.models.find((mm) => mm.id === pin.modelId);
      if (!m) continue;
      result.push({ provider: p, model: m });
    }
    return result;
  }, [providers]);

  // 计算初始滚动位置（在渲染前计算，避免闪烁）
  const initialScrollTop = useMemo(() => {
    if (!selected || providers.length === 0) return 0;
    
    // 估算每个项的高度
    const itemHeight = 40; // py-2 + text = ~40px
    const groupHeaderHeight = 32; // pt-3 pb-1.5 + text
    const pinnedSectionHeight = pinnedModels.length > 0 
      ? (pinnedModels.length * itemHeight + groupHeaderHeight + 16) 
      : 0;
    
    let offset = pinnedSectionHeight;
    
    for (const provider of providers) {
      offset += groupHeaderHeight;
      for (const model of provider.models) {
        if (model.id === selected.modelId && provider.name === selected.provider) {
          // 返回让选中项居中的滚动位置
          return Math.max(0, offset - 120);
        }
        offset += itemHeight;
      }
    }
    return 0;
  }, [selected, providers, pinnedModels]);

  useEffect(() => {
    if (open) {
      setSearch("");
      // 等 DOM 出来再聚焦
      setTimeout(() => searchInputRef.current?.focus(), 50);
      
      // 立即设置滚动位置（无动画）
      if (listRef.current && initialScrollTop > 0) {
        listRef.current.scrollTop = initialScrollTop;
      }
    }
  }, [open, initialScrollTop]);

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

  const handleTogglePin = (e: React.MouseEvent, providerName: string, modelId: string) => {
    e.stopPropagation(); // 阻止触发选择
    togglePin(providerName, modelId);
    forceUpdate((n) => n + 1); // 强制刷新让 pinned 列表更新
  };

  const handleExtraSelect = async () => {
    if (!extraTopOption) return;
    close();
    await extraTopOption.onSelect();
  };

  const placementClass =
    placement === "top" ? "bottom-full mb-1" : "top-full mt-1";

  // 动画方向
  const motionY = placement === "top" ? 8 : -8;

  return (
    <div className="relative" ref={panelRef}>
      {renderTrigger({ open, toggle })}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: motionY }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: motionY }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute ${placementClass} left-0 ${panelWidthClass} bg-[var(--ftre-elevated,#2d2d2d)] border border-[var(--ftre-border,#3c3c3c)]/50 rounded-xl overflow-hidden flex flex-col shadow-xl backdrop-blur-xl z-[100]`}
          >
            {/* 搜索框 */}
            <div className="p-2">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ftre-text-ghost,#666)]"
                />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模型..."
                  className="w-full h-8 pl-8 pr-3 text-[13px] bg-[var(--ftre-base,#1a1a1a)] border border-[var(--ftre-border,#3c3c3c)] rounded-lg text-[var(--ftre-text-primary,#e8e8e8)] placeholder:text-[var(--ftre-text-ghost,#666)] outline-none focus:border-[var(--ftre-accent,#00ff88)] transition-colors"
                />
              </div>
            </div>

            {providers.length === 0 ? (
              <div className="px-4 py-6 flex flex-col items-center gap-2">
                <div className="text-center text-[13px] text-[var(--ftre-text-muted,#999)]">
                  未找到已配置的模型
                </div>
                {onOpenSettings && (
                  <button
                    onClick={() => {
                      close();
                      onOpenSettings();
                    }}
                    className="mt-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--ftre-accent,#00ff88)] text-[#1a1a1a] text-[13px] font-medium hover:shadow-lg hover:shadow-[var(--ftre-accent,#00ff88)]/25 transition-all"
                  >
                    <Settings2 size={14} />
                    打开设置配置模型
                  </button>
                )}
              </div>
            ) : (
              <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
                {/* 顶部特殊项（如"沿用主对话模型"），不参与搜索过滤 */}
                {extraTopOption && (
                  <div className="px-1.5 mb-1">
                    <button
                      onClick={() => void handleExtraSelect()}
                      className={`${itemBaseClass} ${
                        extraTopOption.selected
                          ? itemSelectedClass
                          : itemNormalClass
                      }`}
                    >
                      <span className="truncate flex-1 min-w-0">
                        {extraTopOption.label}
                      </span>
                      {extraTopOption.selected && (
                        <Check size={14} className="shrink-0" />
                      )}
                    </button>
                  </div>
                )}

                {/* Pin 模型 */}
                {!search.trim() && pinnedModels.length > 0 && (
                  <div className="mb-1">
                    <div className="px-4 pt-2 pb-1.5 text-[11px] text-[var(--ftre-text-ghost,#666)] uppercase tracking-wider font-medium flex items-center gap-1.5">
                      <Pin size={10} className="fill-current" />
                      Pin
                    </div>
                    {pinnedModels.map(({ provider, model }) => {
                      const isSelected =
                        model.id === selected?.modelId &&
                        provider.name === selected?.provider;
                      return (
                        <div
                          key={`pin-${provider.name}-${model.id}`}
                          className="px-1.5"
                        >
                          <button
                            onClick={() =>
                              void handleSelect(provider.name, model.id)
                            }
                            className={`${itemBaseClass} ${
                              isSelected ? itemSelectedClass : itemNormalClass
                            } group`}
                          >
                            <span className="truncate flex-1 min-w-0">
                              {model.name || model.id}
                            </span>
                            <span className="text-[11px] text-[var(--ftre-text-ghost,#666)] shrink-0">
                              {provider.label}
                            </span>
                            {/* Badges / Pin 互斥：常驻 Pin，hover 时 Pin 淡出让位给 badges */}
                            <span className="shrink-0 flex items-center gap-0.5 overflow-hidden">
                              <span
                                className={`flex items-center gap-1 transition-all duration-150 ${
                                  /* hover 时 badges 淡入展开 */
                                  "max-w-0 opacity-0 group-hover:max-w-[80px] group-hover:opacity-100"
                                }`}
                              >
                                <ModelBadges
                                  contextWindow={model.context_window}
                                  vision={model.vision}
                                />
                              </span>
                              <span
                                onClick={(e) => handleTogglePin(e, provider.name, model.id)}
                                className={`p-0.5 rounded hover:bg-[var(--ftre-border,#3c3c3c)]/50 cursor-pointer transition-all duration-150 text-[var(--ftre-accent,#00ff88)] ${
                                  "max-w-[24px] opacity-100 group-hover:max-w-0 group-hover:opacity-0"
                                }`}
                                title="取消置顶"
                              >
                                <Pin size={13} className="fill-current" />
                              </span>
                            </span>
                            {isSelected && (
                              <Check size={14} className="shrink-0" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                    <div className="mx-3 mt-1.5 mb-1 border-t border-[var(--ftre-border,#3c3c3c)]/60" />
                  </div>
                )}

                {/* 所有模型分组 */}
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
                        <div className="px-4 pt-3 pb-1.5 text-[11px] text-[var(--ftre-text-ghost,#666)] uppercase tracking-wider font-medium">
                          {provider.label}
                        </div>
                        {filteredModels.map((model) => {
                          const isSelected =
                            model.id === selected?.modelId &&
                            provider.name === selected?.provider;
                          const modelPinned = isPinned(provider.name, model.id);
                          return (
                            <div
                              key={`${provider.name}-${model.id}`}
                              className="px-1.5"
                              data-model-key={`${provider.name}:${model.id}`}
                            >
                              <button
                                onClick={() =>
                                  void handleSelect(provider.name, model.id)
                                }
                                className={`${itemBaseClass} ${
                                  isSelected
                                    ? itemSelectedClass
                                    : itemNormalClass
                                } group`}
                              >
                                <span className="truncate flex-1 min-w-0">
                                  {model.name || model.id}
                                </span>
                                {/* Badges / Pin 互斥：默认 badges，hover 时 badges 收起 Pin 展开 */}
                                <span className="shrink-0 flex items-center gap-0.5 overflow-hidden">
                                  <span
                                    className={`flex items-center gap-1 transition-all duration-150 ${
                                      modelPinned
                                        ? "max-w-0 opacity-0"
                                        : "max-w-[80px] opacity-100 group-hover:max-w-0 group-hover:opacity-0"
                                    }`}
                                  >
                                    <ModelBadges
                                      contextWindow={model.context_window}
                                      vision={model.vision}
                                    />
                                  </span>
                                  <span
                                    onClick={(e) => handleTogglePin(e, provider.name, model.id)}
                                    className={`p-0.5 rounded hover:bg-[var(--ftre-border,#3c3c3c)]/50 cursor-pointer transition-all duration-150 ${
                                      modelPinned
                                        ? "max-w-[24px] opacity-100 text-[var(--ftre-accent,#00ff88)]"
                                        : "max-w-0 opacity-0 text-[var(--ftre-text-ghost,#666)] group-hover:max-w-[24px] group-hover:opacity-100"
                                    }`}
                                    title={modelPinned ? "取消置顶" : "置顶"}
                                  >
                                    <Pin size={13} className={modelPinned ? "fill-current" : ""} />
                                  </span>
                                </span>
                                {isSelected && (
                                  <Check size={14} className="shrink-0" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                  .filter(Boolean)}
              </div>
            )}

            {onOpenSettings && providers.length > 0 && (
              <div className="border-t border-[var(--ftre-border,#3c3c3c)]/60 p-1.5">
                <button
                  onClick={() => {
                    close();
                    onOpenSettings();
                  }}
                  className={`${itemBaseClass} ${itemNormalClass} text-[12.5px]`}
                  title="打开设置 → 模型，编辑供应商与模型列表"
                >
                  <Settings2 size={14} className="shrink-0 opacity-70" />
                  <span className="truncate">管理模型…</span>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
